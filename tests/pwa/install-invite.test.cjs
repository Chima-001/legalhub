// Offline Node regressions. Actual IndexedDB transaction races and the Home UI run in browser-smoke.mjs.
'use strict';
const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  vm = require('node:vm'),
  fs = require('node:fs'),
  path = require('node:path'),
  { pathToFileURL } = require('node:url');
const pub = path.resolve(__dirname, '../../public'),
  home = fs.readFileSync(path.join(pub, 'index.html'), 'utf8'),
  code = fs.readFileSync(path.join(pub, 'pwa/register.js'), 'utf8');
const firstScript = /<script\b[^>]*>([\s\S]*?)<\/script>/i.exec(home);
test('Home latches normal entries before the existing scripts can rewrite callback URLs; stores a boolean only', () => {
  assert(firstScript);
  for (const url of [
    '',
    '#levels',
    '#resources',
    '#type=recovery&access_token=fixture',
    '#type=signup',
    '?code=fixture',
    '?error=fixture#resources',
    '#nonsection',
  ]) {
    const dataset = {};
    vm.runInNewContext(firstScript[1], {
      document: { documentElement: { dataset } },
      location: new URL('https://fixture.invalid/index.html' + url),
    });
    assert.deepEqual(dataset, ['', '#levels', '#resources'].includes(url) ? { lhInstallHome: '1' } : {}, url);
  }
});
test('Manual help covers iPhone, iPad desktop mode, Android and unavailable desktop installers', async () => {
  const { installDirections } = await import(pathToFileURL(path.join(pub, 'pwa/install-invite.mjs')));
  for (const nav of [
    { userAgent: 'iPhone OS 18' },
    { userAgent: 'Macintosh', platform: 'MacIntel', maxTouchPoints: 5 },
  ])
    assert.match(installDirections(nav), /Safari.*Share.*Add to Home Screen/);
  assert.match(installDirections({ userAgent: 'Android' }), /browser menu.*Add to Home screen/);
  assert.match(
    installDirections({ userAgent: 'Desktop', platform: 'MacIntel', maxTouchPoints: 0 }),
    /address bar.*bookmark/,
  );
});
class Target {
  events = {};
  addEventListener(k, f) {
    (this.events[k] ??= []).push(f);
  }
  async fire(k, e = {}) {
    await Promise.all((this.events[k] || []).map((f) => f(e)));
  }
}
function studyFixture(tail = 'study/', opts = {}) {
  const window = new Target(),
    install = new Target(),
    help = new Target();
  window.top = window;
  window.isSecureContext = true;
  window.matchMedia = () => ({ matches: !!opts.standalone });
  const base = 'https://fixture.invalid/public/',
    location = new URL(tail, base),
    navigator = { onLine: true };
  const document = {
    currentScript: { src: base + 'pwa/register.js' },
    documentElement: { dataset: opts.dataset || {} },
    querySelector: (k) => ({ '[data-lh-install]': install, '[data-lh-help]': help })[k],
  };
  // The VM deliberately has no worker. This also verifies that native/manual controls are independent of cache readiness.
  vm.runInNewContext(code, { window, document, navigator, location, URL });
  let calls = 0,
    prevented = 0;
  const event = (outcome = 'accepted') =>
    window.fire('beforeinstallprompt', {
      preventDefault: () => prevented++,
      prompt: () => {
        calls++;
        if (outcome === 'error') throw Error('fixture cancellation');
      },
      userChoice: Promise.resolve({ outcome }),
    });
  return { window, help, install, event, calls: () => calls, prevented: () => prevented };
}
test('Study still exposes the native action only on a real offer, consumes each event once and has a manual fallback', async () => {
  const f = studyFixture();
  assert.equal(f.install.hidden, true);
  assert.equal(f.help.hidden, false);
  await f.event();
  assert.equal(f.prevented(), 1);
  assert.equal(f.calls(), 0);
  assert.equal(f.install.hidden, false);
  await f.install.fire('click');
  await f.install.fire('click');
  assert.equal(f.calls(), 1);
  assert.equal(f.install.hidden, true);
  f.help.open = false;
  await f.event('error');
  await f.install.fire('click');
  assert.equal(f.calls(), 2);
  assert.equal(f.help.open, true);
  await f.window.fire('appinstalled');
  await f.event();
  assert.equal(f.install.hidden, true);
  assert.equal(f.help.hidden, true);
});
test('Callback, scrubbed/unknown Home, unrelated routes and installed Study do not intercept an install offer', async () => {
  for (const [url, opts] of [
    ['index.html', {}],
    ['index.html?code=fixture', { dataset: { lhInstallHome: '1' } }],
    ['index.html', { dataset: { lhInstallHome: '1', signupHandoff: '1' } }],
    ['study/#type=recovery', {}],
    ['pages/profile.html', {}],
    ['study/', { standalone: true }],
  ]) {
    const f = studyFixture(url, opts);
    await f.event();
    assert.equal(f.prevented(), 0, url);
    assert.equal(f.calls(), 0, url);
  }
});
