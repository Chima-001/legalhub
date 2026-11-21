// Uses browser-smoke's loopback server, real Home/Study and real IndexedDB. Never points at a hosted app.
import assert from 'node:assert/strict';
const card = '[data-lh-install-invite]',
  dbName = 'legalhub:install-invitation';
const shown = [['home-invite-v1', 1]];
async function flags(p) {
  return p.evaluate(async (name) => {
    if (!(await indexedDB.databases()).some((d) => d.name === name)) return [];
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(name);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result,
          tx = db.transaction('shown'),
          store = tx.objectStore('shown'),
          keys = store.getAllKeys(),
          vals = store.getAll();
        tx.oncomplete = () => {
          db.close();
          resolve(keys.result.map((v, i) => [v, vals.result[i]]));
        };
        tx.onabort = () => reject(tx.error);
      };
    });
  }, dbName);
}
async function noCard(p) {
  // Negative checks allow more than a full invitation debounce after the page condition under test.
  await p.waitForTimeout(800);
  assert.equal(await p.locator(card).count(), 0, p.url());
}
async function offer(p, outcome = 'accepted') {
  return p.evaluate((outcome) => {
    window.__installCalls = [];
    const event = new Event('beforeinstallprompt', { cancelable: true });
    event.prompt = () => {
      window.__installCalls.push({ active: navigator.userActivation.isActive });
      if (outcome === 'error') return Promise.reject(Error('unavailable fixture'));
      return Promise.resolve();
    };
    event.userChoice = Promise.resolve({ outcome });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  }, outcome);
}
const calls = (p) => p.evaluate(() => window.__installCalls);
async function release(p) {
  await p.evaluate(() => {
    window.__releaseInviteAuth?.();
    document.getElementById('fixture-splash')?.remove();
    window.__testHidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
  });
}
export async function runInviteChecks({ context, origin, offline }) {
  async function fresh(opts = {}) {
    const c = await context(opts.width || 390);
    await c.addInitScript((opts) => {
      // Headless Chrome's own installability heuristics vary. Inject events only for explicit native-path cases.
      addEventListener(
        'beforeinstallprompt',
        (e) => {
          if (e.isTrusted) {
            e.preventDefault();
            e.stopImmediatePropagation();
          }
        },
        true,
      );
      window.__holdInviteAuth = !!opts.hold;
      window.__testHidden = !!opts.hold;
      if (opts.hold) {
        Object.defineProperty(document, 'visibilityState', {
          get: () => (window.__testHidden ? 'hidden' : 'visible'),
        });
        document.addEventListener('DOMContentLoaded', () => {
          const s = document.createElement('style');
          s.id = 'fixture-splash';
          s.textContent =
            '#preloader{display:block!important;visibility:visible!important;opacity:1!important}';
          document.head.append(s);
        });
      }
      if (opts.ios)
        Object.defineProperty(navigator, 'userAgent', {
          value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
        });
      if (opts.standalone === 'ios') Object.defineProperty(navigator, 'standalone', { value: true });
      if (opts.standalone === 'display') {
        const base = window.matchMedia.bind(window);
        window.matchMedia = (q) =>
          q.includes('display-mode: standalone') ? { matches: true, addEventListener() {} } : base(q);
      }
      if (opts.storage === 'denied')
        Object.defineProperty(window, 'indexedDB', {
          get() {
            throw new DOMException('fixture storage denied', 'SecurityError');
          },
        });
      if (opts.worker === 'unsupported') delete Object.getPrototypeOf(navigator).serviceWorker;
    }, opts);
    const p = await c.newPage();
    p.setDefaultTimeout(7500);
    return { p, c };
  }
  // Close/dismiss on one mount; reloading, another tab and the other mount share the same preference.
  for (const [mount, width] of [
    ['/public/', 375],
    ['/', 1200],
  ]) {
    const { p, c } = await fresh({ width, ios: width === 375, hold: true }),
      url = origin + mount;
    await p.goto(url + 'index.html#resources');
    await p.waitForFunction(
      async (name) => (await indexedDB.databases()).some((d) => d.name === name),
      dbName,
    );
    await noCard(p);
    assert.deepEqual(await flags(p), []);
    await p.evaluate(() => {
      window.__testHidden = false;
      document.dispatchEvent(new Event('visibilitychange'));
      document.body.style.visibility = 'visible';
    });
    assert.equal(await p.locator('#auth-page-blocker').count(), 1);
    await noCard(p);
    await p.evaluate(() => window.__releaseInviteAuth());
    await noCard(p); // preloader still on top
    await p.evaluate(() => {
      window.__testHidden = true;
      document.getElementById('fixture-splash').remove();
    });
    await noCard(p); // background tab
    await p.locator('#offline-study-link').focus();
    await release(p);
    const box = p.locator(card);
    await box.waitFor({ state: 'visible' });
    assert.equal(await p.evaluate(() => document.activeElement.id), 'offline-study-link');
    assert.equal(new URL(p.url()).hash, '#resources');
    assert.deepEqual(await flags(p), shown);
    const rect = await box.boundingBox();
    assert(rect.x >= 0 && rect.x + rect.width <= width + 1);
    const help = box.getByRole('button', { name: 'How to install' });
    await help.click();
    assert(
      (await box.locator('#lh-invite-steps').innerText()).includes(
        width === 375 ? 'Tap Share' : 'address bar',
      ),
    );
    assert.equal(
      await box.locator('[aria-controls="lh-invite-steps"]').getAttribute('aria-expanded'),
      'true',
    );
    if (width === 375) await box.getByRole('button', { name: 'Got it' }).click();
    else await p.keyboard.press('Escape');
    assert.equal(await box.count(), 0);
    assert.equal(await p.evaluate(() => document.activeElement.id), 'offline-study-link');
    await p.reload();
    await release(p);
    await noCard(p);
    const tab = await c.newPage();
    await tab.goto(origin + (mount === '/' ? '/public/' : '/') + 'index.html');
    await release(tab);
    await noCard(tab);
    await tab.goto(url + 'study/');
    await tab.getByText('Public guides ready on this device', { exact: true }).waitFor();
    await noCard(tab);
    assert(await tab.locator('[data-lh-help] summary').isVisible());
    assert(await offer(tab));
    assert.deepEqual(await calls(tab), []);
    await tab.getByRole('button', { name: 'Install LegalHub', exact: true }).click();
    assert.deepEqual(await calls(tab), [{ active: true }]);
    await c.close();
    console.log(
      `PASS ${mount} ${width}px: first Home after auth/splash/visibility, one durable flag; accessible manual help/dismissal, reload/tab/other mount quiet; Study install remains.`,
    );
  }
  for (const outcome of ['accepted', 'dismissed', 'error']) {
    const { p, c } = await fresh({ hold: outcome === 'accepted' });
    await p.goto(origin + '/index.html');
    const box = p.locator(card);
    if (outcome === 'accepted') {
      assert(await offer(p, outcome));
      await release(p);
    } else {
      await box.waitFor();
      assert(await offer(p, outcome));
    }
    await box.getByRole('button', { name: 'Install LegalHub', exact: true }).waitFor();
    assert.deepEqual(await calls(p), []);
    await box.getByRole('button', { name: 'Install LegalHub', exact: true }).click();
    assert.deepEqual(await calls(p), [{ active: true }]);
    if (outcome === 'error') {
      await box.locator('#lh-invite-steps').waitFor();
      await box.getByRole('button', { name: 'Got it' }).click();
    }
    await box.waitFor({ state: 'detached' });
    assert.deepEqual(await flags(p), shown);
    await p.reload();
    await release(p);
    await noCard(p);
    await c.close();
  }
  console.log(
    'PASS early and late native offers: no unsolicited prompt, one call in the user gesture; accept, decline and rejected-prompt manual recovery (injected choices).',
  );
  {
    const { p, c } = await fresh();
    for (const suffix of [
      '#access_token=fixture&type=recovery',
      '?code=invite-fixture',
      '#type=signup&access_token=fixture',
    ]) {
      await p.goto(origin + '/index.html' + suffix, { waitUntil: 'commit' }).catch((e) => {
        if (!e.message.includes('net::ERR_ABORTED')) throw e;
      });
      if (suffix.includes('type=signup')) await p.waitForURL('**/pages/confirmed.html*');
      else await p.waitForLoadState('load');
      await noCard(p);
      assert.deepEqual(await flags(p), []);
      assert(!(await offer(p)));
      if (suffix.includes('type=recovery')) assert.equal(new URL(p.url()).hash, ''); // real Home cleared the fragment
    }
    await p.goto(origin + '/study/');
    await p.getByText('Public guides ready on this device', { exact: true }).waitFor();
    await noCard(p);
    assert.deepEqual(await flags(p), []);
    await offline(c, true);
    const res = await p.goto(origin + '/index.html');
    assert.equal(res.status(), 503);
    await noCard(p);
    await p.getByRole('link', { name: 'Open public study guides' }).click();
    await noCard(p);
    assert.deepEqual(await flags(p), []);
    await offline(c, false);
    await p.goto(origin + '/index.html');
    await p.locator(card).waitFor();
    await p.reload();
    await noCard(p);
    assert.deepEqual(await flags(p), shown); // no button pressed: appearing already counts
    await c.close();
  }
  console.log(
    'PASS scrubbed recovery fragment, signup handoff, query callback, Study-first and offline launches do not consume the invitation; reconnecting to normal Home does.',
  );
  for (const standalone of ['ios', 'display']) {
    const { p, c } = await fresh({ standalone });
    await p.goto(origin + '/index.html');
    await noCard(p);
    assert.deepEqual(await flags(p), shown);
    assert(!(await offer(p)));
    await c.close();
  }
  {
    const { p, c } = await fresh();
    await p.goto(origin + '/study/');
    await p.getByText('Public guides ready on this device', { exact: true }).waitFor();
    await p.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
    await p.waitForFunction(
      async (name) => (await indexedDB.databases()).some((d) => d.name === name),
      dbName,
    );
    assert.deepEqual(await flags(p), shown);
    await p.goto(origin + '/index.html');
    await noCard(p);
    await c.close();
  }
  {
    const { p, c } = await fresh({ storage: 'denied' });
    await p.goto(origin + '/index.html');
    await noCard(p);
    await p.reload();
    await noCard(p);
    await p.goto(origin + '/study/');
    await p.locator('[data-lh-help] summary').click();
    assert(await p.locator('[data-lh-help] p').isVisible());
    await c.close();
  }
  {
    const { p, c } = await fresh({ worker: 'unsupported' });
    await p.goto(origin + '/index.html');
    assert.equal(await p.evaluate(() => 'serviceWorker' in navigator), false);
    await p.locator(card).getByRole('button', { name: 'How to install' }).click();
    assert((await p.locator('#lh-invite-steps').innerText()).includes('bookmark'));
    await c.close();
  }
  console.log(
    'PASS iOS/desktop installed-mode signals and observed Study installation suppress Home; storage refusal skips a recurring card; no-worker browser gets honest manual help.',
  );
  {
    const { p, c } = await fresh({ hold: true }),
      q = await c.newPage();
    await Promise.all([p.goto(origin + '/index.html'), q.goto(origin + '/index.html')]);
    await Promise.all(
      [p, q].map((t) =>
        t.waitForFunction(async (name) => (await indexedDB.databases()).some((d) => d.name === name), dbName),
      ),
    );
    await Promise.all([release(p), release(q)]);
    await Promise.any([p.locator(card).waitFor(), q.locator(card).waitFor()]);
    await p.waitForTimeout(1000);
    assert.equal((await p.locator(card).count()) + (await q.locator(card).count()), 1);
    assert.deepEqual(await flags(p), shown);
    assert.deepEqual(await flags(q), shown);
    await c.close();
  }
  console.log(
    'PASS two concurrent eligible Home tabs race on real IndexedDB: only one invitation and one fixed, non-identifying preference.',
  );
}
