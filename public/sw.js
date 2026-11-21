/* LegalHub public reading only. No runtime network response is written to Cache Storage.
 * Authenticated pages, API traffic, signed URLs, PDFs and writes are not offline routes. */
'use strict';
importScripts('./pwa/public-pack.js');
const root = new URL(self.registration.scope),
  pack = self.LH_PUBLIC_STUDY;
const allowed = new Set([
  'study/index.html',
  'pwa/study.css',
  'pwa/register.js',
  'manifest.webmanifest',
  'pwa/lh-192.png',
  'pwa/lh-512.png',
]);
const assets = new Map(pack.entries.map((e) => [e.key, e]));
if (
  !/^[a-f0-9]{20}$/.test(pack.revision) ||
  assets.size !== allowed.size ||
  pack.entries.length !== allowed.size ||
  [...allowed].some((k) => !assets.has(k))
)
  throw Error('Unexpected public study pack');
const prefix = 'legalhub:public-study:' + encodeURIComponent(root.pathname) + ':',
  cacheName = prefix + '1-' + pack.revision;
const absolute = (key) => new URL(key, root).href;
function built(key) {
  const e = assets.get(key);
  return new Response(e.binary ? Uint8Array.from(atob(e.body), (c) => c.charCodeAt(0)) : e.body, {
    headers: {
      'Content-Type': e.type,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-LegalHub-Public-Study': pack.revision,
      ...(e.type.startsWith('text/html')
        ? {
            'Content-Security-Policy':
              "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; manifest-src 'self'; worker-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'",
          }
        : {}),
    },
  });
}
self.addEventListener('install', (event) =>
  event.waitUntil(
    (async () => {
      const cache = await caches.open(cacheName);
      await Promise.all([...allowed].map((key) => cache.put(absolute(key), built(key))));
    })(),
  ),
);
self.addEventListener('activate', (event) =>
  event.waitUntil(
    (async () => {
      await Promise.all(
        (await caches.keys())
          .filter((k) => k.startsWith(prefix) && k !== cacheName)
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  ),
);
async function publicFile(key) {
  try {
    const c = await caches.open(cacheName);
    const hit = await c.match(absolute(key));
    if (hit?.headers.get('X-LegalHub-Public-Study') === pack.revision) return hit;
    // Storage may be evicted. Rebuild from reviewed bytes, never from a requested URL or network response.
    await c.put(absolute(key), built(key));
  } catch {
    /* The resident worker can still serve its public pack. */
  }
  return built(key);
}
function offlineHome() {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Offline · LegalHub</title><style>*{box-sizing:border-box}body{margin:0;background:#faf8f1;color:#182b40;font:1rem/1.6 system-ui}main{max-width:34rem;margin:12vh auto;padding:1.8rem}small{font-weight:700;letter-spacing:.12em;color:#705326}h1{font:500 2.5rem/1.05 Georgia,serif}a{display:inline-block;background:#203a4b;color:white;padding:.75rem 1rem;border-radius:.3rem}a:focus-visible{outline:3px solid #447ad1;outline-offset:3px}</style></head><body><main><small>LEGALHUB / OFFLINE</small><h1>Keep studying offline.</h1><p>Home needs a connection. You can still read the public study guides on this device. Your profile, course Library and admin pages have not been saved by the app.</p><a href="./study/">Open public study guides</a><p>For sign-in, confirmation or your own account, reconnect and reload this address.</p></main></body></html>`,
    {
      status: 503,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy':
          "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
      },
    },
  );
}
self.addEventListener('fetch', (event) => {
  const req = event.request,
    u = new URL(req.url);
  if (
    req.method !== 'GET' ||
    u.origin !== root.origin ||
    !u.pathname.startsWith(root.pathname) ||
    u.search ||
    u.username ||
    u.password ||
    ['authorization', 'apikey', 'range', 'x-client-info'].some((h) => req.headers.has(h))
  )
    return;
  const rel = u.pathname.slice(root.pathname.length);
  if (req.mode === 'navigate' && ['', 'index', 'index.html'].includes(rel)) {
    // Do not mask an actual 401, 403, 404 or server error and never cache this response.
    event.respondWith(fetch(req, { cache: 'no-store' }).catch(offlineHome));
    return;
  }
  if (rel === 'study' && req.mode === 'navigate') {
    event.respondWith(Response.redirect(absolute('study/'), 302));
    return;
  }
  const key = rel === 'study/' ? 'study/index.html' : rel;
  if (allowed.has(key)) event.respondWith(publicFile(key));
});
// Readiness only. No message accepts a URL, email, token, cache body, queued operation or command to delete data.
self.addEventListener('message', (event) => {
  if (
    event.data?.type !== 'LH_STUDY_STATUS' ||
    !event.ports?.[0] ||
    (event.origin && event.origin !== root.origin)
  )
    return;
  event.waitUntil(
    (async () => {
      let ready = false;
      try {
        const c = await caches.open(cacheName);
        const found = await Promise.all([...allowed].map((k) => c.match(absolute(k))));
        ready = found.every((r) => r?.headers.get('X-LegalHub-Public-Study') === pack.revision);
        if (!ready) {
          await Promise.all([...allowed].map((k) => c.put(absolute(k), built(k))));
          ready = true;
        }
      } catch {}
      event.ports[0].postMessage({ type: 'LH_STUDY_STATUS', ready, revision: pack.revision });
    })(),
  );
});
