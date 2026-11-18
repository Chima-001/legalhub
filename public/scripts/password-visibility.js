/* LegalHub: local presentation only. Never read, copy, store or send a password. */
(() => {
  'use strict';

  // These standalone fields have placeholders rather than associated labels.
  const fieldNames = {
    'current-password-input': 'current password',
    'new-password-input': 'new password',
    adminPasswordInput: 'admin password',
    oldAdminPass: 'current admin password',
    newAdminPass: 'new admin password',
    confirmAdminPass: 'new admin password confirmation',
  };
  const eye = 'M2 12c2.8-4.4 6.2-6.6 10-6.6S19.2 7.6 22 12c-2.8 4.4-6.2 6.6-10 6.6S4.8 16.4 2 12Z M14.7 12a2.7 2.7 0 1 1-5.4 0 2.7 2.7 0 0 1 5.4 0Z';
  const eyeOff = 'M3 3l18 18 M5.8 7.5A21 21 0 0 0 2 12c2.8 4.4 6.2 6.6 10 6.6 1.7 0 3.4-.4 5-1.3 M9.4 5.8c.9-.3 1.7-.4 2.6-.4 3.8 0 7.2 2.2 10 6.6a22 22 0 0 1-2.2 2.9 M9.9 10.2a2.7 2.7 0 0 0 3.9 3.9';
  const ns = 'http://www.w3.org/2000/svg';

  function init() {
    const masks = [];
    let serial = 0;
    for (const input of document.querySelectorAll('input[type="password"]')) {
      if (input.hasAttribute('data-lh-password-eye')) continue;
      const parent = input.parentElement;
      const inShell = parent.classList.contains('field-shell');
      const nearbyLabel = (inShell ? parent : input).previousElementSibling;
      if (!input.id) {
        let id;
        do { id = `lh-password-${++serial}`; } while (document.getElementById(id));
        input.id = id;
      }
      if (!input.labels.length && nearbyLabel?.matches('label:not([for])')) nearbyLabel.htmlFor = input.id;
      const label = input.getAttribute('aria-label') || input.labels[0]?.textContent || fieldNames[input.id] || 'password';
      const name = label.trim().toLowerCase().replace(/^confirm (new )?password$/, (_, prefix) => `${prefix || ''}password confirmation`);
      if (!input.labels.length && !input.hasAttribute('aria-labelledby') && !input.hasAttribute('aria-label')) input.setAttribute('aria-label', name);

      // Keep the same input, IDs, listeners, validation and autofill attributes.
      // In the admin grid, wrap each field individually rather than adding grid items.
      let host = parent;
      if (!inShell) {
        host = document.createElement('div');
        host.className = 'lh-pw-standalone';
        // Keep the admin login field's outer spacing below the whole control.
        if (input.classList.contains('mb-4')) {
          input.classList.remove('mb-4');
          host.classList.add('mb-4');
        }
        input.before(host);
        host.append(input);
      }
      host.classList.add('lh-pw-field');
      input.setAttribute('data-lh-password-eye', '');
      input.setAttribute('spellcheck', 'false');
      input.setAttribute('autocapitalize', 'none');
      input.setAttribute('autocorrect', 'off');

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'lh-pw-toggle';
      button.setAttribute('aria-controls', input.id);
      const svg = document.createElementNS(ns, 'svg');
      for (const [key, val] of Object.entries({ viewBox: '0 0 24 24', width: '19', height: '19', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' })) svg.setAttribute(key, val);
      const path = document.createElementNS(ns, 'path');
      svg.append(path);
      button.append(svg);
      host.append(button);

      // A hidden/reopened panel must not redisplay an earlier visible password.
      // Watch only this field's ancestors, and only while it is revealed.
      const panelWatch = new MutationObserver(() => {
        if (input.disabled || input.closest('[hidden], [aria-hidden="true"]') || !input.getClientRects().length || getComputedStyle(input).visibility !== 'visible') show(false);
      });
      function show(visible) {
        const type = visible ? 'text' : 'password';
        if (input.type !== type) input.type = type;
        const action = `${visible ? 'Hide' : 'Show'} ${name}`;
        button.setAttribute('aria-label', action);
        button.title = action;
        path.setAttribute('d', visible ? eyeOff : eye);
        panelWatch.disconnect();
        if (visible) {
          for (let el = input; el; el = el.parentElement) {
            panelWatch.observe(el, { attributes: true, attributeFilter: ['class', 'hidden', 'aria-hidden', 'style', 'disabled'] });
          }
        }
      }
      const mask = () => show(false);
      mask();
      masks.push(mask);
      button.addEventListener('click', () => show(!input.disabled && input.type === 'password'));
    }
    if (!masks.length) return;
    const maskAll = () => { for (const mask of masks) mask(); };
    document.addEventListener('submit', maskAll, true);
    document.addEventListener('reset', maskAll, true);
    // These existing profile/admin controls use click handlers instead of a form submit.
    for (const id of ['save-password-btn', 'verifyAdminBtn', 'changeAdminPasswordBtn', 'closeAdminModalBtn']) {
      document.getElementById(id)?.addEventListener('click', maskAll, true);
    }
    document.addEventListener('visibilitychange', () => { if (document.hidden) maskAll(); });
    window.addEventListener('pagehide', maskAll);
    window.addEventListener('pageshow', maskAll);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
