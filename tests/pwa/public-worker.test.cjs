// Real worker script, in-memory CacheStorage/event doubles. No network or service credentials.
const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  vm = require('node:vm'),
  fs = require('node:fs'),
  path = require('node:path');
const root = path.resolve(__dirname, '../../public'),
  text = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const keys = [
  'study/index.html',
  'pwa/study.css',
  'pwa/register.js',
  'manifest.webmanifest',
  'pwa/lh-192.png',
  'pwa/lh-512.png',
];
function fixture(mount = '/public/', fail = false) {
  const origin = 'https://fixture.invalid',
    scope = origin + mount,
    events = {},
    names = new Map(),
    calls = [];
  let claimed = 0,
    network = () => new Response('fixture account content');
  const c = {
    open: async (name) => {
      if (!names.has(name)) {
        const entries = new Map();
        names.set(name, {
          entries,
          put: async (k, r) => {
            if (fail) throw Error('fixture quota');
            entries.set(k, r.clone());
          },
          match: async (k) => entries.get(k)?.clone(),
        });
      }
      return names.get(name);
    },
    keys: async () => [...names.keys()],
    delete: async (k) => names.delete(k),
  };
  const self = {
    registration: { scope },
    clients: {
      claim: async () => {
        claimed++;
      },
    },
    addEventListener: (type, cb) => (events[type] = cb),
  };
  const ctx = vm.createContext({
    self,
    caches: c,
    Response,
    URL,
    Uint8Array,
    atob,
    fetch: async (req, opt) => {
      calls.push([req, opt]);
      return network(req);
    },
    importScripts: (u) => {
      assert.equal(u, './pwa/public-pack.js');
      vm.runInContext(text('pwa/public-pack.js'), ctx);
    },
  });
  vm.runInContext(text('sw.js'), ctx);
  async function fire(t, extras = {}) {
    let wait;
    events[t]({ ...extras, waitUntil: (p) => (wait = p) });
    await wait;
  }
  function request(url, options = {}) {
    let res;
    events.fetch({
      request: {
        url: new URL(url, scope).href,
        method: 'GET',
        mode: 'navigate',
        headers: new Headers(),
        ...options,
      },
      respondWith: (p) => (res = Promise.resolve(p)),
    });
    return res;
  }
  return {
    scope,
    calls,
    c,
    names,
    fire,
    request,
    claimed: () => claimed,
    network: (fn) => {
      network = fn;
    },
    message: async (data, other = {}) => {
      let result;
      await fire('message', { origin, ports: [{ postMessage: (r) => (result = r) }], data, ...other });
      return result;
    },
  };
}
test('Install seeds six packaged public assets, no network; cold failure is not a ready state', async () => {
  for (const mount of ['/', '/public/']) {
    const f = fixture(mount);
    await f.fire('install');
    const [[, cache]] = f.names;
    assert.deepEqual([...cache.entries.keys()].sort(), keys.map((p) => f.scope + p).sort());
    assert.equal(f.calls.length, 0);
    for (const k of keys) {
      const res = await f.request(k);
      const b = Buffer.from(await res.arrayBuffer());
      assert.deepEqual(
        k.endsWith('.png') ? b.toString('base64') : b.toString().replace(/\r\n/g, '\n'),
        k.endsWith('.png')
          ? fs.readFileSync(path.join(root, k)).toString('base64')
          : text(k).replace(/\r\n/g, '\n'),
      );
    }
    assert.equal((await f.message({ type: 'LH_STUDY_STATUS' })).ready, true);
  }
  const bad = fixture('/', true);
  await assert.rejects(bad.fire('install'));
  assert.equal((await bad.message({ type: 'LH_STUDY_STATUS' })).ready, false);
});
test('Only obsolete caches for this exact app and mount are cleared; eviction restores only bundled bytes', async () => {
  const f = fixture(),
    prefix = 'legalhub:public-study:%2Fpublic%2F:';
  await f.c.open(prefix + '0-old');
  await f.c.open('legalhub:public-study:%2F:other');
  await f.c.open('unrelated');
  await f.fire('install');
  await f.fire('activate');
  assert(!f.names.has(prefix + '0-old'));
  assert(f.names.has('unrelated'));
  assert(f.names.has('legalhub:public-study:%2F:other'));
  assert.equal(f.claimed(), 1);
  const cache = [...f.names.values()].at(-1);
  cache.entries.delete(f.scope + 'study/index.html');
  assert.match(await (await f.request('study/')).text(), /Brief a case in six lines/);
  assert.equal(cache.entries.size, 6);
  assert.equal(f.calls.length, 0);
});
test('Home goes to network, never a saved user dashboard; offline fallback only on fetch rejection, not 401/503', async () => {
  const f = fixture();
  await f.fire('install');
  for (const p of ['', 'index.html', 'index']) {
    assert.equal(await (await f.request(p)).text(), 'fixture account content');
  }
  assert(f.calls.every(([, v]) => v.cache === 'no-store'));
  for (const n of [401, 403, 404, 503]) {
    f.network(() => new Response('server status', { status: n }));
    assert.equal(await (await f.request('index.html')).text(), 'server status');
  }
  f.network(() => {
    throw Error('fixture offline');
  });
  assert.match(await (await f.request('index.html')).text(), /Keep studying offline/);
  assert.equal([...f.names.values()][0].entries.size, 6);
});
test('Private pages, GET queries, auth headers, cross-origin, ranges, signed resources and every write bypass the worker', async () => {
  const f = fixture();
  await f.fire('install');
  for (const p of [
    'pages/profile.html',
    'pages/pdf.html',
    'pages/semester.html?level=300L',
    'pages/materials.html',
    'pages/admin-settings.html',
    'pages/login.html',
    'pages/confirmed.html?code=fixture',
    'pages/update-password.html',
    'index.html?code=fixture',
    'study/?token=fixture',
    'pwa/study.css?v=fixture',
    'pwa/install-invite.mjs',
    'pwa/install-invite.css',
    'rest/v1/materials',
    'auth/v1/token',
    'functions/v1/r2-presign',
    'functions/v1/notify-admins-on-upload',
    'assets/pdfs/fixture.pdf',
    'https://storage.invalid/sample?sig=fixture',
    'https://cdn.invalid/sdk.js',
    '/outside/manifest.webmanifest',
  ])
    assert.equal(f.request(p), undefined, p);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
    assert.equal(f.request('study/index.html', { method }), undefined);
  for (const name of ['Authorization', 'apikey', 'Range', 'x-client-info'])
    assert.equal(
      f.request('manifest.webmanifest', { headers: new Headers({ [name]: 'fixture' }) }),
      undefined,
    );
  assert.equal(await f.message({ type: 'SAVE_URL', url: 'requested-private-file' }), undefined);
  assert.equal(
    await f.message({ type: 'LH_STUDY_STATUS' }, { origin: 'https://other.invalid' }),
    undefined,
  );
  assert.equal(f.calls.length, 0);
  const [[, cache]] = f.names;
  assert.equal(cache.entries.size, 6);
});
test('Manifest, icons, Home and guide links resolve at both deployment mounts; stable default install ID is the scoped start URL', () => {
  const manifest = JSON.parse(text('manifest.webmanifest')),
    home = text('index.html'),
    guide = text('study/index.html');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.id, undefined);
  assert.match(home, /rel="manifest" href="\.\/manifest.webmanifest"/);
  assert.match(home, /href="\.\/study\/"/);
  assert.match(guide, /href="\.\.\/manifest.webmanifest"/);
  assert(!/supabase|https?:\/\/|<form\b/i.test(guide));
  for (const mount of ['/', '/public/']) {
    const base = 'https://fixture.invalid' + mount,
      m = new URL('manifest.webmanifest', base);
    assert.equal(new URL(manifest.start_url, m).href, base + 'index.html');
    assert.equal(new URL(manifest.scope, m).href, base);
    for (const i of manifest.icons) {
      const file = fs.readFileSync(path.join(root, i.src));
      const n = file.readUInt32BE(16);
      assert.equal(file.readUInt32BE(20), n);
      assert.equal(i.sizes, `${n}x${n}`);
      assert(new URL(i.src, m).href.startsWith(base + 'pwa/'));
    }
  }
});
