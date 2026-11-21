// Compare selected published files only. Never authenticates, deploys, runs SQL, pushes Git or writes into the project.
'use strict';
const fs = require('node:fs'),
  path = require('node:path');
const root = path.resolve(__dirname, '..'),
  host = 'https://legalhub-io.netlify.app/';
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
const paths = [
  'pages/materials.html',
  'scripts/materials/review.mjs',
  'pages/pdf.html',
  'scripts/pdfs.js',
  'pages/profile.html',
  'scripts/academic/profile-level.js',
  'sw.js',
  'pwa/register.js',
  'pwa/install-invite.mjs',
  'pwa/install-invite.css',
  'pwa/public-pack.js',
];
// Netlify sometimes adds exactly one inert hosting-attribution comment after the charset for non-browser readers.
// Build the permitted insertion point from the trusted local HTML, not by stripping arbitrary served comments.
const hostingNote =
  /^<!-- This site is hosted on Netlify\. Anyone can build and deploy a site\n     like this one for free: https:\/\/netlify\.new\/\?utm_campaign=loops&utm_source=ai-legible&utm_medium=owned&utm_content=comment&utm_id=[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\n     Netlify hosting facts for this site: static\/SSR served via Netlify Edge\. -->\n$/;
function matchesAsset(f, wanted, served) {
  if (wanted === served) return true;
  if (!f.endsWith('.html') || served.length <= wanted.length || served.length - wanted.length > 512)
    return false;
  const start = wanted.match(
    /^<!doctype html>\s*<html lang="en">\s*<head>\s*<meta charset="utf-8"\s*\/?>\n/i,
  )?.[0];
  if (!start || !served.startsWith(start)) return false;
  const end = start.length + served.length - wanted.length;
  return (
    served.slice(end) === wanted.slice(start.length) && hostingNote.test(served.slice(start.length, end))
  );
}
async function inspectSite(base = host, fetcher = fetch, report = () => {}) {
  const mismatch = [];
  for (const f of paths) {
    try {
      const res = await fetcher(new URL(f, base), {
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(9000),
      });
      const mime = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      const mimeOK = f.endsWith('.html')
        ? mime === 'text/html'
        : f.endsWith('.css')
          ? mime === 'text/css'
          : /^(?:application|text)\/(?:java|ecma)script$/.test(mime);
      if (res.status !== 200) throw Error('HTTP ' + res.status);
      if (res.redirected || new URL(res.url || base).origin !== new URL(base).origin)
        throw Error('unexpected redirect');
      if (!mimeOK) throw Error('not the expected content type');
      const expected = read('public/' + f).replace(/^\uFEFF/, '');
      const t = (await res.text()).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
      if (!matchesAsset(f, expected, t)) throw Error('content differs');
    } catch (error) {
      mismatch.push(f);
      report(f, error?.message || 'could not verify');
    }
  }
  return mismatch;
}
module.exports = { inspectSite };
async function main() {
  if (process.argv.length !== 3 || process.argv[2] !== '--check-site')
    throw Error(
      'SQL preparation is retired. No moderation SQL is needed. Use --check-site only to compare published assets.',
    );
  const missing = await inspectSite(host, fetch, (p, reason) => console.error(p + ': ' + reason));
  if (missing.length)
    throw Error(
      'Not the same published frontend yet. This comparison does not block Materials or Profile. No SQL or deployment was performed.',
    );
  console.log('Published assets match this checkout. No SQL or deployment was performed.');
}
if (require.main === module)
  main().catch((e) => {
    console.error('STOP: ' + e.message);
    process.exitCode = 1;
  });
