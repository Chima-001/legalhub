// Online-only install invitation. The public guide's normal manual controls do not depend on this module.
// A single origin-wide rollout flag coordinates both mounts and concurrent tabs. No accounts or telemetry.
const PREF_DB = 'legalhub:install-invitation';
const PREF_STORE = 'shown';
const ROLLOUT = 'home-invite-v1'; // Do not bump on each release or sign-in.

// A read first avoids loading a stylesheet for returning visitors. A second read IN the write transaction
// decides which tab actually shows the card. The sole stored value is 1 at a fixed key; no timestamp or ID.
function visitFlag(present) {
  return new Promise((resolve) => {
    let db,
      tx,
      settled = false,
      result = 'fresh',
      declined = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      db?.close();
      resolve(value);
    };
    const timer = setTimeout(() => {
      try {
        tx?.abort();
      } catch {}
      finish('unavailable');
    }, 3500);
    try {
      const open = window.indexedDB.open(PREF_DB, 1);
      open.onblocked = open.onerror = () => finish('unavailable');
      open.onupgradeneeded = () => {
        if (settled) {
          open.transaction.abort();
          return;
        }
        if (!open.result.objectStoreNames.contains(PREF_STORE)) open.result.createObjectStore(PREF_STORE);
      };
      open.onsuccess = () => {
        db = open.result;
        if (settled) {
          db.close();
          return;
        }
        try {
          tx = db.transaction(PREF_STORE, present ? 'readwrite' : 'readonly');
          tx.oncomplete = () => finish(result);
          tx.onabort = () => finish(declined ? 'later' : 'unavailable');
          const store = tx.objectStore(PREF_STORE),
            read = store.get(ROLLOUT);
          read.onsuccess = () => {
            if (read.result !== undefined) {
              result = 'seen';
              return;
            }
            if (!present) return;
            store.add(1, ROLLOUT).onsuccess = () => {
              // A hidden, redirected or blocked page must not consume the first impression.
              try {
                if (present()) {
                  result = 'saved';
                  return;
                }
              } catch {}
              declined = true;
              tx.abort();
            };
          };
        } catch {
          finish('unavailable');
        }
      };
    } catch {
      finish('unavailable');
    }
  });
}

export const rememberInstallation = () => visitFlag(() => true);

export function installDirections(nav) {
  if (/iP(?:hone|ad|od)/i.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1))
    return 'Open LegalHub in Safari. Tap Share, then Add to Home Screen. If “Open as Web App” is offered, leave it on and tap Add.';
  if (/Android/i.test(nav.userAgent))
    return 'Open your browser menu (⋮) and look for Install app or Add to Home screen. If neither appears, open LegalHub in Chrome or save a bookmark.';
  return 'Look for the install icon in the address bar or Install in your browser menu. If neither appears, open LegalHub in a supported browser or save a bookmark.';
}

function visible(el) {
  if (!el || el.hidden) return false;
  const css = getComputedStyle(el);
  return (
    css.display !== 'none' &&
    css.visibility !== 'hidden' &&
    css.visibility !== 'collapse' &&
    el.getClientRects().length > 0
  );
}
function element(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text) el.textContent = text;
  return el;
}
function loadStyle(url) {
  return new Promise((resolve) => {
    const link = document.createElement('link');
    const done = (ok) => {
      clearTimeout(timer);
      link.onload = link.onerror = null;
      if (!ok) link.remove();
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), 6000);
    link.onload = () => done(true);
    link.onerror = () => done(false);
    link.rel = 'stylesheet';
    link.href = url.href;
    document.head.append(link);
  });
}

export function mountInvitation({ root, normalPage, installed, canPrompt, promptFromClick }) {
  let searching = true,
    busy = false,
    allowed = false,
    pageAway = false;
  let sheet,
    timer,
    observer,
    card,
    primary,
    closeButton,
    steps,
    returnTo,
    asking = false;
  const listeners = new AbortController();
  const occupied = () =>
    Array.from(document.querySelectorAll('dialog[open], [aria-modal="true"]:not([hidden])')).some(visible);
  function eligible() {
    const splash = document.getElementById('preloader');
    return (
      !pageAway &&
      window.top === window &&
      normalPage() &&
      document.readyState === 'complete' &&
      !installed() &&
      navigator.onLine !== false &&
      document.visibilityState === 'visible' &&
      !document.prerendering &&
      visible(document.body) &&
      !document.getElementById('auth-page-blocker') &&
      !visible(splash) &&
      !occupied() &&
      !document.body.inert &&
      !document.activeElement?.matches('input,textarea,select,[contenteditable="true"]')
    );
  }
  function unwatch() {
    searching = false;
    clearTimeout(timer);
    timer = 0;
    observer?.disconnect();
  }
  function dismiss() {
    unwatch();
    listeners.abort();
    const hadFocus = card?.contains(document.activeElement);
    card?.remove();
    card = null;
    if (hadFocus) {
      const back =
        returnTo?.isConnected && returnTo !== document.body && visible(returnTo)
          ? returnTo
          : document.querySelector(
              '[data-lh-install]:not([hidden]), [data-lh-help]:not([hidden]) summary, #offline-study-link',
            );
      if (back && visible(back)) back.focus({ preventScroll: true });
    }
  }
  function syncButtons() {
    if (!card) return;
    const native = canPrompt();
    primary.textContent = asking
      ? 'Opening installer…'
      : native
        ? 'Install LegalHub'
        : steps.hidden
          ? 'How to install'
          : 'Hide steps';
    primary.disabled = asking;
    if (native) primary.removeAttribute('aria-expanded');
    else primary.setAttribute('aria-expanded', String(!steps.hidden));
    closeButton.textContent = steps.hidden ? 'Not now' : 'Got it';
  }
  function reveal() {
    if (!searching || !eligible()) return false;
    returnTo = document.activeElement;
    const box = element('aside', 'lh-invite');
    box.dataset.lhInstallInvite = '';
    box.setAttribute('aria-labelledby', 'lh-invite-heading');
    const brand = element('div', 'lh-invite__brand'),
      icon = document.createElement('img');
    icon.alt = '';
    icon.width = 32;
    icon.height = 32;
    icon.src = new URL('pwa/lh-192.png', root).href;
    const label = element('span', '', 'LegalHub');
    label.append(element('small', '', 'Study companion'));
    brand.append(icon, label);
    const title = element('h2', 'lh-invite__title', 'Add LegalHub to your device');
    title.id = 'lh-invite-heading';
    const copy = element(
      'p',
      'lh-invite__copy',
      'Open LegalHub from your Home Screen. Once prepared, the public study guides work offline. Library PDFs still need a connection.',
    );
    const actions = element('div', 'lh-invite__actions');
    primary = element('button', 'lh-invite__primary');
    closeButton = element('button', 'lh-invite__later');
    primary.type = closeButton.type = 'button';
    steps = element('p', 'lh-invite__steps', installDirections(navigator));
    steps.id = 'lh-invite-steps';
    steps.hidden = true;
    primary.setAttribute('aria-controls', steps.id);
    primary.addEventListener('click', async () => {
      if (asking) return;
      if (!canPrompt()) {
        steps.hidden = !steps.hidden;
        syncButtons();
        return;
      }
      asking = true;
      try {
        // Invoke synchronously in the click task — never on arrival, or after a storage/network await.
        const choice = promptFromClick();
        syncButtons();
        const outcome = await choice;
        if (!card) return;
        if (outcome === 'accepted' || outcome === 'dismissed') {
          dismiss();
          return;
        }
        steps.hidden = false;
      } finally {
        asking = false;
        syncButtons();
      }
    });
    closeButton.addEventListener('click', dismiss);
    actions.append(primary, closeButton);
    box.append(brand, title, copy, steps, actions);
    card = box;
    syncButtons();
    document.body.append(card); // no focus theft or modal overlay
    return true;
  }
  function queue() {
    if (!searching || !allowed || busy || timer || !eligible()) return;
    timer = setTimeout(async () => {
      timer = 0;
      if (!searching || busy || !eligible()) return;
      busy = true;
      try {
        sheet ??= loadStyle(new URL('pwa/install-invite.css', root));
        if (!(await sheet)) {
          dismiss();
          return;
        }
        const result = await visitFlag(reveal);
        if (result === 'saved') unwatch();
        else if (result !== 'later') dismiss();
      } catch {
        dismiss();
      } finally {
        busy = false;
        if (searching) queue();
      }
    }, 400);
  }
  function update() {
    if (!normalPage() || installed() || (card && navigator.onLine === false)) {
      dismiss();
      return;
    }
    if (card) syncButtons();
    else queue();
  }
  const listen = (target, name, fn) => target.addEventListener(name, fn, { signal: listeners.signal });
  listen(document, 'visibilitychange', queue);
  listen(document, 'focusout', () => queueMicrotask(queue));
  listen(document, 'transitionend', queue);
  listen(window, 'load', queue);
  listen(window, 'online', queue);
  listen(window, 'pageshow', () => {
    pageAway = false;
    update();
  });
  listen(window, 'pagehide', () => {
    pageAway = true;
    if (card) dismiss();
  });
  listen(window, 'keydown', (e) => {
    if (
      card &&
      e.key === 'Escape' &&
      !e.defaultPrevented &&
      (card.contains(document.activeElement) || document.activeElement === document.body) &&
      !document.querySelector('dialog[open]')
    )
      dismiss();
  });
  listen(window, 'hashchange', update);
  listen(window, 'popstate', update);
  void visitFlag().then((state) => {
    if (!searching) return;
    if (state !== 'fresh') {
      dismiss();
      return;
    }
    allowed = true;
    observer = new MutationObserver(queue);
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['hidden', 'inert', 'class', 'style', 'open', 'aria-modal'],
    });
    update();
  });
  return { update };
}
