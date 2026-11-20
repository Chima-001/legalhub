// In-memory Postgres only. No project URL, keys, external service or real users. Uses the already-pinned auth test dependency.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const require = createRequire(new URL('../auth/package.json', import.meta.url));
const { PGlite } = require('@electric-sql/pglite');
const db = new PGlite();
const read = (file) => readFileSync(new URL(file, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const six = read('../../database/migrations/006-academic-calendar.sql'),
  seven = read('../../database/migrations/007-november-levels.sql');
const legacy = read('./legacy-level-body.sql.txt');
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
const val = async (sql, args = []) => Object.values((await q(sql, args))[0])[0];
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const checks = [];
const ok = (name) => {
  checks.push(name);
  console.log('PASS:', name);
};
async function as(role, n) {
  await db.exec('RESET ROLE');
  await q("SELECT set_config('fixture.uid',$1,false)", [n ? id(n) : '']);
  if (role) await db.exec('SET ROLE ' + role);
}
const term = () => val('SELECT public.get_academic_calendar()');
const save = (year, sem, start, exams, end, rev, phrase) =>
  val('SELECT public.save_academic_calendar($1,$2,$3,$4,$5,$6,$7)', [
    year,
    sem,
    start,
    exams,
    end,
    rev,
    phrase,
  ]);
const correct = (level, year, phrase, expected = id(2)) =>
  val('SELECT public.set_my_academic_level($1,$2,$3,$4)', [level, year, phrase, expected]);
try {
  console.log(await val('SELECT version()'));
  await db.exec(`CREATE SCHEMA auth; CREATE ROLE anon; CREATE ROLE authenticated;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('fixture.uid',true),'')::uuid$$;
 GRANT USAGE ON SCHEMA auth TO authenticated;
 CREATE TABLE public.users(id uuid PRIMARY KEY, current_level text DEFAULT '100L', level_updated_at timestamptz DEFAULT now(),
   level text, username text, avatar_path text, is_admin boolean DEFAULT false, reg_number text);
 ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
 GRANT SELECT ON public.users TO authenticated; GRANT UPDATE(username,avatar_path,current_level,level_updated_at) ON public.users TO authenticated;
 CREATE POLICY own_read ON public.users FOR SELECT TO authenticated USING (id=auth.uid());
 CREATE POLICY own_update ON public.users FOR UPDATE TO authenticated USING (id=auth.uid()) WITH CHECK (id=auth.uid());
 ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated;
 ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon,authenticated;
 CREATE FUNCTION public.get_effective_level(p_uid uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $old$${legacy}$old$;`);
  await q(
    "INSERT INTO public.users(id,username,is_admin,current_level,level_updated_at,reg_number) VALUES ($1,'Admin',true,'300L','2026-02-05','FIX-A'),($2,'Member',false,'100L','2026-10-31',null)",
    [id(1), id(2)]
  );
  await q(
    "INSERT INTO public.users(id,current_level,level) VALUES ($1,null,'400L'),($2,null,null),($3,'300L','100L')",
    [id(4), id(5), id(6)]
  );
  const rows = () =>
    q(
      'SELECT id,username,avatar_path,is_admin,reg_number,current_level,level,level_updated_at FROM public.users ORDER BY id'
    );
  const before = await rows();
  // No administrative table operation is invoked: the preflight only checks effective ACLs.
  await db.exec('GRANT TRIGGER ON public.users TO anon');
  await assert.rejects(db.exec(six), /permissions differ/);
  await db.exec('ROLLBACK; REVOKE TRIGGER ON public.users FROM anon');
  assert.equal(await val("SELECT to_regclass('public.academic_term') IS NULL"), true);
  ok('Unsafe profile grants stop calendar installation atomically');
  await db.exec(six);
  assert.equal(await val('SELECT count(*)::int FROM public.academic_term'), 0);
  ok('No invented schedule is installed');
  await db.exec(
    `CREATE OR REPLACE FUNCTION public.get_effective_level(p_uid uuid) RETURNS text LANGUAGE sql AS $$SELECT '100L'::text$$`
  );
  await assert.rejects(db.exec(seven), /differs from reviewed baseline/);
  await db.exec('ROLLBACK');
  await db.exec(
    `CREATE OR REPLACE FUNCTION public.get_effective_level(p_uid uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $old$${legacy}$old$`
  );
  await db.exec(seven);
  assert.deepEqual(await rows(), before);
  assert.equal(await val('SELECT count(*)::int FROM public.users WHERE level_base_year IS NOT NULL'), 0);
  ok(
    'Drift aborts safely; clean installation preserves legacy rows, timestamps and roles without a backfill'
  );
  for (const role of ['anon', 'authenticated']) {
    assert.equal(
      await val("SELECT has_any_column_privilege($1::name,'public.academic_term','INSERT,UPDATE')", [role]),
      false
    );
    assert.equal(
      await val(
        "SELECT has_table_privilege($1::name,'public.academic_term','DELETE,TRUNCATE,TRIGGER,REFERENCES,MAINTAIN')",
        [role]
      ),
      false
    );
    for (const col of ['current_level', 'level_base_year', 'level_updated_at', 'is_admin'])
      assert.equal(
        await val("SELECT has_column_privilege($1::name,'public.users',$2,'UPDATE')", [role, col]),
        false
      );
  }
  await as('anon');
  await assert.rejects(term(), /permission denied/);
  await assert.rejects(
    save(2026, 1, '2026-11-02', '2027-02-01', '2027-02-12', 0, 'i publish 2026/2027 first semester'),
    /permission denied/
  );
  ok('Anonymous access is denied and neither web role has direct calendar or level writes');
  await as('authenticated', 2);
  assert.equal((await term()).can_manage, false);
  assert.equal((await term()).term, null);
  await assert.rejects(
    save(2026, 1, '2026-11-02', '2027-02-01', '2027-02-12', 0, 'i publish 2026/2027 first semester'),
    /Administrator access/
  );
  ok('Ordinary member can read the calendar but cannot publish, even with the correct text');
  await as('authenticated', 1);
  assert.equal((await term()).can_manage, true);
  const first = (phrase, rev = 0) => save(2026, 1, '2026-11-02', '2027-02-01', '2027-02-12', rev, phrase);
  await assert.rejects(first('publish'), /confirmation/);
  await assert.rejects(
    save(2026, 1, '2026-12-01', '2026-11-01', '2027-02-12', 0, 'i publish 2026/2027 first semester'),
    /ordered/
  );
  assert.equal(await first('i publish 2026/2027 first semester'), 1);
  assert.equal((await term()).term.exam_end, '2027-02-12');
  ok('Admin publish validates ordering and exact typed confirmation, then persists the term');
  await assert.rejects(first('i publish 2026/2027 first semester'), /Calendar changed/);
  assert.equal(
    await save(2026, 2, '2027-03-01', '2027-06-10', '2027-06-30', 1, 'i update 2026/2027 second semester'),
    2
  );
  await assert.rejects(first('i update 2026/2027 first semester', 1), /Calendar changed/);
  await as('authenticated', 2);
  let active = (await term()).term;
  assert.equal(active.semester, 2);
  assert.equal(active.revision, 2);
  ok('Starting another semester replaces the active dates; stale editors cannot overwrite it');
  await as(null);
  await q('UPDATE public.users SET is_admin=false WHERE id=$1', [id(1)]);
  await as('authenticated', 1);
  await assert.rejects(first('i update 2026/2027 first semester', 2), /Administrator access/);
  await as(null);
  await q('UPDATE public.users SET is_admin=true WHERE id=$1', [id(1)]);
  ok('Revoking the admin flag takes effect at the next write; no privileged browser state is trusted');
  const levelAt = (base, anchor, date) =>
    val('SELECT public.academic_level_on($1,$2,$3)', [base, anchor, date]);
  const atLagos = (instant) =>
    val("SELECT public.academic_cycle_year(($1::timestamptz AT TIME ZONE 'Africa/Lagos')::date)", [instant]);
  assert.equal(await atLagos('2026-11-06T22:59:59Z'), 2025);
  assert.equal(await atLagos('2026-11-06T23:00:00Z'), 2026);
  ok('The annual boundary is local midnight in Lagos, not midnight in the browser or UTC');
  for (const [stored, expected] of [
    ['100L', '200L'],
    ['200L', '300L'],
    ['300L', '400L'],
    ['400L', '500L'],
    ['500L', '500L'],
  ]) {
    assert.equal(await levelAt(stored, null, '2026-11-06'), stored);
    for (const day of ['2026-11-07', '2026-11-18', '2026-12-01', '2027-11-06'])
      assert.equal(await levelAt(stored, null, day), expected);
  }
  assert.equal(await levelAt('100L', null, '2027-11-07'), '300L');
  assert.equal(await levelAt('100L', null, '2040-11-07'), '500L');
  assert.equal(await levelAt('legacy', null, '2026-11-18'), 'legacy');
  ok(
    'All five legacy tiers use the 2025/26 anchor, advance once on 7 November, never again on 1 December, and cap at 500L'
  );
  assert.equal(await levelAt('100L', 2026, '2026-10-25'), '100L');
  assert.equal(await levelAt('100L', 2026, '2026-11-07'), '100L');
  assert.equal(await levelAt('100L', 2026, '2027-11-07'), '200L');
  ok('An incoming level assigned to the upcoming session is not promoted at its own first November boundary');
  const cycle = await val("SELECT public.academic_cycle_year((now() AT TIME ZONE 'Africa/Lagos')::date)");
  const eff = (n) => val('SELECT public.get_effective_level($1)', [id(n)]);
  const today = await val("SELECT to_char(now() AT TIME ZONE 'Africa/Lagos','YYYY-MM-DD')");
  await as('authenticated', 4);
  assert.equal(await eff(4), await levelAt('400L', null, today));
  await as('authenticated', 5);
  assert.equal(await eff(5), '100L');
  await as('authenticated', 6);
  assert.equal(await eff(6), await levelAt('300L', null, today));
  ok(
    'Recognised older library levels are retained; the current level wins when present; no recorded tier means no invented promotion'
  );
  await as('authenticated', 1);
  await save(
    cycle + 1,
    1,
    `${cycle + 1}-10-25`,
    `${cycle + 2}-02-10`,
    `${cycle + 2}-02-22`,
    2,
    `i update ${cycle + 1}/${cycle + 2} first semester`
  );
  assert.equal(await val('SELECT public.academic_assignment_year()'), cycle + 1);
  await as(null);
  await q('INSERT INTO public.users(id) VALUES ($1)', [id(3)]);
  assert.equal(await val('SELECT level_base_year FROM public.users WHERE id=$1', [id(3)]), cycle + 1);
  ok(
    'An admin can publish the upcoming session before resumption; newly provisioned profiles receive that year by default'
  );
  await as('authenticated', 2);
  const ctx = await val('SELECT public.get_my_level_context()');
  assert.equal(ctx.account_id, id(2));
  assert.equal(ctx.assignment_year, cycle + 1);
  assert.equal(await val('SELECT public.get_effective_level($1)', [id(1)]), null);
  await assert.rejects(correct('200L', cycle + 1, 'wrong'), /confirmation/);
  await assert.rejects(correct('250L', cycle + 1, 'wrong'), /valid level/);
  await assert.rejects(correct('200L', cycle, 'wrong'), /session changed/);
  const previous = await eff(2);
  await assert.rejects(
    correct('200L', cycle + 1, `i update 200L for ${cycle + 1}/${cycle + 2}`, id(1)),
    /account changed/
  );
  assert.equal(await eff(2), previous);
  ok('An account switch between review and save cannot apply the previous account’s correction');
  assert.equal(await correct('200L', cycle + 1, `i update 200L for ${cycle + 1}/${cycle + 2}`), '200L');
  assert.equal(await val('SELECT public.get_effective_level($1)', [id(2)]), '200L');
  ok('Own profile only; level correction validates session, level and typed confirmation on the server');
  await q('UPDATE public.users SET username=$1,avatar_path=$2 WHERE id=$3', ['Reader', 'fixture.png', id(2)]);
  await as(null);
  const after = await rows();
  assert.deepEqual(after[0], before[0]);
  assert.equal(after[1].username, 'Reader');
  assert.equal(after[1].is_admin, false);
  assert.equal(after[1].current_level, '200L');
  assert.equal(await val('SELECT level_base_year FROM public.users WHERE id=$1', [id(2)]), cycle + 1);
  ok('Unrelated profile edits and owner/admin SQL flag management are preserved');
  await as('authenticated', 1);
  await save(
    cycle + 4,
    1,
    `${cycle + 4}-11-10`,
    `${cycle + 5}-03-01`,
    `${cycle + 5}-03-15`,
    3,
    `i update ${cycle + 4}/${cycle + 5} first semester`
  );
  assert.equal(await val('SELECT public.academic_assignment_year()'), cycle);
  await as('authenticated', 2);
  assert.equal(await val('SELECT public.get_effective_level($1)', [id(2)]), '200L');
  await as(null);
  assert.equal(await val('SELECT level_base_year FROM public.users WHERE id=$1', [id(2)]), cycle + 1);
  ok(
    'Changing the calendar does not rewrite existing anchors; an arbitrary future calendar cannot skip promotion years'
  );
  console.log(
    `Academic database rehearsal: ${checks.length} checks passed. Disposable in-memory database only.`
  );
} finally {
  await db.close();
}
