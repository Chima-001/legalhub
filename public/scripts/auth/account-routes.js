// Address calculations for pages in <LegalHub>/pages/. No Auth, storage or navigation side effects.
(() => {
  'use strict';
  const page = new URL(window.location.href);
  page.search = '';
  page.hash = '';
  page.pathname = page.pathname.replace(/\/+$/, ''); // Also handle an extensionless account route.
  const root = new URL('../', page);
  const home = new URL('index.html', root).pathname;
  const accountPage = /\/(?:login|signup|confirmed|forgot-password|update-password)(?:\.html)?\/?$/i;
  const callbackKeys = ['access_token', 'refresh_token', 'provider_token', 'provider_refresh_token',
    'token', 'token_hash', 'code', 'error', 'error_code', 'error_description'];

  function returnPath(target) {
    if (!target || typeof target !== 'string' || !target.trim()) return home;
    try {
      // Guard destinations already start with the mounted path. Plain app-relative paths
      // (e.g. pages/profile.html) resolve inside this instance, not the server root.
      const url = new URL(target, root);
      if (url.origin !== root.origin || url.protocol !== root.protocol || url.username || url.password
          || url.pathname.startsWith('//') || !url.pathname.startsWith(root.pathname)
          || accountPage.test(url.pathname)) return home;
      const fragment = new URLSearchParams(url.hash.slice(1));
      if (callbackKeys.some(key => url.searchParams.has(key) || fragment.has(key))) return home;
      return `${url.pathname}${url.search}${url.hash}`;
    } catch { return home; }
  }

  window.legalHubAccountRoutes = Object.freeze({
    returnPath,
    loginPath: new URL('pages/login.html', root).pathname,
    confirmationHref: new URL('pages/confirmed.html', root).href,
  });
})();
