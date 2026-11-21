// Disposable PostgreSQL only. Never connect this harness to a project URL.
import { PGlite } from '../auth/node_modules/@electric-sql/pglite/dist/index.js';
import { readFile } from 'node:fs/promises';
const file = (name) => readFile(new URL('../../database/migrations/' + name, import.meta.url), 'utf8');
export const uid = (n) => 'a0000000-0000-4000-8000-' + String(n).padStart(12, '0');
export async function fixture() {
  const db = new PGlite();
  const sql = await file('008-admin-authority.sql');
  const query = async (text, args = []) => (await db.query(text, args)).rows;
  const scalar = async (text, args = []) => Object.values((await query(text, args))[0])[0];
  await db.exec(`CREATE SCHEMA auth; CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.viewer',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO authenticated;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,deleted_at timestamptz,banned_until timestamptz);
    CREATE TABLE public.users(id uuid PRIMARY KEY,is_admin boolean DEFAULT false, email text, username text, reg_number text UNIQUE);
    ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
    GRANT SELECT, UPDATE(username) ON public.users TO authenticated;
    CREATE POLICY own_read ON public.users FOR SELECT TO authenticated USING(id=auth.uid());
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated;`);
  for (let i = 1; i <= 6; i++) {
    await query(
      'INSERT INTO auth.users(id,email,email_confirmed_at) VALUES ($1,$2,CASE WHEN $3::boolean THEN now() END)',
      [uid(i), `reader${i}@example.test`, i !== 5],
    );
    await query(
      'INSERT INTO public.users(id,is_admin,email,username,reg_number) VALUES ($1,$2,$3,$4,$5)',
      [uid(i), i <= 2, `profile${i}@example.test`, 'Reader ' + i, 'FIX-REG-' + i],
    );
  }
  await db.exec(await file('006-academic-calendar.sql'));
  async function as(i, role = i ? 'authenticated' : null) {
    if (![null, 'anon', 'authenticated'].includes(role)) throw Error('Unknown fixture role');
    await db.exec('RESET ROLE');
    await query("SELECT set_config('test.viewer',$1,false)", [i ? uid(i) : '']);
    if (role) await db.exec('SET ROLE ' + role);
  }
  async function bind(i = 1, reg = 'FIX-REG-' + i, email = `reader${i}@example.test`) {
    for (const [key, value] of Object.entries({ uuid: uid(i), reg, email }))
      await query('SELECT set_config($1,$2,false)', ['legalhub.install_owner_' + key, value]);
  }
  const calls = {
    lh_admin_capabilities: [],
    get_academic_calendar: [],
    lh_review_admin: ['p_actor', 'p_email'],
    lh_change_admin: ['p_actor', 'p_target', 'p_email', 'p_grant', 'p_version', 'p_confirmation'],
    save_academic_calendar: [
      'p_session_year',
      'p_semester',
      'p_semester_start',
      'p_exam_start',
      'p_exam_end',
      'p_expected_revision',
      'p_confirmation',
    ],
  };
  async function rpc(name, args = {}) {
    if (!Object.hasOwn(calls, name)) throw Error('Unknown fixture RPC');
    const keys = calls[name];
    return scalar(
      `SELECT public.${name}(${keys.map((_, i) => '$' + (i + 1)).join(',')})`,
      keys.map((k) => args[k] ?? null),
    );
  }
  return { db, sql, as, query, scalar, rpc, bind, calls };
}
