/* Loaded before the normal Auth client, which consumes and clears its own callback URL. */
(() => {
  'use strict';
  const status = document.getElementById('status-text');
  const fallback = 'This page could not verify a new signup. If you already confirmed your email, sign in below.';
  function cleanAddress() {
    try { history.replaceState(null, '', window.location.pathname); } catch { /* Navigation may already be in progress. */ }
  }
  function signupReceipt() {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const query = new URLSearchParams(window.location.search);
    for (const name of ['error', 'error_code', 'error_description']) {
      if (fragment.has(name) || query.has(name)) return null;
    }
    // This site's web client uses Supabase's implicit browser flow. A type flag
    // by itself, a bare URL, or a restored session is not evidence of confirmation.
    if (fragment.get('type') !== 'signup' || !fragment.get('refresh_token')) return null;
    return fragment.get('access_token');
  }
  function returnTo() {
    const target = localStorage.getItem('legalhub_auth_redirect');
    const safe = window.legalHubAccountRoutes?.returnPath(target) || '../index.html';
    return new URL(safe, window.location.href).href;
  }

  let expected = signupReceipt(); // In memory only. Do not log, serialize, or forward it as a return target.
  if (!expected) {
    cleanAddress();
    status.textContent = fallback;
    return;
  }
  document.addEventListener('DOMContentLoaded', async () => {
    let done = false;
    function stop(message) {
      if (done) return;
      done = true;
      expected = null;
      cleanAddress();
      status.textContent = message;
    }
    const timeout = setTimeout(() => stop('Verification is taking longer than expected. You can sign in below instead.'), 12000);
    try {
      if (typeof supabaseClient === 'undefined' || !supabaseClient) return stop(fallback);
      // getSession waits for the SDK to finish handling the URL. Do not exchange the link twice.
      const initial = await supabaseClient.auth.getSession();
      cleanAddress();
      const session = initial.data?.session;
      if (done || initial.error || !session?.user?.id || session.access_token !== expected) return stop(fallback);
      const id = session.user.id;
      const verified = await supabaseClient.auth.getUser();
      if (done || verified.error || verified.data?.user?.id !== id || !verified.data.user.email_confirmed_at) return stop(fallback);
      // Read only the signed-in user's profile ID under RLS. Only the database trigger provisions profiles.
      const profile = await supabaseClient.from('users').select('id').eq('id', id).maybeSingle();
      if (done || profile.error || profile.data?.id !== id) {
        return stop('We could not verify your LegalHub profile yet. Try signing in; if the problem persists, contact the site owner.');
      }
      const current = await supabaseClient.auth.getSession();
      if (done || current.error || current.data?.session?.user?.id !== id || current.data.session.access_token !== expected) return stop(fallback);
      const destination = returnTo();
      localStorage.setItem('legalhub_login_time', String(Date.now()));
      localStorage.removeItem('legalhub_auth_redirect');
      stop('Email confirmed. Opening LegalHub…');
      window.location.replace(destination);
    } catch {
      stop('Could not finish the verification check. You can sign in below instead.');
    } finally {
      clearTimeout(timeout);
      expected = null;
    }
  }, { once: true });
})();
