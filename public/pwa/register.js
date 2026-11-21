// Shared Home/Study worker and native install controls. No Auth SDK or identity lookup.
(() => {
  'use strict';
  const src = document.currentScript?.src;
  if (!src) return;
  const root = new URL('../', src),
    worker = new URL('sw.js', root);
  const rel = location.pathname.slice(root.pathname.length),
    home = ['', 'index', 'index.html'].includes(rel),
    study = ['study', 'study/', 'study/index', 'study/index.html'].includes(rel);
  const normalPage = () =>
    root.origin === location.origin &&
    location.pathname.startsWith(root.pathname) &&
    location.pathname.slice(root.pathname.length) === rel &&
    !location.search &&
    !location.hash.includes('=') &&
    document.documentElement.dataset.signupHandoff !== '1' &&
    (study ||
      (home &&
        document.documentElement.dataset.lhInstallHome === '1' &&
        ['', '#levels', '#resources'].includes(location.hash)));
  if (!normalPage()) return;
  const note = document.querySelector('[data-lh-state]'),
    install = document.querySelector('[data-lh-install]'),
    help = document.querySelector('[data-lh-help]');
  const mode = window.matchMedia(
    '(display-mode: standalone), (display-mode: minimal-ui), (display-mode: window-controls-overlay)',
  );
  let available = false,
    pendingPrompt = null,
    epoch = 0,
    appInstalled = false,
    prompting = false,
    invite,
    loading = false,
    recording = false;
  const installed = () => appInstalled || mode.matches || navigator.standalone === true;
  const canPrompt = () => !!pendingPrompt && !prompting && !installed() && normalPage();
  const invitationModule = () => import(new URL('pwa/install-invite.mjs', root).href);
  function controls() {
    if (install) install.hidden = !canPrompt();
    if (help) help.hidden = installed();
    invite?.update();
  }
  async function promptFromClick() {
    if (!canPrompt()) return 'manual';
    const p = pendingPrompt;
    pendingPrompt = null;
    prompting = true;
    try {
      const prompted = p.prompt(); // Consume the event in the user gesture, before any await.
      controls();
      const answer = await prompted,
        choice = answer?.outcome ? answer : await p.userChoice;
      return ['accepted', 'dismissed'].includes(choice?.outcome) ? choice.outcome : 'manual';
    } catch {
      return 'manual';
    } finally {
      prompting = false;
      controls();
    }
  }
  function startHome() {
    if (!home || invite || loading || !normalPage() || installed() || navigator.onLine === false) return;
    loading = true;
    // Deliberately outside the public reading cache: no invitation on offline fallback or Study.
    invitationModule()
      .then(({ mountInvitation }) => {
        if (normalPage() && !installed())
          invite = mountInvitation({ root, normalPage, installed, canPrompt, promptFromClick });
      })
      .catch(() => {})
      .finally(() => {
        loading = false;
      });
  }
  function rememberInstalled() {
    if (recording || !normalPage() || navigator.onLine === false) return;
    recording = true;
    invitationModule()
      .then(({ rememberInstallation }) => rememberInstallation())
      .catch(() => {});
  }
  controls();
  if (window.isSecureContext && window.top === window) {
    window.addEventListener('beforeinstallprompt', (e) => {
      if (!normalPage() || typeof e.prompt !== 'function' || installed()) return;
      e.preventDefault();
      pendingPrompt = e;
      controls();
    });
    window.addEventListener('appinstalled', () => {
      appInstalled = true;
      pendingPrompt = null;
      controls();
      rememberInstalled();
    });
    mode.addEventListener?.('change', () => {
      if (installed()) {
        pendingPrompt = null;
        rememberInstalled();
      } else startHome();
      controls();
    });
    install?.addEventListener('click', async () => {
      if ((await promptFromClick()) === 'manual' && help && !installed()) help.open = true;
    });
    if (installed()) rememberInstalled();
    else startHome();
    window.addEventListener('online', () => {
      if (installed()) rememberInstalled();
      else startHome();
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
  window.addEventListener('offline', () => {
    display();
    invite?.update();
  });
  window.addEventListener('online', () => void prepare());
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) void prepare();
  });
  void prepare();
})();
