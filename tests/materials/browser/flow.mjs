// Fully intercepted. Auth, R2 transport, gateway, pg_net and provider are isolated doubles; SQL, page scripts,
// the actual Yes/No UI and real RLS/level SQL run; the existing signer contract is doubled.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { alertFixture, uid } from '../alert-fixture.mjs';
const lab = ['--practice', '--practice-smoke'].includes(process.argv[2]),
  headed = process.argv[2] === '--practice';
const exe =
  process.env.LEGALHUB_TEST_CHROME ||
  (process.platform === 'win32' &&
    [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA]
      .filter(Boolean)
      .flatMap((dir) =>
        ['Microsoft/Edge/Application/msedge.exe', 'Google/Chrome/Application/chrome.exe'].map((f) =>
          path.join(dir, f),
        ),
      )
      .find((f) => fs.existsSync(f)));
if (!exe)
  throw Error('Set LEGALHUB_TEST_CHROME to a local Chrome/Edge/Chromium executable. Do not use a website.');
const P = fileURLToPath(new URL('../../../public/', import.meta.url)),
  base = 'https://fixture.invalid',
  f = await alertFixture(),
  { db, as, query, scalar } = f;
const browser = await chromium.launch({
  executablePath: exe,
  headless: !headed,
  args: [
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-background-networking',
    '--no-proxy-server',
    '--host-resolver-rules=MAP * ~NOTFOUND',
    ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
  ],
});
const files = new Map(),
  issued = [],
  inserted = [],
  errors = [],
  foreign = [];
let failCleanup = false,
  serial = Promise.resolve();
function isolated(fn) {
  const call = serial.then(fn);
  serial = call.catch(() => {});
  return call;
}
const dbCall = async (name, keys, args) => {
  try {
    return {
      data: await scalar(
        `SELECT public.${name}(${keys.map((_, i) => '$' + (i + 1)).join(',')})`,
        keys.map((k) => (k === 'p_values' && args[k] ? JSON.stringify(args[k]) : args[k])),
      ),
      error: null,
    };
  } catch (e) {
    return { data: null, error: { code: e.code, message: 'Fixture DB refused' } };
  }
};
const ops = { lh_course_list: ['p_level', 'p_semester', 'p_include_archived'] };
async function call(who, op, p) {
  await as(who);
  const actor = uid(who);
  if (op === 'rpc') {
    if (lab && ['get_effective_level', 'get_my_level_context', 'set_my_academic_level'].includes(p.name)) {
      const keys = {
        get_effective_level: ['p_uid'],
        get_my_level_context: [],
        set_my_academic_level: ['p_level', 'p_session_year', 'p_confirmation', 'p_expected_uid'],
      };
      return dbCall(p.name, keys[p.name], p.args || {});
    }
    if (p.name === 'get_effective_level') return { data: '100L' };
    if (p.name !== 'lh_course_list') throw Error('Unknown web RPC');
    return dbCall(p.name, ops[p.name], p.args);
  }
  if (op === 'read' || op === 'update') {
    if (p.table === 'users') {
      assert.equal(op, 'read');
      return {
        data: (await query('SELECT id,username,is_admin FROM public.users WHERE id=$1', [actor]))[0] || null,
      };
    }
    assert.equal(p.table, 'materials');
    const cols = [
      'id',
      'file_name',
      'material_name',
      'course',
      'level',
      'semester',
      'status',
      'storage_path',
    ];
    const args = [];
    const param = (v) => {
      args.push(v);
      return '$' + args.length;
    };
    const entries = Object.entries(p.filters || {});
    assert(entries.length);
    const where = entries
      .map(([k, v]) => {
        assert(cols.includes(k));
        return k + ' IS NOT DISTINCT FROM ' + param(v);
      })
      .join(' AND ');
    let sql = 'SELECT * FROM public.materials WHERE ' + where + ' ORDER BY uploaded_at,id';
    if (op === 'update') {
      assert(p.single);
      assert('id' in p.filters && p.filters.status === 'pending');
      const set = Object.entries(p.values)
        .map(([k, v]) => {
          assert(['status', 'course', 'material_name', 'level', 'semester'].includes(k));
          return k + '=' + param(v);
        })
        .join(',');
      sql = 'UPDATE public.materials SET ' + set + ' WHERE ' + where + ' RETURNING id';
    }
    if (p.limit) {
      assert.equal(p.limit, 2);
      sql += ' LIMIT 2';
    }
    try {
      const rows = await query(sql, args);
      return { data: p.single ? rows[0] || null : rows, error: null };
    } catch (e) {
      return { data: null, error: { code: e.code } };
    }
  }
  if (op === 'insert') {
    assert.equal(p.uploaded_by, actor);
    assert(files.has(p.storage_path));
    const id = uid(200 + inserted.length);
    await query(
      'INSERT INTO public.materials(id,file_name,material_name,level,semester,course,status,storage_path,uploaded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [
        id,
        p.file_name,
        p.material_name,
        p.level,
        p.semester,
        p.course,
        p.status,
        p.storage_path,
        p.uploaded_by,
      ],
    );
    inserted.push(id);
    return { data: null, error: null, status: 201 };
  }
  if (op !== 'r2') throw Error('Unknown fixture operation');
  if (p.action === 'upload') {
    const index = issued.length,
      key = `materials/${actor}/${index}_scan.pdf`;
    issued.push(key);
    return { data: { key, uploadUrl: base + '/fixture-put/' + index } };
  }
  if (p.action === 'download') {
    const rows = await query('SELECT id FROM public.materials WHERE storage_path=$1', [p.key]);
    return rows.length === 1 && files.has(p.key)
      ? { data: { downloadUrl: base + '/fixture-get/' + rows[0].id } }
      : { error: { message: 'No file' } };
  }
  if (p.action !== 'reject') throw Error('Not the deployed removal action');
  if (!(await scalar('SELECT is_admin FROM public.users WHERE id=$1', [actor])))
    return { data: null, error: { message: 'Not authorized' } };
  await as(0);
  const pair = await query('SELECT id FROM public.materials WHERE id=$1 AND storage_path=$2', [
    p.materialId,
    p.key,
  ]);
  if (pair.length !== 1 || failCleanup) {
    failCleanup = false;
    return { error: { message: 'Removal not confirmed' } };
  }
  files.delete(p.key);
  await query('DELETE FROM public.materials WHERE id=$1 AND storage_path=$2', [p.materialId, p.key]);
  return { data: { deleted: true }, error: null };
}
async function visit(who, mount, width) {
  const ctx = await browser.newContext({ viewport: { width, height: 850 }, serviceWorkers: 'block' });
  await ctx.exposeBinding('localOnly', (_, op, p) => isolated(() => call(who, op, p)));
  await ctx.addInitScript(
    ({ id, lab, role }) => {
      const user = { id },
        session = { user };
      window.localUI = {};
      if (lab)
        document.addEventListener('DOMContentLoaded', () => {
          const bar = document.createElement('aside');
          bar.id = 'fixture-notice';
          bar.setAttribute('role', 'status');
          Object.assign(bar.style, {
            background: '#142e43',
            color: 'white',
            padding: '12px 16px',
            font: 'bold 14px system-ui',
          });
          bar.textContent =
            'LOCAL PRACTICE — ' +
            role +
            '. Fictional records only. Changes disappear when you close this browser.';
          document.body.prepend(bar);
          if (location.pathname.endsWith('/profile.html'))
            for (const el of document.querySelectorAll('button,input,select'))
              if (
                !['level-select', 'save-level-btn', 'level-confirm', 'level-apply', 'level-cancel'].includes(
                  el.id,
                )
              )
                el.disabled = true;
        });
      Object.defineProperty(navigator, 'share', {
        value: (x) => {
          localUI.shared = x;
          return Promise.resolve();
        },
      });
      window.open = (url) => {
        localUI.opened = url;
        return null;
      };
      window.alert = (x) => {
        localUI.alert = x;
        if (lab && document.getElementById('fixture-notice'))
          document.getElementById('fixture-notice').textContent = 'LOCAL PRACTICE · ' + x;
      };
      window.supabaseClient = {
        auth: {
          getUser: async () => ({ data: { user } }),
          getSession: async () => ({ data: { session } }),
          onAuthStateChange() {
            return { data: { subscription: { unsubscribe() {} } } };
          },
        },
        rpc: (name, args) => window.localOnly('rpc', { name, args }),
        functions: {
          invoke: (n, { body }) => {
            if (n !== 'r2-presign') throw Error('Unknown function');
            return window.localOnly('r2', body);
          },
        },
        from(table) {
          const filters = {};
          let values = null;
          const exec = (single = false, limit = null) =>
            window.localOnly(values ? 'update' : 'read', { table, filters, values, single, limit });
          return {
            select() {
              return this;
            },
            update(v) {
              values = v;
              return this;
            },
            eq(k, v) {
              filters[k] = v;
              return this;
            },
            is(k, v) {
              filters[k] = v;
              return this;
            },
            limit: (n) => exec(false, n),
            order: () => exec(),
            single: () => exec(true),
            maybeSingle: () => exec(true),
            then(a, b) {
              return exec().then(a, b);
            },
            insert: (v) => window.localOnly('insert', v),
          };
        },
      };
    },
    { id: uid(who), lab, role: who === 2 ? 'admin' : 'student' },
  );
  await ctx.route('**/*', async (route) => {
    const req = route.request(),
      u = new URL(req.url());
    const js = (body) => route.fulfill({ contentType: 'application/javascript', body });
    if (u.origin === base && req.method() === 'PUT' && u.pathname.startsWith('/fixture-put/')) {
      const key = issued[Number(u.pathname.split('/').pop())];
      assert(key);
      files.set(key, req.postDataBuffer());
      return route.fulfill({ status: 200, body: '' });
    }
    if (req.method() !== 'GET') {
      foreign.push(req.method());
      return route.abort();
    }
    if (u.origin === base && u.pathname.startsWith('/fixture-get/'))
      return route.fulfill({ contentType: 'application/pdf', body: '%PDF-1.4 synthetic' });
    if (u.hostname === 'cdnjs.cloudflare.com' && u.pathname.endsWith('/pdf.min.js'))
      return js(
        'window.pdfjsLib={GlobalWorkerOptions:{},getDocument:()=>({promise:Promise.reject(Error("stub cover"))})};',
      );
    if (['cdn.jsdelivr.net', 'cdn.tailwindcss.com'].includes(u.hostname)) return js('');
    if (['fonts.googleapis.com', 'fonts.gstatic.com', 'cdnjs.cloudflare.com'].includes(u.hostname))
      return route.fulfill({ contentType: 'text/css', body: '' });
    if (u.origin !== base || !u.pathname.startsWith(mount)) {
      foreign.push(u.origin);
      return route.abort();
    }
    const rel = u.pathname.slice(mount.length);
    if (rel.startsWith('styles/'))
      return route.fulfill({
        contentType: 'text/css',
        body: '.hidden,[hidden]{display:none!important;}',
      });
    if (rel.startsWith('assets/'))
      return route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg"/>',
      });
    if (rel === 'scripts/auth/auth-guard.js')
      return js(
        'document.addEventListener("DOMContentLoaded",()=>document.body.style.visibility="visible");',
      );
    if (rel === 'scripts/auth/supabase-client.js' || rel === 'scripts/password-visibility.js') return js('');
    if (rel === 'scripts/avatar.js') return js('window.renderAvatar=window.loadHeaderAvatar=()=>{};');
    const file = path.join(P, rel);
    if (!file.startsWith(P) || !fs.existsSync(file)) {
      foreign.push(rel);
      return route.fulfill({ status: 404, body: '' });
    }
    return route.fulfill({
      contentType: rel.endsWith('.html') ? 'text/html' : 'application/javascript',
      body: fs.readFileSync(file),
    });
  });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  p.setDefaultTimeout(7500);
  return { p, go: (rel) => p.goto(base + mount + rel) };
}
const state = (id) =>
  isolated(async () => {
    await as(0);
    return (await query('SELECT status,material_name FROM public.materials WHERE id=$1', [id]))[0] ?? null;
  });
async function practice() {
  // Real reviewed SQL on isolated, throwaway data; no production client, service credential, storage, or mail.
  const legacy = fs
    .readFileSync(new URL('../../academic/legacy-level-body.sql.txt', import.meta.url), 'utf8')
    .replace(/\r\n/g, '\n');
  await as(0);
  await db.exec(`ALTER TABLE public.users ADD COLUMN current_level text DEFAULT '200L', ADD COLUMN level_updated_at timestamptz DEFAULT now(), ADD COLUMN level text;
    GRANT UPDATE(current_level,level_updated_at) ON public.users TO authenticated;
    CREATE FUNCTION public.get_effective_level(p_uid uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $old$${legacy}$old$;`);
  await db.exec(
    fs.readFileSync(new URL('../../../database/migrations/007-november-levels.sql', import.meta.url), 'utf8'),
  );
  // Compute the expected tier independently, from the fixture DB's Lagos date, not from the level RPC.
  const date = await scalar("SELECT to_char(now() AT TIME ZONE 'Africa/Lagos','YYYY-MM-DD')");
  const cycle = Number(date.slice(0, 4)) - (date.slice(5) < '11-07' ? 1 : 0);
  const effective = `${Math.min(5, 2 + Math.max(0, cycle - 2025))}00L`;
  const correction = effective === '400L' ? '300L' : '400L';
  assert.equal(await scalar('SELECT current_level FROM public.users WHERE id=$1', [uid(3)]), '200L');
  assert.equal(await scalar('SELECT level_base_year FROM public.users WHERE id=$1', [uid(3)]), null);
  await f.add(21, 'Practice — approve me');
  await f.add(22, 'Practice — reject me');
  files.set(f.key(21), Buffer.from('fixture'));
  files.set(f.key(22), Buffer.from('fixture'));
  const admin = await visit(2, '/', 1150),
    student = await visit(3, '/public/', 900),
    upload = await visit(3, '/', 900);
  await admin.go('pages/materials.html');
  await student.go('pages/profile.html');
  await upload.go('pages/materials.html');
  const a = admin.p,
    s = student.p;
  await a.locator('[data-admin-material]').first().waitFor();
  await s.waitForFunction(() => !document.getElementById('level-select').disabled);
  assert.equal(await s.locator('#display-level').innerText(), effective);
  assert.equal(await s.locator('#level-select').inputValue(), effective);
  await a.bringToFront();
  console.log(
    'LOCAL PRACTICE READY. Three tabs: admin moderation, student Profile levels and student upload. Only use sample files. Reload the admin tab after a student upload. Auth, R2 and email are simulated; page logic and database checks are real. Nothing touches LegalHub production.',
  );
  if (headed) {
    await new Promise((resolve) => {
      browser.once('disconnected', resolve);
      process.once('SIGINT', resolve);
    });
    return;
  }
  for (const [n, action] of [
    [21, 'Approve'],
    [22, 'Reject'],
  ]) {
    const id = uid(100 + n);
    await a
      .locator(`[data-admin-material="${id}"]`)
      .getByRole('button', { name: action, exact: true })
      .click();
    const d = a.getByRole('dialog');
    assert.equal(await d.locator('input').count(), 0);
    await d.getByRole('button', { name: 'Yes', exact: true }).click();
    await d.waitFor({ state: 'detached' });
    await a.locator(`[data-admin-material="${id}"]`).waitFor({ state: 'detached' });
    if (n === 21) assert.equal((await state(id)).status, 'approved');
    else {
      assert.equal(await state(id), null);
      assert(!files.has(f.key(n)));
    }
  }
  await s.selectOption('#level-select', correction);
  await s.click('#save-level-btn');
  const phrase = await s.locator('#level-phrase').innerText();
  await s.fill('#level-confirm', phrase);
  await s.click('#level-apply');
  await s.getByText(new RegExp('Saved ' + correction + ' for')).waitFor();
  await s.reload();
  await s.waitForFunction(
    (tier) => document.getElementById('display-level').textContent === tier,
    correction,
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(foreign, []);
  console.log(
    `PASS local practice: both real review dialogs commit only the selected fictional action. Existing 200L opens Profile at ${effective} without any save; own manual ${correction} persists after reload.`,
  );
}
async function automatedFlow() {
  const student = await visit(3, '/public/', 390),
    admin = await visit(2, '/', 1100),
    s = student.p,
    a = admin.p;
  await student.go('pages/materials.html');
  assert(await s.locator('#admin-panel').isHidden());
  const titles = ['Constitutional Law Notes', 'Withdrawn draft'];
  for (const title of titles) {
    await s.fill('#material-name-input', title);
    await s.selectOption('#level-input', '100L');
    await s.selectOption('#semester-input', 'second');
    await s.waitForFunction(() => document.querySelector('#course-input optgroup option'));
    await s.selectOption('#course-input', { index: 1 });
    await s.setInputFiles('#file-input', {
      name: 'scanner.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 synthetic'),
    });
    await s.click('#submit-upload-btn');
    await s.getByText(title + ' uploaded! Waiting for admin approval.', { exact: true }).waitFor();
  }
  assert.equal(inserted.length, 2);
  const [first, second] = inserted;
  let sent = 0;
  for (const id of inserted) {
    await isolated(async () => {
      await f.tick(); // a separate committed-outbox worker pass
      const e = await f.record(id);
      const res = await f.sendEvent(e, async () => Response.json({ id: 'fake-' + ++sent }));
      assert.equal(res.status, 200);
      assert.equal((await res.json()).accepted, 2);
    });
  }
  assert.equal(sent, 4);
  console.log(
    'PASS real upload form → fake R2 → two committed pending records → one signed webhook each → two fake admin acceptances per upload.',
  );
  await admin.go('pages/materials.html');
  const row = (id) => a.locator(`[data-admin-material="${id}"]`),
    dlg = a.getByRole('dialog'),
    last = dlg.getByRole('button', { name: 'Yes', exact: true }),
    cancel = dlg.getByRole('button', { name: 'No', exact: true });
  const finish = async () => {
    assert.equal(await dlg.locator('input').count(), 0);
    await last.click();
  };
  const edit = async (name) => {
    await row(first).getByRole('button', { name: 'Edit', exact: true }).click();
    await row(first).locator('[data-field=course]:not(:disabled)').waitFor();
    await row(first).locator('[data-field=material_name]').fill(name);
    await row(first).getByRole('button', { name: 'Save details' }).click();
    await dlg.waitFor();
  };
  await edit('Cancelled name');
  assert.equal(await dlg.locator('input').count(), 0);
  await cancel.click();
  assert.equal((await state(first)).material_name, titles[0]);
  await row(first).getByRole('button', { name: 'Save details' }).click();
  await dlg.waitFor();
  await isolated(async () => {
    await as(0);
    await query("UPDATE public.materials SET material_name='Changed elsewhere' WHERE id=$1", [first]);
  });
  await finish();
  await row(first)
    .getByText(/item changed/i)
    .waitFor();
  assert.equal((await state(first)).material_name, 'Changed elsewhere');
  await a.reload();
  const revised = 'Court Practice <Notes> & Evidence';
  await edit(revised);
  await dlg.getByText(/Save as/).waitFor();
  await finish();
  await row(first).getByText(revised, { exact: true }).waitFor();
  assert.equal((await state(first)).material_name, revised);
  assert.equal(await a.locator('#lh-moderation-result').innerText(), 'Details saved for: ' + revised + '.');
  assert.equal((await state(second)).material_name, titles[1]);
  console.log(
    'PASS edit dialog shows old item and proposed fields; No does nothing; stale write refused; exact current edit changes only the selected row.',
  );
  await row(first).getByRole('button', { name: 'Approve', exact: true }).click();
  await dlg.waitFor();
  await isolated(async () => {
    await as(0);
    await query('UPDATE public.users SET is_admin=false WHERE id=$1', [uid(2)]);
  });
  await finish();
  await row(first)
    .getByText(/Current administrator access/)
    .waitFor();
  assert.equal((await state(first)).status, 'pending');
  await isolated(async () => {
    await as(0);
    await query('UPDATE public.users SET is_admin=true WHERE id=$1', [uid(2)]);
  });
  await a.reload();
  await row(first).getByRole('button', { name: 'Approve', exact: true }).click();
  await finish();
  await row(first).waitFor({ state: 'detached' });
  assert.equal((await state(first)).status, 'approved');
  assert.equal(await a.locator('#lh-moderation-result').innerText(), 'Approved: ' + revised + '.');
  assert(files.has(issued[0]));
  console.log(
    'PASS revoked admin cannot approve an open review; current admin can approve it without deleting its PDF or sending another notification.',
  );
  await row(second).getByRole('button', { name: 'Reject', exact: true }).click();
  await dlg.waitFor();
  await a.keyboard.press('Escape');
  await dlg.waitFor({ state: 'detached' });
  assert.equal((await state(second)).status, 'pending');
  assert(files.has(issued[1]));
  await row(second).getByRole('button', { name: 'Reject', exact: true }).click();
  failCleanup = true;
  await finish();
  await row(second)
    .getByText(/Removal was not confirmed/)
    .waitFor();
  assert.equal((await state(second)).status, 'pending');
  assert(files.has(issued[1]));
  await a.reload();
  await row(second).getByRole('button', { name: 'Reject', exact: true }).click();
  await finish();
  await row(second).waitFor({ state: 'detached' });
  assert.equal(await state(second), null);
  assert(!files.has(issued[1]));
  console.log(
    'PASS rejected pending item via existing ID/key action; No/Escape and a refused removal are not success. No automatic retry.',
  );
  await isolated(async () => {
    await as(0);
    await f.add(8, revised, f.key(8), 'approved');
    files.set(f.key(8), Buffer.from('fixture double'));
  });
  await student.go('pages/pdf.html?level=all&material=' + first);
  await s.locator('.book-card').first().waitFor();
  assert.equal(await s.locator('[data-book-action=delete]').count(), 0);
  await admin.go('pages/pdf.html?level=all&material=' + first);
  const book = a.locator('.book-card');
  await book.getByText(revised, { exact: true }).waitFor();
  assert.equal(await book.locator('.book-title *').count(), 0);
  await book.locator('[data-book-action=read]').click();
  assert.equal(await a.evaluate(() => localUI.opened), base + '/fixture-get/' + first);
  await book.getByRole('button', { name: 'Share material' }).click();
  assert.equal(new URL(await a.evaluate(() => localUI.shared.url)).searchParams.get('material'), first);
  const del = async () => {
    const menu = book.locator('[data-book-action=delete]');
    if (!(await menu.isVisible())) await book.getByRole('button', { name: 'Material actions' }).click();
    await menu.click();
    await dlg.waitFor();
  };
  await del();
  assert.equal(await dlg.locator('input').count(), 0);
  await cancel.click();
  assert.equal((await state(first)).status, 'approved');
  await del();
  await finish();
  await book.waitFor({ state: 'detached' });
  assert.equal(
    await a.locator('#lh-moderation-result').innerText(),
    'Removed from the Library: ' + revised + '.',
  );
  assert.equal(await state(first), null);
  assert(!files.has(issued[0]));
  assert.equal((await state(uid(108))).material_name, revised);
  assert(files.has(f.key(8)));
  await isolated(async () => {
    await as(0);
    assert.equal(await scalar('select count(*)::int from lh_mail_transport.fake_requests'), 2);
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(foreign, []);
  console.log(
    'PASS approved Library read/share and Yes/No deletion by id with a same-title neighbour; no extra mail, unexpected requests or page errors.',
  );
}
try {
  if (lab) await practice();
  else await automatedFlow();
} finally {
  await browser.close();
  await db.close();
}
