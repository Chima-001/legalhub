// One loopback-only HTTP origin and an actual service worker. Only approved static files are served;
// private pages/API responses are synthetic, external networking is blocked and no production SDK is loaded.
import http from 'node:http';
import { runInviteChecks } from './install-invite.browser.mjs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire(new URL('../materials/browser/package.json', import.meta.url))(
  'playwright-core',
);
if (!process.env.LEGALHUB_TEST_CHROME)
  throw Error('Set LEGALHUB_TEST_CHROME to a local Chrome/Chromium executable, not a website.');
const pub = fileURLToPath(new URL('../../public/', import.meta.url)),
  actual = new Set([
    'sw.js',
    'index.html',
    'study/index.html',
    'pwa/public-pack.js',
    'pwa/study.css',
    'pwa/register.js',
    'pwa/install-invite.mjs',
    'pwa/install-invite.css',
    'manifest.webmanifest',
    'pwa/lh-192.png',
    'pwa/lh-512.png',
  ]);
let down = false,
  upgrade = false,
  denyHome = false,
  writes = 0;
const httpHits = [],
  errors = [],
  foreign = [];
const server = http.createServer(async (req, res) => {
  try {
    if (down) {
      req.socket.destroy();
      return;
    }
    const u = new URL(req.url, 'http://127.0.0.1'),
      rel = u.pathname.replace(/^\/(?:public\/)?/, '');
    httpHits.push(u.pathname);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; worker-src 'self'; img-src 'self' data:; base-uri 'none'",
    );
    const send = (type, body, status = 200) => {
      res.writeHead(status, { 'Content-Type': type });
      res.end(body);
    };
    if (req.method !== 'GET') {
      writes++;
      return send('application/json', '{"fixture":true}');
    }
    if (rel === 'seed-fixture') return send('text/html', '<!doctype html><title>Setup</title>');
    if ((rel === 'index.html' || rel === '') && u.search && u.search !== '?code=invite-fixture')
      return send('text/html', '<!doctype html><title>Fixture callback</title>Callback requires the network');
    if ((rel === 'index.html' || rel === '') && denyHome)
      return send('text/plain', 'Fixture permission denied', 403);
    const key = rel === '' ? 'index.html' : rel === 'study/' ? 'study/index.html' : rel;
    if (actual.has(key)) {
      let content = await readFile(path.join(pub, key));
      if (upgrade && key === 'pwa/public-pack.js') {
        content = content
          .toString()
          .replace(/"revision":"[0-9a-f]{20}"/, '"revision":"01122334455667788990"')
          .replace('The study<br>', 'The updated study<br>');
      }
      return send(
        {
          '.js': 'application/javascript',
          '.mjs': 'application/javascript',
          '.html': 'text/html; charset=utf-8',
          '.css': 'text/css',
          '.png': 'image/png',
          '.webmanifest': 'application/manifest+json',
        }[path.extname(key)],
        content,
      );
    }
    if (rel === 'scripts/avatar.js') return send('application/javascript', 'window.loadHeaderAvatar=()=>{};');
    if (rel === 'scripts/auth/auth-guard.js')
      return send(
        'application/javascript',
        `if(window.__holdInviteAuth){const guard=document.createElement('style');guard.id='auth-page-blocker';document.head.append(guard);}
         window.__releaseInviteAuth=()=>{document.getElementById('auth-page-blocker')?.remove();document.body.style.visibility='visible';};
         document.addEventListener('DOMContentLoaded',()=>{if(!window.__holdInviteAuth)window.__releaseInviteAuth();});`,
      );
    if (rel.startsWith('scripts/'))
      return send('application/javascript', '/* fixture: never load a project client */');
    if (rel.startsWith('styles/')) return send('text/css', '.preloader{display:none}');
    if (rel.startsWith('assets/images/'))
      return send('image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg"/>');
    if (rel.startsWith('pages/') || rel.startsWith('rest/v1/') || rel === 'signed/sample.pdf')
      return send('text/plain', 'Private fixture response; do not save');
    return send('text/plain', 'Not found', 404);
  } catch {
    res.destroy();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = 'http://127.0.0.1:' + server.address().port;
let browser;
try {
  browser = await chromium.launch({
    executablePath: process.env.LEGALHUB_TEST_CHROME,
    args: [
      '--disable-dev-shm-usage',
      '--no-sandbox',
      '--disable-background-networking',
      '--no-proxy-server',
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
    ],
  });
  const context = async (width) => {
    const c = await browser.newContext({ serviceWorkers: 'allow', viewport: { width, height: 850 } });
    await c.route('**/*', (r) => {
      const u = new URL(r.request().url());
      if (u.origin !== origin) {
        foreign.push(u.origin);
        return r.abort();
      }
      return r.continue();
    });
    c.on('page', (p) => p.on('pageerror', (e) => errors.push(e.message)));
    return c;
  };
  const offline = async (c, v) => {
    down = v;
    await c.setOffline(v);
  };
  for (const [mount, width] of [
    ['/public/', 375],
    ['/', 1200],
  ]) {
    upgrade = false;
    down = false;
    const c = await context(width),
      url = origin + mount;
    const p = await c.newPage();
    p.setDefaultTimeout(9000);
    await p.goto(url + 'seed-fixture');
    await p.evaluate(
      async (prefix) => {
        await caches.open(prefix + '0-retired');
        await caches.open('other-application-fixture');
      },
      'legalhub:public-study:' + encodeURIComponent(mount) + ':',
    );
    await p.goto(url + 'index.html');
    await p.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await p.locator('#offline-study-link').click();
    await p.getByText('Public guides ready on this device', { exact: true }).waitFor();
    assert.equal(await p.locator('h1').innerText(), 'The study\nfield guide.');
    assert(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)));
    const manifest = await p.evaluate(async () => {
      const u = document.querySelector('[rel=manifest]').href,
        m = await (await fetch(u)).json();
      return { scope: new URL(m.scope, u).href, start: new URL(m.start_url, u).href };
    });
    assert.equal(manifest.scope, url);
    assert.equal(manifest.start, url + 'index.html');
    const cdp = await c.newCDPSession(p);
    const parsed = await cdp.send('Page.getAppManifest');
    assert.equal(parsed.errors.filter((e) => e.critical).length, 0);
    assert.equal(JSON.parse(parsed.data).short_name, 'LegalHub');
    await cdp.detach();
    const assets = async (page) =>
      page.evaluate(async () => {
        const names = await caches.keys();
        const mine = names.filter((k) => k.startsWith('legalhub:public-study:'));
        const keys = await Promise.all(
          mine.map(async (k) => (await (await caches.open(k)).keys()).map((r) => new URL(r.url).pathname)),
        );
        return { names, mine, keys: keys.flat().sort() };
      });
    const list = await assets(p);
    assert(list.names.includes('other-application-fixture'));
    assert.equal(list.mine.length, 1);
    assert.equal(list.keys.length, 6);
    assert(!list.names.some((k) => k.endsWith('retired')));
    await p.evaluate(async (base) => {
      for (const route of [
        'pages/profile.html',
        'pages/pdf.html',
        'pages/materials.html',
        'pages/admin-settings.html',
        'rest/v1/materials',
        'signed/sample.pdf?sig=fixture',
      ]) {
        const r = await fetch(base + route, { cache: 'no-store' });
        if (!(await r.text()).includes('Private fixture')) throw Error('fixture read missing');
      }
    }, url);
    assert.deepEqual(await assets(p), list);
    await offline(c, true);
    const other = await c.newPage();
    other.setDefaultTimeout(8000);
    const home = await other.goto(manifest.start);
    assert.equal(home.status(), 503);
    await other.getByRole('link', { name: 'Open public study guides' }).click();
    await other.getByText('Offline · public guides ready', { exact: true }).waitFor();
    await other.locator('#problem summary').click();
    await other.getByText('No. Dispatch alone', { exact: false }).waitFor();
    await other.reload();
    await other.getByText('Offline · public guides ready', { exact: true }).waitFor();
    assert(!(await other.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)));
    const denied = await other.evaluate(async (base) => {
      const results = [];
      for (const path of [
        'pages/profile.html',
        'pages/pdf.html',
        'pages/admin-settings.html',
        'pages/login.html',
        'index.html?code=fixture',
        'signed/sample.pdf?sig=fixture',
      ]) {
        try {
          await fetch(base + path, { cache: 'no-store' });
          results.push('responded');
        } catch {
          results.push('offline');
        }
      }
      try {
        await fetch(base + 'rest/v1/materials', { method: 'POST', body: 'fixture' });
        results.push('queued');
      } catch {
        results.push('offline');
      }
      return results;
    }, url);
    assert(denied.every((v) => v === 'offline'));
    assert.equal(writes, 0);
    assert.deepEqual(await assets(other), list);
    await offline(c, false);
    await other.getByText('Public guides ready on this device', { exact: true }).waitFor();
    denyHome = true;
    const deniedHome = await other.goto(manifest.start);
    assert.equal(deniedHome.status(), 403);
    assert.match(await other.locator('body').innerText(), /Fixture permission denied/);
    denyHome = false;
    assert.equal(writes, 0);
    console.log(
      `PASS ${mount} (${width}px): real Home → Study, manifest, only six public cache entries, offline relaunch and drills, no stored private reads or queued writes; real online denial stays a denial.`,
    );
    if (mount === '/public/') {
      upgrade = true;
      await p.evaluate(async () => {
        const reg = await navigator.serviceWorker.ready;
        await reg.update();
      });
      await p.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting);
      assert.match(await p.locator('h1').innerText(), /The study/);
      await p.goto('about:blank');
      await other.goto('about:blank');
      const next = await c.newPage();
      await next.goto(url + 'study/');
      await next.waitForFunction(async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        return (
          reg?.active && !reg.waiting && (await caches.keys()).some((n) => n.endsWith('01122334455667788990'))
        );
      });
      await next.reload();
      await next.getByText('Public guides ready on this device', { exact: true }).waitFor();
      assert.match(await next.locator('h1').innerText(), /updated study/);
      const updated = await assets(next);
      assert.equal(updated.mine.length, 1);
      assert.notEqual(updated.mine[0], list.mine[0]);
      assert(updated.names.includes('other-application-fixture'));
      console.log(
        'PASS version update waits for old tabs, then serves the new edition and clears only that mount’s superseded public pack.',
      );
    }
    await c.close();
  }
  upgrade = false;
  down = false;
  await runInviteChecks({ context, origin, offline });
  // A new browser partition cannot have an offline first visit.
  const fresh = await context(390);
  await offline(fresh, true);
  const q = await fresh.newPage();
  await assert.rejects(q.goto(origin + '/study/', { timeout: 5000 }));
  await fresh.close();
  assert.equal(writes, 0);
  assert.deepEqual(foreign, []);
  assert.deepEqual(errors, []);
  console.log('PASS first-ever offline visit is not promised; no external requests or page errors.');
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
}
