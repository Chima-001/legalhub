// Review/prepare only. Never authenticates, deploys, runs SQL, pushes Git or writes into the project.
'use strict';
const fs = require('node:fs'),
  path = require('node:path'),
  { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..'),
  host = 'https://legalhub-io.netlify.app/',
  ref = 'iyeekpmutpugpmarddpa';
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
const pins = {
  '007-november-levels.sql': 'cbd4f1a663585b2e2c839657fff397b21fc5317eca3d53d49dde15b078347bd5',
  '011-material-review.sql': '899f58ef627b4e9b99dbdc8a0c38a69c71be97db01c4181401ab0fd1315d2499',
};
function inside(name) {
  const s = read('database/migrations/' + name);
  if (createHash('sha256').update(s).digest('hex') !== pins[name])
    throw Error('Reviewed migration changed: ' + name);
  const a = s.split(/^BEGIN;[ \t]*$/m),
    b = a[1]?.split(/^COMMIT;[ \t]*$/m);
  if (a.length !== 2 || b?.length !== 2) throw Error('Unexpected transaction shape');
  return b[0].trim();
}
const status = (k) =>
  read('database/checks/' + k + '-status.sql')
    .trim()
    .replace(/;$/, '');
function releaseSQL(expires) {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(expires)) throw Error('Invalid release window');
  return `-- Prepared for the checked LegalHub release only. Execute once as operator in the private SQL Editor.
-- Have a restorable DB backup, R2 recovery and the previous functioning signer artifact. Pause reviews/edits and retire old tabs.
-- No real test mail/upload, recipient lookups, promotions by UPDATE, grants of admin or file deletion.
BEGIN;
SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='30s';
DO $gate$ DECLARE cfg record; good boolean; BEGIN
 IF now()>timestamptz '${expires}' THEN RAISE EXCEPTION 'Expired preflight. Recheck the published assets and prepare a new file.'; END IF;
 IF auth.uid() IS NOT NULL OR to_regprocedure('legalhub_console.upload_hook_config()') IS NULL OR to_regclass('legalhub_console.upload_alerts') IS NULL THEN RAISE EXCEPTION 'Not the expected operator/project baseline.'; END IF;
 SELECT ref,anon_jwt INTO STRICT cfg FROM legalhub_console.upload_hook_config();
 IF cfg.ref IS DISTINCT FROM '${ref}' THEN RAISE EXCEPTION 'Wrong project.'; END IF;
 IF (\n${status('profile-level')}\n) IS DISTINCT FROM 'READY TO REVIEW 007' OR (\n${status('material-review')}\n) IS DISTINCT FROM 'REVIEW SERVICE NOT INSTALLED' THEN RAISE EXCEPTION 'Baseline differs or previously activated; do not replay. Read the two status checks.'; END IF;
 PERFORM set_config('http.curlopt_timeout_ms','5000',true),set_config('http.curlopt_connecttimeout_ms','2500',true);
 -- Fixed project, public gateway credential stays inside DB; ordinary GET cannot issue a signature or mutate storage.
 SELECT r.status=405 AND EXISTS(SELECT FROM unnest(r.headers) h WHERE lower(h.field)='x-legalhub-storage-contract' AND h.value='reviewed-removal-v1') INTO good
 FROM lh_mail_transport.http(ROW('GET','https://${ref}.supabase.co/functions/v1/r2-presign',ARRAY[ROW('Authorization','Bearer '||cfg.anon_jwt)::lh_mail_transport.http_header],NULL,NULL)::lh_mail_transport.http_request) r;
 IF good IS DISTINCT FROM true THEN RAISE EXCEPTION 'Reviewed R2 worker did not boot or identify itself. No database changes.'; END IF;
END $gate$;
LOCK TABLE public.users, public.materials IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMP VIEW lh_release_shape AS SELECT
 (SELECT md5(coalesce(string_agg(id::text||':'||xmin::text,',' ORDER BY id),'')) FROM public.users) AS profile_versions,
 (SELECT md5(coalesce(string_agg(id::text||':'||xmin::text,',' ORDER BY id),'')) FROM public.materials) AS material_versions;
CREATE TEMP TABLE lh_release_before ON COMMIT DROP AS SELECT * FROM pg_temp.lh_release_shape;
${inside('007-november-levels.sql')}
${inside('011-material-review.sql')}
DO $after$ BEGIN
 IF (\n${status('profile-level')}\n) IS DISTINCT FROM 'LEVEL EDITOR READY' OR (\n${status('material-review')}\n) IS DISTINCT FROM 'MATERIAL DATABASE READY' THEN RAISE EXCEPTION 'Release contract failed. Roll back both changes.'; END IF;
 IF EXISTS(SELECT * FROM pg_temp.lh_release_shape EXCEPT SELECT * FROM pg_temp.lh_release_before) THEN RAISE EXCEPTION 'Existing rows changed unexpectedly. Roll back.'; END IF;
END $after$;
DROP VIEW pg_temp.lh_release_shape;
NOTIFY pgrst,'reload schema';
COMMIT;
SELECT 'MATERIAL DATABASE READY / LEVEL EDITOR READY' AS release_status;
`;
}
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
module.exports = { releaseSQL, inspectSite };
async function main() {
  const [mode, dest, ...more] = process.argv.slice(2);
  if (
    !['--check-site', '--prepare'].includes(mode) ||
    more.length ||
    (mode === '--prepare') !== Boolean(dest)
  )
    throw Error('Use --check-site, or --prepare PATH_TO_NEW_SQL_OUTSIDE_REPO.');
  const bad = await inspectSite(host, fetch, (f, reason) => console.error(f + ': ' + reason));
  if (bad.length)
    throw Error(
      'Published files do not match this checkout: ' +
        bad.join(', ') +
        '. No activation file written. Publish the whole reviewed public/ during the coordinated window first.',
    );
  console.log(
    'Published moderation, Profile and PWA files match this checkout (not a DB, session or email test).',
  );
  if (mode === '--check-site') return;
  const p = path.resolve(dest),
    dir = fs.realpathSync(path.dirname(p)),
    rel = path.relative(fs.realpathSync(root), dir);
  if (
    path.extname(p).toLowerCase() !== '.sql' ||
    (!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + path.sep))
  )
    throw Error('Choose a new .sql path outside the repository.');
  const sql = releaseSQL(new Date(Date.now() + 90 * 60000).toISOString());
  fs.writeFileSync(p, sql, { flag: 'wx', mode: 0o600 });
  console.log(
    'PREPARED, NOT RUN: ' + p + '. Valid 90 minutes; read docs/paired-release.md before executing.',
  );
}
if (require.main === module)
  main().catch((e) => {
    console.error('STOP: ' + e.message);
    process.exitCode = 1;
  });
