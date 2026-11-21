// Local, in-memory database only. Apply the EXISTING 007 after the already reviewed admin schema.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { materialFixture, uid, sqlFile } from '../materials/release-fixture.mjs';
const read = async (name) =>
  (await readFile(new URL(name, import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const f = await materialFixture();
const { db, as, query, scalar } = f;
const status = await read('../../database/checks/profile-level-status.sql');
try {
  const legacy = await read('./legacy-level-body.sql.txt');
  await db.exec(
    `ALTER TABLE public.users ADD COLUMN current_level text DEFAULT '100L',ADD COLUMN level_updated_at timestamptz DEFAULT now(),ADD COLUMN level text;GRANT UPDATE(current_level,level_updated_at) ON public.users TO authenticated;CREATE FUNCTION public.get_effective_level(p_uid uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $old$${legacy}$old$;`,
  );
  await query("UPDATE public.users SET current_level='200L' WHERE id=$1", [uid(3)]);
  const rows = () =>
    query('SELECT id,is_admin,current_level,level_updated_at,reg_number FROM public.users ORDER BY id');
  const before = await rows();
  assert.equal(await scalar(status), 'READY TO REVIEW 007');
  await db.exec(await sqlFile('007-november-levels.sql'));
  assert.equal(await scalar(status), 'LEVEL EDITOR READY');
  assert.deepEqual(await rows(), before);
  assert.equal(await scalar("SELECT public.academic_level_on('200L',NULL,date '2026-11-07')"), '300L');
  assert.equal(await scalar("SELECT public.academic_level_on('500L',2025,date '2032-11-07')"), '500L');
  console.log(
    'PASS actual 007 after existing calendar/admin/catalogue: read-only status changes, stored profiles/roles are untouched; expected display progression and cap.',
  );
  await as(3);
  const ctx = await scalar('SELECT public.get_my_level_context()');
  assert.equal(ctx.account_id, uid(3));
  const y = ctx.assignment_year,
    phrase = `i update 400L for ${y}/${y + 1}`,
    save = (actor, year, typed) =>
      scalar('SELECT public.set_my_academic_level($1,$2,$3,$4)', ['400L', year, typed, actor]);
  await assert.rejects(save(uid(1), y, phrase), (e) => e.code === '42501');
  await assert.rejects(save(uid(3), y + 1, phrase), (e) => e.code === '40001');
  await assert.rejects(save(uid(3), y, 'yes'));
  await assert.rejects(query("UPDATE public.users SET current_level='400L'"), (e) => e.code === '42501');
  assert.equal(await save(uid(3), y, phrase), '400L');
  assert.equal(await scalar('SELECT public.get_effective_level($1)', [uid(3)]), '400L');
  await as(0);
  const after = await rows();
  assert.deepEqual(
    after.filter((r) => r.id !== uid(3)),
    before.filter((r) => r.id !== uid(3)),
  );
  await db.exec('GRANT UPDATE(current_level) ON public.users TO authenticated');
  assert.equal(await scalar(status), 'STOP: REVIEW LEVEL SCHEMA');
  console.log(
    'PASS a student can set only their own level; wrong phrase, stale session and direct update refused; status signals drift.',
  );
} finally {
  await db.close();
}
