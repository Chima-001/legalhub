// Fully intercepted. Auth, R2 transport, gateway, pg_net and provider are isolated doubles; SQL, page scripts,
// the moderation dialog and the two server-side operation handlers run as shipped.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { alertFixture, uid } from '../alert-fixture.mjs';
import { removeReviewed } from '../../../supabase/functions/r2-presign/removal.mjs';
if (!process.env.LEGALHUB_TEST_CHROME)
  throw Error(
    'Set LEGALHUB_TEST_CHROME to a local Chromium/Chrome executable. Do not point this test at a site.',
  );
const P = fileURLToPath(new URL('../../../public/', import.meta.url)),
  base = 'https://fixture.invalid',
  f = await alertFixture(),
  { db, as, query, scalar } = f;
const browser = await chromium.launch({
  executablePath: process.env.LEGALHUB_TEST_CHROME,
  args: ['--disable-dev-shm-usage', '--disable-gpu', '--no-sandbox'],
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
const ops = {
  lh_course_list: ['p_level', 'p_semester', 'p_include_archived'],
  lh_material_review: ['p_actor', 'p_id'],
  lh_material_change: ['p_actor', 'p_id', 'p_version', 'p_action', 'p_phrase', 'p_values'],
  lh_material_remove: ['p_actor', 'p_id', 'p_version', 'p_action', 'p_phrase'],
  lh_material_file_done: ['p_id', 'p_key'],
};
async function call(who, op, p) {
  await as(who);
  const actor = uid(who);
  if (op === 'rpc') {
    if (p.name === 'get_effective_level') return { data: '100L' };
    if (!['lh_course_list', 'lh_material_review', 'lh_material_change'].includes(p.name))
      throw Error('Unknown web RPC');
    return dbCall(p.name, ops[p.name], p.args);
  }
  if (op === 'read') {
    if (p.table === 'users')
      return {
        data: (await query('SELECT id,username,is_admin FROM public.users WHERE id=$1', [actor]))[0],
      };
    if (p.table !== 'materials' || !['approved', 'pending'].includes(p.status))
      throw Error('Unexpected read');
    return {
      data: await query('SELECT * FROM public.materials WHERE status=$1 ORDER BY uploaded_at,id', [
        p.status,
      ]),
    };
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
  if (p.action !== 'remove-reviewed') throw Error('Old or unknown delete action');
  const [status, result] = await removeReviewed(p, actor, {
    rpc: async (name, args) => {
      assert(['lh_material_remove', 'lh_material_file_done'].includes(name));
      await f.service();
      return dbCall(name, ops[name], args);
    },
    removeObject: async (key) => {
      await as(0);
      assert.equal(
        await scalar('SELECT count(*)::int FROM public.materials WHERE storage_path=$1', [key]),
        0,
      );
      if (failCleanup) {
        failCleanup = false;
        throw Error('Fake storage fault');
      }
      files.delete(key);
    },
  });
  return status >= 300 ? { error: { message: 'Review not confirmed' } } : { data: result, error: null };
}
async function visit(who, mount, width) {
  const ctx = await browser.newContext({ viewport: { width, height: 850 }, serviceWorkers: 'block' });
  await ctx.exposeBinding('localOnly', (_, op, p) => isolated(() => call(who, op, p)));
  await ctx.addInitScript((id) => {
    const user = { id },
      session = { user };
    window.localUI = {};
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
        let status;
        const exec = () => window.localOnly('read', { table, status });
        return {
          select() {
            return this;
          },
          eq(k, v) {
            if (k === 'status') status = v;
            return this;
          },
          order: exec,
          single: exec,
          then(a, b) {
            return exec().then(a, b);
          },
          insert: (v) => window.localOnly('insert', v),
        };
      },
    };
  }, uid(who));
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
    if (rel === 'scripts/auth/supabase-client.js') return js('');
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
    return (
      (await query('SELECT status,material_name FROM public.materials WHERE id=$1', [id]))[0] ?? null
    );
  });
try {
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
    input = dlg.locator('input'),
    last = dlg.locator('button').last(),
    cancel = dlg.locator('button').first();
  const finish = async (phrase) => {
    await input.fill(phrase);
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
  await input.fill('yes');
  assert(await last.isDisabled());
  await cancel.click();
  assert.equal((await state(first)).material_name, titles[0]);
  await row(first).getByRole('button', { name: 'Save details' }).click();
  await dlg.waitFor();
  await isolated(async () => {
    await as(0);
    await query("UPDATE public.materials SET material_name='Changed elsewhere' WHERE id=$1", [first]);
  });
  await finish('i edit ' + titles[0]);
  await dlg.getByText(/Change not confirmed/).waitFor();
  assert.equal((await state(first)).material_name, 'Changed elsewhere');
  await cancel.click();
  await a.reload();
  const revised = 'Court Practice <Notes> & Evidence';
  await edit(revised);
  await dlg.getByText(/Save as/).waitFor();
  await finish('i edit Changed elsewhere');
  await dlg.waitFor({ state: 'detached' });
  assert.equal((await state(first)).material_name, revised);
  assert.equal((await state(second)).material_name, titles[1]);
  console.log(
    'PASS edit dialog shows old item and proposed fields; cancel/wrong phrase do nothing; stale write refused; exact current edit changes only the selected row.',
  );
  await row(first).getByRole('button', { name: 'Approve', exact: true }).click();
  await dlg.waitFor();
  await isolated(async () => {
    await as(0);
    await query('UPDATE public.users SET is_admin=false WHERE id=$1', [uid(2)]);
  });
  await finish('i approve ' + revised);
  await dlg.getByText(/Change not confirmed/).waitFor();
  await cancel.click();
  assert.equal((await state(first)).status, 'pending');
  await isolated(async () => {
    await as(0);
    await query('UPDATE public.users SET is_admin=true WHERE id=$1', [uid(2)]);
  });
  await a.reload();
  await row(first).getByRole('button', { name: 'Approve', exact: true }).click();
  await finish('i approve ' + revised);
  await row(first).waitFor({ state: 'detached' });
  assert.equal((await state(first)).status, 'approved');
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
  await finish('i reject ' + titles[1]);
  await dlg.getByText(/File cleanup is pending/).waitFor();
  assert.equal(await state(second), null);
  assert(files.has(issued[1]));
  await dlg.getByRole('button', { name: 'Retry file cleanup' }).click();
  await dlg.waitFor({ state: 'detached' });
  assert(!files.has(issued[1]));
  console.log(
    'PASS rejection cancel preserves both resources; storage failure leaves a private cleanup ticket and truthful UI, then exact retry removes only that object.',
  );
  await isolated(async () => {
    await as(0);
    await f.add(8, revised, f.key(8), 'approved');
    files.set(f.key(8), Buffer.from('fixture double'));
  });
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
  await input.fill('i reject ' + revised);
  assert(await last.isDisabled());
  await cancel.click();
  assert.equal((await state(first)).status, 'approved');
  await del();
  await finish('i delete ' + revised);
  await book.waitFor({ state: 'detached' });
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
    'PASS approved Library read/share and typed deletion by id with a same-title neighbour; no extra mail, unexpected requests or page errors.',
  );
} finally {
  await browser.close();
  await db.close();
}
