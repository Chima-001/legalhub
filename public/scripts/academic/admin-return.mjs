// The wordmark is Home. Back only uses a real same-site source, never a caller-supplied return URL.
const accountPages = new Set([
  'admin-settings',
  'login',
  'signup',
  'forgot-password',
  'update-password',
  'confirmed',
  'auth-callback',
  'callback',
  'reset-password',
]);
export function safeSource(raw, current) {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const here = new URL(current),
      source = new URL(raw);
    const root = here.pathname.match(/^(.*\/)pages\/admin-settings(?:\.html)?\/?$/i)?.[1];
    if (
      !root ||
      !['http:', 'https:'].includes(here.protocol) ||
      source.origin !== here.origin ||
      source.username ||
      source.password ||
      !source.pathname.startsWith(root)
    )
      return null;
    const part = source.pathname.slice(root.length);
    const page = part.match(/^pages\/([a-z0-9_-]+)(?:\.html)?\/?$/i)?.[1]?.toLowerCase();
    if (!/^(?:index(?:\.html)?\/?)?$/i.test(part) && (!page || accountPages.has(page))) return null;
    const privateKey =
      /^(?:access_token|refresh_token|provider_token|provider_refresh_token|token|token_hash|code|error|error_code|error_description)$/i;
    for (const params of [source.searchParams, new URLSearchParams(source.hash.slice(1))]) {
      for (const key of params.keys()) if (privateKey.test(key)) return null;
    }
    return source.href;
  } catch {
    return null;
  }
}
function previous(nav) {
  try {
    const i = nav?.currentEntry?.index;
    return Number.isInteger(i) && i > 0 ? nav.entries().find((e) => e.index === i - 1)?.url || '' : '';
  } catch {
    return '';
  }
}
export function mountReturn(link, env) {
  if (!link) return;
  const prior = () => previous(env.navigation);
  const href = env.location.href,
    ref = env.document.referrer;
  const refURL = safeSource(ref, href),
    prevURL = safeSource(prior(), href);
  // A verified referrer is the opener, even if that page used location.replace and the previous
  // entry is a different page. A matching history entry also preserves the original fragment.
  const withoutHash = (url) => url.split('#')[0];
  const matching = refURL && prevURL && withoutHash(refURL) === withoutHash(prevURL);
  const dest = refURL
    ? matching
      ? prevURL
      : refURL
    : !ref || withoutHash(ref) === withoutHash(href)
      ? prevURL
      : null;
  if (!dest) {
    link.removeAttribute('href');
    link.setAttribute('aria-disabled', 'true');
    return;
  }
  link.href = dest;
  link.removeAttribute('aria-disabled');
  link.removeAttribute('title');
  link.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    // If the history position changed, or the Navigation API isn't available, the real anchor
    // still links to the validated source. Never go blindly back from a bookmark or a new tab.
    if (prior() === dest) {
      e.preventDefault();
      env.history.back();
    }
  });
}
if (typeof window !== 'undefined') mountReturn(document.getElementById('admin-back'), window);
