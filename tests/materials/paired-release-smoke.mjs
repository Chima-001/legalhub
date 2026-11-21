// Start from the hosted feature order: alert capture already installed; old level reader and admin catalogue.
// No actual HTTP. An in-memory GET double enforces the exact destination and reports the staged R2 contract.
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { alertFixture, uid } from './alert-fixture.mjs';
const { releaseSQL, inspectSite } = createRequire(import.meta.url)(
  '../../tools/prepare-reviewed-release.cjs',
);
const f = await alertFixture(true, false),
  { db, as, query, scalar } = f;
const read = async (file) => (await readFile(new URL(file, import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const levels = await read('../../database/checks/profile-level-status.sql'),
  moderation = await read('../../database/checks/material-review-status.sql');
try {
  const old = await read('../academic/legacy-level-body.sql.txt');
  await db.exec(
    `ALTER TABLE public.users ADD COLUMN current_level text DEFAULT '200L',ADD COLUMN level_updated_at timestamptz DEFAULT now(),ADD COLUMN level text; GRANT UPDATE(current_level,level_updated_at) ON public.users TO authenticated;CREATE FUNCTION public.get_effective_level(p_uid uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $old$${old}$old$;`,
  );
  // Only fictional config, admin IDs and uploads exist in this fixture. No production material ID or credential is used.
  const ref = 'iyeekpmutpugpmarddpa';
  const jwt =
    'e30.' +
    Buffer.from(JSON.stringify({ role: 'anon', ref, exp: 4102444800 })).toString('base64url') +
    '.fixture';
  await query("UPDATE vault.decrypted_secrets SET decrypted_secret=$1 WHERE name='lh_upload_project_ref'", [
    ref,
  ]);
  await query("UPDATE vault.decrypted_secrets SET decrypted_secret=$1 WHERE name='lh_upload_anon_jwt'", [
    jwt,
  ]);
  await f.add(1, 'Fictional pending notes');
  await db.exec(`ALTER FUNCTION lh_mail_transport.http(lh_mail_transport.http_request) RENAME TO fixture_post;
 CREATE FUNCTION lh_mail_transport.http(req lh_mail_transport.http_request) RETURNS lh_mail_transport.http_response LANGUAGE plpgsql AS $$ BEGIN
 IF req.method='GET' THEN IF req.uri<>'https://iyeekpmutpugpmarddpa.supabase.co/functions/v1/r2-presign' OR req.content IS NOT NULL OR NOT (req.headers[1].field='Authorization') THEN RAISE EXCEPTION 'Unexpected probe'; END IF;
 RETURN ROW(405,'text/plain',ARRAY[ROW('X-LegalHub-Storage-Contract',coalesce(current_setting('test.storage_contract',true),'old'))::lh_mail_transport.http_header],'')::lh_mail_transport.http_response; END IF; RETURN lh_mail_transport.fixture_post(req); END $$;`);
  const sql = releaseSQL('2099-01-01T00:00:00.000Z'),
    before = () => query('SELECT id,current_level,level_updated_at,is_admin FROM public.users ORDER BY id');
  const users = await before();
  assert.equal(await scalar(moderation), 'REVIEW SERVICE NOT INSTALLED');
  assert.equal(await scalar(levels), 'READY TO REVIEW 007');
  await assert.rejects(db.exec(releaseSQL('2000-01-01T00:00:00.000Z')), /Expired preflight/);
  await db.exec('ROLLBACK');
  await db.exec('REVOKE INSERT ON public.materials FROM authenticated');
  assert.equal(await scalar(moderation), 'STOP: REVIEW MATERIAL SCHEMA');
  await assert.rejects(db.exec(sql), /Baseline differs/);
  await db.exec('ROLLBACK; GRANT INSERT ON public.materials TO authenticated');
  await assert.rejects(db.exec(sql), /Reviewed R2 worker/);
  await db.exec('ROLLBACK');
  await db.exec("SET test.storage_contract='reviewed-removal-v1'");
  await db.exec(
    'CREATE TABLE public.fixture_dependency(material_id uuid REFERENCES public.materials(id) ON DELETE CASCADE)',
  );
  await assert.rejects(db.exec(sql), /Material baseline/);
  await db.exec('ROLLBACK;DROP TABLE public.fixture_dependency');
  assert.deepEqual(await before(), users);
  assert.equal(await scalar(levels), 'READY TO REVIEW 007');
  assert.equal(await scalar(moderation), 'REVIEW SERVICE NOT INSTALLED');
  await db.exec(sql);
  assert.equal(await scalar(moderation), 'MATERIAL DATABASE READY');
  assert.equal(await scalar(levels), 'LEVEL EDITOR READY');
  assert.deepEqual(await before(), users);
  assert.equal(await scalar('SELECT count(*) FROM lh_mail_transport.fake_requests'), 0);
  assert.equal(await scalar('SELECT count(*) FROM legalhub_console.upload_alerts'), 1);
  await as(3);
  const ctx = await scalar('SELECT public.get_my_level_context()');
  assert.equal(ctx.account_id, uid(3));
  const y = ctx.assignment_year;
  assert.equal(
    await scalar('SELECT public.set_my_academic_level($1,$2,$3,$4)', [
      '400L',
      y,
      `i update 400L for ${y}/${y + 1}`,
      uid(3),
    ]),
    '400L',
  );
  await as(2);
  const r = await f.review(1, 2);
  assert.equal(await f.change(1, r.version, 'approve', 'i approve Fictional pending notes', null, 2), true);
  await as(0);
  assert.equal(await scalar('SELECT count(*) FROM legalhub_console.upload_alerts'), 1);
  await db.exec(
    'BEGIN; GRANT EXECUTE ON FUNCTION public.lh_material_remove(uuid,uuid,text,text,text) TO authenticated',
  );
  assert.equal(await scalar(moderation), 'STOP: REVIEW MATERIAL SCHEMA');
  await db.exec('ROLLBACK');
  assert.equal(await scalar(moderation), 'MATERIAL DATABASE READY');
  await assert.rejects(db.exec(sql), /previously activated/);
  await db.exec('ROLLBACK');
  const missing = await inspectSite('https://fixture.invalid/', async () => new Response('old frontend'));
  assert(missing.includes('pages/materials.html') && missing.includes('pages/profile.html'));
  async function fixtureAsset(url, forceType) {
    const p = new URL(url).pathname;
    const type = p.endsWith('.html')
      ? 'text/html'
      : p.endsWith('.css')
        ? 'text/css'
        : 'application/javascript';
    return new Response(await read('../../public' + p), { headers: { 'Content-Type': forceType || type } });
  }
  const badMime = await inspectSite('https://fixture.invalid/', (url) => fixtureAsset(url, 'text/plain'));
  assert(badMime.includes('scripts/materials/review.mjs'));
  const matching = await inspectSite('https://fixture.invalid/', (url) => fixtureAsset(url));
  assert.deepEqual(matching, []);
  const note =
    '<!-- This site is hosted on Netlify. Anyone can build and deploy a site\n     like this one for free: https://netlify.new/?utm_campaign=loops&utm_source=ai-legible&utm_medium=owned&utm_content=comment&utm_id=11111111-2222-3333-4444-555555555555\n     Netlify hosting facts for this site: static/SSR served via Netlify Edge. -->\n';
  async function decorate(url, extra) {
    const res = await fixtureAsset(url);
    if (!new URL(url).pathname.endsWith('.html')) return res;
    const raw = await res.text();
    return new Response(raw.replace(/(<meta charset="UTF-8"\s*\/?>\n)/, '$1' + note + extra), {
      headers: res.headers,
    });
  }
  assert.deepEqual(await inspectSite('https://fixture.invalid/', (url) => decorate(url, '')), []);
  const other = await inspectSite('https://fixture.invalid/', (url) =>
    decorate(url, '<meta name="different-release">\n'),
  );
  assert(other.includes('pages/materials.html') && other.includes('pages/profile.html'));

  console.log(
    'PASS old pages or wrong asset MIME block preparation; expired window, missing upload grant, unsafe RPC grant, old signer and late 011 fault refused; both DB changes roll back on failure; correct paired cutover preserves rows, keeps uploads/alerts, enables typed moderation and manual/November levels, refuses replay.',
  );
} finally {
  await db.close();
}
