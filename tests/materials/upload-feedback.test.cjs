// Real page handler with an in-memory DOM, a fake clock and synthetic upload/storage receipts.
// No test invokes an Edge Function, connects to storage, or writes a real material.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '../../public/pages/materials.html'), 'utf8');
const scripts = [...html.matchAll(/<script\s*>([\s\S]*?)<\/script\s*>/gi)].filter((m) =>
  m[1].includes('let currentUserId = null;'),
);
assert.equal(scripts.length, 1);
const turn = () => new Promise((resolve) => setImmediate(resolve));
function gate() {
  let resolve;
  return {
    promise: new Promise((r) => {
      resolve = r;
    }),
    release: () => resolve(),
  };
}
function control(file = false) {
  const handlers = {},
    attrs = {};
  let value = '';
  return {
    handlers,
    attrs,
    textContent: '',
    files: [],
    disabled: false,
    classList: { remove() {} },
    get value() {
      return value;
    },
    set value(v) {
      value = v;
      if (file && v === '') this.files = [];
    },
    addEventListener(k, f) {
      handlers[k] = f;
    },
    fire(k) {
      return handlers[k]({ target: this });
    },
    setAttribute(k, v) {
      attrs[k] = v;
    },
    replaceChildren() {},
  };
}
async function page(config = {}) {
  const nodes = new Map(
    [...html.matchAll(/\bid="([\w-]+)"/g)].map((m) => [m[1], control(m[1] === 'file-input')]),
  );
  const get = (id) => {
    assert(nodes.has(id));
    return nodes.get(id);
  };
  const calls = [],
    timers = [];
  const user = { id: 'fixture-reader' };
  const supabaseClient = {
    auth: {
      getSession: async () => ({ data: { session: { user } } }),
      getUser: async () => ({ data: { user: config.switched ? { id: 'other' } : user } }),
    },
    functions: {
      async invoke(n, { body }) {
        assert.equal(n, 'r2-presign');
        assert.equal(body.action, 'upload');
        calls.push(['sign', body]);
        if (config.signThrow) throw Error();
        return config.signBad
          ? { error: {} }
          : { data: { key: 'fixture-path/scan.pdf', uploadUrl: 'https://storage.invalid/upload' } };
      },
    },
    from(n) {
      if (n === 'users')
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          single: async () => ({ data: { is_admin: false } }),
        };
      assert.equal(n, 'materials');
      return {
        async insert(body) {
          calls.push(['log', body]);
          await config.logGate?.promise;
          if (config.logThrow) throw Error();
          return config.receipt || { error: null, status: 201 };
        },
      };
    },
  };
  vm.runInNewContext(scripts[0][1], {
    document: { getElementById: get },
    supabaseClient,
    renderAvatar() {},
    Option: class {},
    async fetch(url, init) {
      assert.equal(url, 'https://storage.invalid/upload');
      assert.equal(init.method, 'PUT');
      calls.push(['put']);
      await config.putGate?.promise;
      if (config.putThrow) throw Error();
      return config.putBad ? { ok: false, status: 503 } : { ok: true, status: 200 };
    },
    setTimeout(cb, ms) {
      const t = { cb, ms, active: true };
      timers.push(t);
      return t;
    },
    clearTimeout(t) {
      if (t) t.active = false;
    },
  });
  await turn();
  function fill(title = 'Evidence & Proof', name = 'scanner-791.pdf', type = 'application/pdf') {
    get('material-name-input').value = title;
    get('level-input').value = 'relevant';
    get('file-input').files = [{ name, type }];
    get('file-input').fire('change');
  }
  return {
    get,
    fill,
    submit: () => get('submit-upload-btn').fire('click'),
    calls,
    timers,
    note: () => get('upload-status').textContent,
  };
}
test('Uses the typed material name (not filename); no success until both PUT and pending INSERT are acknowledged', async () => {
  const putGate = gate(),
    logGate = gate(),
    v = await page({ putGate, logGate });
  const title = 'Evidence <Casebook> & Proof';
  v.fill('  ' + title + '  ');
  const job = v.submit();
  await turn();
  assert.equal(v.note(), 'Uploading PDF…');
  assert.equal(v.get('submit-upload-btn').disabled, true);
  await v.submit();
  assert.deepEqual(
    v.calls.map((x) => x[0]),
    ['sign', 'put'],
  );
  putGate.release();
  await turn();
  assert.equal(v.note(), 'Saving the material for review…');
  assert.equal(v.timers.length, 0);
  const row = JSON.parse(JSON.stringify(v.calls[2][1]));
  assert.deepEqual(row, {
    file_name: 'scanner-791.pdf',
    material_name: title,
    level: 'relevant',
    semester: 'all',
    course: 'relevant materials',
    status: 'pending',
    storage_path: 'fixture-path/scan.pdf',
    uploaded_by: 'fixture-reader',
  });
  logGate.release();
  await job;
  assert.equal(v.note(), title + ' uploaded! Waiting for admin approval.');
  assert.equal(v.get('upload-status').attrs.role, 'status');
  assert.equal(v.get('material-name-input').value, '');
  assert.equal(v.get('submit-upload-btn').disabled, true);
  assert.equal(v.timers.length, 1);
  assert.equal(v.timers[0].ms, 7000);
  v.timers[0].cb();
  assert.equal(v.note(), '');
});
test('Validation and account switch do not send a file or show a success', async () => {
  const v = await page({ switched: true });
  v.fill('Notes', 'scan.png', 'image/png');
  await v.submit();
  assert.match(v.note(), /Only PDF/);
  v.fill('   ');
  await v.submit();
  assert.match(v.note(), /Add a material name/);
  v.fill();
  await v.submit();
  assert.match(v.note(), /verify your account/);
  assert.equal(v.calls.length, 0);
  assert.equal(v.timers.length, 0);
});
test('Failed preparation, PUT, and log receipts are distinct from success; the draft is not erased', async () => {
  for (const [config, count, rx] of [
    [{ signThrow: true }, 1, /Could not finish/],
    [{ signBad: true }, 1, /prepare/],
    [{ putThrow: true }, 2, /Could not finish/],
    [{ putBad: true }, 2, /HTTP 503/],
    [{ logThrow: true }, 3, /record was not confirmed/],
    [{ receipt: { error: { message: 'not allowed' }, status: 403 } }, 3, /record was not confirmed/],
    [{ receipt: {} }, 3, /record was not confirmed/],
  ]) {
    const v = await page(config);
    v.fill();
    await v.submit();
    assert.match(v.note(), rx);
    assert.equal(v.calls.length, count);
    assert.equal(v.timers.length, 0);
    assert.equal(v.get('material-name-input').value, 'Evidence & Proof');
    assert.equal(v.get('submit-upload-btn').disabled, false);
  }
});
test('An old dismissal cannot erase a later success, progress note or error', async () => {
  const config = {},
    v = await page(config);
  v.fill('First');
  await v.submit();
  const first = v.timers[0];
  v.fill('Second');
  const hold = gate();
  config.logGate = hold;
  const save = v.submit();
  await turn();
  first.cb();
  assert.equal(v.note(), 'Saving the material for review…');
  hold.release();
  await save;
  first.cb();
  assert.equal(v.note(), 'Second uploaded! Waiting for admin approval.');
  const second = v.timers.at(-1);
  v.fill('Missing', 'note.txt', 'text/plain');
  await v.submit();
  first.cb();
  second.cb();
  assert.match(v.note(), /Only PDF/);
});
