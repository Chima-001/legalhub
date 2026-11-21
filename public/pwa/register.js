// Same script on Home and the public reading page. No Auth SDK, cookies, accounts or storage keys.
(() => {
  'use strict';
  const src = document.currentScript?.src;
  if (
    !src ||
    location.search ||
    document.documentElement.dataset.signupHandoff === '1' ||
    location.hash.includes('=')
  )
    return;
  const root = new URL('../', src),
    worker = new URL('sw.js', root);
  if (root.origin !== location.origin) return;
  const note = document.querySelector('[data-lh-state]'),
    install = document.querySelector('[data-lh-install]'),
    help = document.querySelector('[data-lh-help]');
  let available = false,
    pendingPrompt,
    epoch = 0;
  const installed = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  function controls() {
    if (install) install.hidden = !pendingPrompt || installed();
    if (help) help.hidden = installed();
  }
  if (install) {
    controls();
    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      pendingPrompt = event;
      controls();
    });
    install.addEventListener('click', async () => {
      const p = pendingPrompt;
      if (!p) return;
      pendingPrompt = null;
      controls();
      try {
        await p.prompt();
        await p.userChoice;
      } catch {
        /* The browser menu remains available. */
      }
    });
    window.addEventListener('appinstalled', () => {
      pendingPrompt = null;
      controls();
      if (help) help.hidden = true;
    });
  }
  function display(reason) {
    if (!note) return;
    note.textContent = available
      ? navigator.onLine === false
        ? 'Offline · public guides ready'
        : 'Public guides ready on this device'
      : reason || 'Offline preparation is unavailable. Use this page online and retry.';
  }
  if (!window.isSecureContext || !('serviceWorker' in navigator)) {
    display('Online reading only here. Offline guides need HTTPS or localhost and a supported browser.');
    return;
  }
  const sw = navigator.serviceWorker;
  const ours = (reg) =>
    reg?.scope === root.href &&
    [reg.installing, reg.waiting, reg.active].filter(Boolean).every((w) => w.scriptURL === worker.href);
  const deadline = (promise, ms) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Not ready')), ms);
      Promise.resolve(promise).then(
        (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        (e) => {
          clearTimeout(timer);
          reject(e);
        },
      );
    });
  const ping = (w) =>
    new Promise((resolve) => {
      const channel = new MessageChannel();
      const finish = (v) => {
        clearTimeout(timer);
        channel.port1.close();
        resolve(v);
      };
      const timer = setTimeout(() => finish(false), 2500);
      channel.port1.onmessage = (e) => finish(e.data?.type === 'LH_STUDY_STATUS' && e.data?.ready === true);
      try {
        w.postMessage({ type: 'LH_STUDY_STATUS' }, [channel.port2]);
      } catch {
        finish(false);
      }
    });
  async function prepare() {
    const ticket = ++epoch;
    try {
      let reg = await deadline(sw.getRegistration(root.href), 5000);
      if (reg?.scope === root.href && !ours(reg)) throw Error('Another worker owns this scope');
      if (!ours(reg) || !reg.active)
        reg = await deadline(sw.register(worker.href, { scope: root.href, updateViaCache: 'none' }), 9000);
      if (!reg.active) reg = await deadline(sw.ready, 12000);
      if (!ours(reg) || !reg.active) throw Error('Not ready');
      const ready = await ping(reg.active);
      if (ticket !== epoch) return;
      available = ready;
      display();
      if (ready && navigator.onLine !== false) reg.update().catch(() => {}); // A new version waits normally; no forced reload.
    } catch {
      if (ticket === epoch) {
        available = false;
        display();
      }
    }
  }
  sw.addEventListener('controllerchange', () => void prepare());
  window.addEventListener('offline', () => display());
  window.addEventListener('online', () => void prepare());
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) void prepare();
  });
  void prepare();
})();
