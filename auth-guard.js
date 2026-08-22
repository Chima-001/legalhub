/*
  AUTH GUARD - include this on every page that requires login.

  How to use in a page:
    1. Add this near the top of <body>, right after the Supabase client
       script tag, before any real page content:

       <style>body { visibility: hidden; }</style>  <!-- prevents a flash of content before the check completes -->
       <script src="supabase-client.js"></script>
       <script src="auth-guard.js"></script>

    2. That's it - this script checks for a valid session and either
       reveals the page (visibility: visible) or redirects to login.html
       before the person ever sees protected content.

  This must run on EVERY protected page individually - protecting just the
  landing page (e.g. index.html) does not protect pages linked from it,
  since a direct URL to any page bypasses whatever came before it.
*/

(async function requireAuth() {
  const { data: { session } } = await supabaseClient.auth.getSession();

  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  const loginTime = parseInt(localStorage.getItem("legalhub_login_time") || "0", 10);
  const expired = Date.now() - loginTime > SEVEN_DAYS_MS;

  if (!session || expired) {
    await supabaseClient.auth.signOut();
    localStorage.removeItem("legalhub_login_time");
    window.location.href = "login.html"; // TODO: adjust path if this page is nested in a subfolder
    return;
  }

  document.body.style.visibility = "visible";
})();
