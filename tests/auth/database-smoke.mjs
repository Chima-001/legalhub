// Synthetic, in-memory PostgreSQL only. Never connects to a project or reads credentials.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const sql=readFileSync(new URL('../../database/migrations/005-open-email-registration.sql',import.meta.url),'utf8');
const legacyBody=readFileSync(new URL('legacy-body.sql.txt',import.meta.url),'utf8');
const db=new PGlite();
const q=async(s,args=[]) => (await db.query(s,args)).rows;
const scalar=async(s,args=[])=>Object.values((await q(s,args))[0])[0];
const checks=[];const ok=name=>{checks.push(name);console.log('PASS:',name)};
const member = i=>'00000000-0000-4000-8000-'+String(i).padStart(12,'0'); // synthetic fixture IDs only
const create = (i,email,meta={}) => q('INSERT INTO auth.users (id,email,raw_user_meta_data) VALUES($1,$2,$3::jsonb)',[member(i),email,JSON.stringify(meta)]);
const confirm = i=>q('UPDATE auth.users SET email_confirmed_at = now() WHERE id = $1',[member(i)]);
const profile = async i=>(await q('SELECT * FROM public.users WHERE id=$1',[member(i)]))[0];
const logCount=()=>scalar('SELECT count(*)::int FROM public.signup_log');
const roster=()=>q('SELECT * FROM public.allowed_students ORDER BY reg_number');
try {
 console.log(await scalar('SELECT version()'));
 await db.exec(`CREATE SCHEMA auth;
 CREATE TABLE auth.users (id uuid PRIMARY KEY, email text UNIQUE, raw_user_meta_data jsonb, email_confirmed_at timestamptz);
 CREATE TABLE public.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),full_name text NOT NULL,reg_number text UNIQUE NOT NULL,email text UNIQUE NOT NULL,email_verified boolean DEFAULT false,level text,created_at timestamptz DEFAULT now(),username text,is_admin boolean DEFAULT false,current_level text DEFAULT '100L',level_updated_at timestamptz DEFAULT now(),avatar_path text);
 CREATE TABLE public.allowed_students (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), reg_number text UNIQUE NOT NULL, full_name text NOT NULL, used boolean DEFAULT false, created_at timestamptz DEFAULT now());
 CREATE TABLE public.signup_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),reg_number text,username text,full_name text,confirmed_at timestamptz DEFAULT now());
 CREATE TABLE public.fixture_materials(id int PRIMARY KEY, uploaded_by uuid REFERENCES public.users(id));
 INSERT INTO public.allowed_students(reg_number,full_name) VALUES ('TEST-OLD','Fixture Member'),('TEST-PENDING','Pending Fixture');`);
 // Model the separate, still-live email mirror: only a changed Auth email on a confirmed ID.
 await db.exec(`CREATE FUNCTION public.handle_email_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
begin
  if new.email <> old.email and new.email_confirmed_at is not null then
    update public.users set email = new.email where id = new.id;
  end if;
  return new;
end;
$$; CREATE TRIGGER on_auth_user_email_changed AFTER UPDATE ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_email_change();`);
 assert.equal(await scalar("SELECT md5(prosrc) FROM pg_proc WHERE oid='public.handle_email_change()'::regprocedure"),'3f4ee4a7a27c29596fbde7de57da15de');
 const legacy=`CREATE OR REPLACE FUNCTION public.handle_new_confirmed_user() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $old$${legacyBody}$old$;`;
 await db.exec(legacy+`CREATE TRIGGER on_auth_user_confirmed AFTER UPDATE ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_confirmed_user();`);
 await create(1,'existing@example.test',{reg_number:'TEST-OLD',username:'Existing'});await confirm(1);
 await q('UPDATE public.users SET is_admin=true WHERE id=$1',[member(1)]);await q('INSERT INTO public.fixture_materials VALUES (1,$1)',[member(1)]);
 const oldProfile=await profile(1),oldRoster=await roster(),oldLog=await q('SELECT * FROM public.signup_log ORDER BY id');
 await create(2,'pending@example.test',{reg_number:'TEST-PENDING'});
 // Confirm the preflight refuses a different trigger body before altering a column.
 await db.exec(legacy.replace('return new;', 'return NEW;'));
 await assert.rejects(db.exec(sql),/differs from the reviewed baseline/);await db.exec('ROLLBACK');
 assert.equal(await scalar("SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='reg_number'"),'NO');ok('Drift guard aborts without changing the old column definition');
 await db.exec(legacy);
 // Harmless, empty fixture routines; their bodies are never invoked by this test.
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated;
   CREATE FUNCTION public.reset_test_signup(text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$BEGIN RETURN; END$$;
   CREATE FUNCTION public.reset_test_signup(text,text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$BEGIN RETURN; END$$;`);
 await assert.rejects(db.exec(sql),/Privileged test-maintenance/);await db.exec('ROLLBACK');ok('Open-signup draft stops if browser roles retain owner-privileged maintenance access');
 // This represents the already-completed live maintenance restriction on EMPTY fixture routines only.
 await db.exec(`REVOKE EXECUTE ON FUNCTION public.reset_test_signup(text), public.reset_test_signup(text,text) FROM PUBLIC,anon,authenticated;`);
 assert.equal(await scalar("SELECT count(*)::int FROM pg_catalog.pg_proc p WHERE p.proname='reset_test_signup' AND (has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE'))"),0);ok('Separate access fix resolves the effective permissions without invoking a maintenance function');
 // Mirror the reviewed effective grants and own-row rules in this in-memory database only.
 await db.exec(`ALTER TABLE public.users ENABLE ROW LEVEL SECURITY; ALTER TABLE public.allowed_students ENABLE ROW LEVEL SECURITY; ALTER TABLE public.signup_log ENABLE ROW LEVEL SECURITY;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('fixture.uid',true),'')::uuid$$;
 GRANT USAGE ON SCHEMA auth TO authenticated; GRANT SELECT ON public.users TO authenticated;
 GRANT UPDATE(username,current_level,level_updated_at,avatar_path) ON public.users TO authenticated;
 CREATE POLICY fixture_self_read ON public.users FOR SELECT TO authenticated USING (auth.uid()=id);
 CREATE POLICY fixture_self_write ON public.users FOR UPDATE TO authenticated USING (auth.uid()=id) WITH CHECK (auth.uid()=id);
 GRANT TRUNCATE,TRIGGER,REFERENCES,MAINTAIN ON TABLE public.users,public.allowed_students,public.signup_log TO anon,authenticated;`);
 await assert.rejects(db.exec(sql),/administrative table privileges/);await db.exec('ROLLBACK');
 assert.equal(await scalar("SELECT attnotnull FROM pg_attribute WHERE attrelid='public.users'::regclass AND attname='reg_number'"),true);ok('New preflight stops on administrative table grants before changing profile columns');
 await db.exec(readFileSync(new URL('../../database/migrations/004-signup-table-grants.sql',import.meta.url),'utf8'));
 for(const r of ['anon','authenticated'])for(const table of ['public.users','public.allowed_students','public.signup_log']){
  assert.equal(await scalar('SELECT has_table_privilege($1::name,$2::text,$3::text)',[r,table,'TRUNCATE,TRIGGER,REFERENCES,MAINTAIN']),false);
 }
 assert.equal(await scalar("SELECT has_table_privilege('authenticated','public.users','SELECT')"),true);
 for(const c of ['username','current_level','level_updated_at','avatar_path'])assert.equal(await scalar("SELECT has_column_privilege('authenticated','public.users',$1::text,'UPDATE')",[c]),true);
 ok('Permission fix removes all four administrative grants for both web roles on all three tables; profile SELECT and four editable columns remain');
 // Simulate schema drift via DDL only, never a role-changing data write.
 await db.exec('GRANT UPDATE(is_admin) ON public.users TO authenticated');
 await assert.rejects(db.exec(sql),/Profile RLS or web-role writes/);await db.exec('ROLLBACK');
 await db.exec('REVOKE UPDATE(is_admin) ON public.users FROM authenticated');ok('Open signup refuses writable protected profile columns');
 const statusSQL=readFileSync(new URL('../../database/checks/signup-status.sql',import.meta.url),'utf8');
 const status=async()=> (await q(statusSQL))[0].status;
 const originalRPCs=readFileSync(new URL('legacy-lookups.sql.txt',import.meta.url),'utf8');
 await db.exec(originalRPCs);assert.equal(await status(),'CHECK SIGNUP CONTRACT');
 const eligible=n=>scalar('SELECT public.check_student_eligibility($1)',[n]);
 const lookup=n=>scalar('SELECT public.get_email_by_reg_number($1)',[n]);
 const aliases=()=>scalar('SELECT count(*)::int FROM lh_signup_private.legacy_login');
 assert.equal(await eligible('TEST-PENDING'),true);assert.equal(await lookup('TEST-OLD'),'existing@example.test');
 await db.exec('ALTER FUNCTION public.get_email_by_reg_number(text) RENAME TO fixture_saved_lookup; CREATE FUNCTION public.get_email_by_reg_number(p_reg_number text) RETURNS text LANGUAGE sql AS $$ SELECT NULL::text $$');
 await assert.rejects(db.exec(sql),/Unexpected legacy login/);await db.exec('ROLLBACK');
 assert.equal(await scalar("SELECT to_regnamespace('lh_signup_private') IS NULL"),true);
 await db.exec('DROP FUNCTION public.get_email_by_reg_number(text); ALTER FUNCTION public.fixture_saved_lookup(text) RENAME TO get_email_by_reg_number');
 ok('An unrecognised return-login routine refuses the migration before any schema change');
 await db.exec(sql);
 assert.equal(await aliases(),0);assert.equal(await status(),'BOTH SIGNUP CLIENTS READY');
 assert.deepEqual(await profile(1),oldProfile);assert.deepEqual(await roster(),oldRoster);assert.deepEqual(await q('SELECT * FROM public.signup_log ORDER BY id'),oldLog);assert.equal(await scalar('SELECT uploaded_by FROM public.fixture_materials WHERE id=1'),member(1));ok('Migration does not rewrite an existing admin, its material link, the roster or historical log');
 await confirm(2);const p2=await profile(2);assert(p2);assert.equal(p2.reg_number,null);assert.equal(p2.full_name,null);assert.deepEqual(await roster(),oldRoster);ok('Pending pre-cutover signup confirms under its original ID without consuming its roster entry');
 assert.equal(await lookup('TEST-PENDING'),'pending@example.test');assert.equal(await eligible('TEST-PENDING'),false);assert.equal(await aliases(),1);
 assert.equal(await lookup('TEST-OLD'),'existing@example.test');ok('A pre-cutover unconfirmed signup can return through the original number lookup or email without claiming an official identity');
 await create(3,'new@example.test');assert.equal(await profile(3),undefined);assert.equal(await logCount(),2);ok('Unconfirmed email does not create a profile or confirmation log');
 await confirm(3);const p3=await profile(3);assert.equal(p3.email,'new@example.test');assert.equal(p3.reg_number,null);assert.equal(p3.full_name,null);assert.equal(p3.username,null);assert.equal(p3.email_verified,true);assert.equal(p3.is_admin,false);assert.equal(p3.current_level,'100L');ok('Confirmed personal email with no optional fields receives an ordinary profile and original defaults');
 await create(4,'reported@example.test',{reported_reg_number:'TEST-OLD',username:'  Reader  '});await confirm(4);
 const p4=await profile(4);assert.equal(p4.reg_number,null);assert.equal(p4.full_name,null);assert.equal(p4.username,'Reader');assert.equal(p4.is_admin,false);assert.deepEqual(await roster(),oldRoster);assert.deepEqual(await profile(1),oldProfile);assert.equal(await scalar("SELECT raw_user_meta_data->>'reported_reg_number' FROM auth.users WHERE id=$1",[member(4)]),'TEST-OLD');ok('An overlapping self-reported number is retained only as a claim and does not alter the existing owner');
 const audit=await q("SELECT reg_number,full_name,username FROM public.signup_log WHERE username='Reader'");assert.deepEqual(audit,[{reg_number:null,full_name:null,username:'Reader'}]);const beforeLog=await logCount();
 await q('UPDATE auth.users SET raw_user_meta_data=raw_user_meta_data WHERE id=$1',[member(4)]);assert.equal(await logCount(),beforeLog);ok('Audit entry written once; unrelated Auth updates do not re-provision');
 await q('UPDATE auth.users SET email_confirmed_at=NULL WHERE id=$1',[member(4)]);await confirm(4);assert.deepEqual(await profile(4),p4);assert.equal(await logCount(),beforeLog);ok('Reconfirmation of an existing profile neither overwrites it nor logs a duplicate');
 await assert.rejects(q('UPDATE public.users SET reg_number=$1 WHERE id=$2',['TEST-OLD',member(4)]),/duplicate key/i);await assert.rejects(q('UPDATE public.users SET email=$1 WHERE id=$2',['existing@example.test',member(4)]),/duplicate key/i);ok('Official-number and email uniqueness are preserved; multiple unassigned numbers coexist');
 await q('INSERT INTO public.users (id,email) VALUES($1,$2)',[member(50),'conflict@example.test']);await create(51,'conflict@example.test');await assert.rejects(confirm(51),/duplicate key/i);assert.equal(await profile(51),undefined);assert.equal(await scalar('SELECT email_confirmed_at FROM auth.users WHERE id=$1',[member(51)]),null);assert.equal(await logCount(),beforeLog);ok('An email collision fails closed and never merges separate IDs');
 await db.exec("ALTER TABLE public.signup_log ADD CONSTRAINT fixture_log_failure CHECK (username IS DISTINCT FROM 'FixtureDenied')");await create(60,'audit@example.test',{username:'FixtureDenied'});await assert.rejects(confirm(60),/fixture_log_failure/);assert.equal(await profile(60),undefined);assert.equal(await scalar('SELECT email_confirmed_at FROM auth.users WHERE id=$1',[member(60)]),null);ok('A log-write failure rolls back confirmation and profile insertion together');
 await create(70,'role-fixture@example.test',{is_admin:true,reg_number:'TEST-OLD',full_name:'Untrusted',email:'untrusted@example.test'});await confirm(70);
 const p70=await profile(70);assert.equal(p70.is_admin,false);assert.equal(p70.reg_number,null);assert.equal(p70.full_name,null);assert.equal(p70.email,'role-fixture@example.test');assert.deepEqual(await roster(),oldRoster);ok('Only Auth supplies identity; client metadata cannot assign canonical fields or the admin flag');
 await q('UPDATE auth.users SET email=$1 WHERE id=$2',['changed@example.test',member(70)]);
 assert.equal((await profile(70)).email,'changed@example.test');assert.equal((await profile(70)).id,member(70));assert.equal((await profile(70)).is_admin,false);assert.deepEqual(await profile(1),oldProfile);ok('The separate live-compatible email mirror still follows the same confirmed Auth UUID');
 await db.exec('SET ROLE authenticated');
 try {
   await q("SELECT set_config('fixture.uid',$1,false)",[member(70)]);
   assert.deepEqual(await q('SELECT id FROM public.users'),[{id:member(70)}]);
   assert.deepEqual(await q('UPDATE public.users SET username=$1 WHERE id=$2 RETURNING id',['My reader name',member(70)]),[{id:member(70)}]);
   for(const c of ['id','is_admin','email','email_verified','reg_number','full_name'])assert.equal(await scalar("SELECT has_column_privilege(current_user,'public.users',$1::text,'UPDATE')",[c]),false);
 }finally{await db.exec('RESET ROLE');}
 assert.deepEqual(await profile(1),oldProfile);assert.equal((await profile(70)).username,'My reader name');ok('New ordinary member can read and edit their own display field under RLS; protected columns are not writable');
 const addNumber=(n)=>q('INSERT INTO public.allowed_students(reg_number,full_name) VALUES($1,$2)',[n,'Private fixture student']);
 for(const n of ['TEST-FRESH','TEST-REPORTED','TEST-MIXED','TEST-FAIL'])await addNumber(n);
 await create(80,'old-form@example.test',{reg_number:'TEST-FRESH',username:' Legacy ',full_name:'Not trusted',level:'500L',is_admin:true});
 assert.equal(await lookup('TEST-FRESH'),null);await confirm(80);
 const late=await profile(80);assert.equal(late.username,'Legacy');assert.equal(late.is_admin,false);assert.equal(late.reg_number,null);assert.equal(late.full_name,null);assert.equal(late.current_level,'100L');
 assert.equal(await lookup('TEST-FRESH'),'old-form@example.test');assert.equal(await aliases(),2);assert.equal(await eligible('TEST-FRESH'),false);
 assert.equal(await scalar("SELECT used FROM public.allowed_students WHERE reg_number='TEST-FRESH'"),false);
 ok('A still-published old signup qualifies before verification, signs in by number afterward, and receives only an ordinary account');
 await create(81,'claimed@example.test',{reported_reg_number:'TEST-REPORTED'});await confirm(81);
 await create(82,'mixed@example.test',{reg_number:'TEST-MIXED',reported_reg_number:'TEST-MIXED'});await confirm(82);
 for(const n of ['TEST-REPORTED','TEST-MIXED']){assert.equal(await eligible(n),true);assert.equal(await lookup(n),null);}
 assert.equal(await aliases(),2);ok('Neither a self-report matching a free roster number nor mixed old/new fields reserve a login or expose a roster name');
 for(const [i,n] of [[83,'TEST-FRESH'],[84,'TEST-OLD'],[85,'MISSING']]){await create(i,`overlap${i}@example.test`,{reg_number:n});await confirm(i);assert.equal((await profile(i)).is_admin,false);assert.equal((await profile(i)).reg_number,null);}
 assert.equal(await lookup('TEST-FRESH'),'old-form@example.test');assert.equal(await lookup('TEST-OLD'),'existing@example.test');assert.equal(await lookup('MISSING'),null);assert.equal(await aliases(),2);
 ok('A duplicate, already official or unknown number cannot replace another login; the verified email still gets its own profile');
 await q("UPDATE auth.users SET raw_user_meta_data=$2::jsonb,email='old-updated@example.test' WHERE id=$1",[member(80),JSON.stringify({reg_number:'TEST-MIXED'})]);
 assert.equal(await lookup('TEST-FRESH'),'old-updated@example.test');assert.equal(await lookup('TEST-MIXED'),null);
 await q("UPDATE auth.users SET email_confirmed_at=NULL WHERE id=$1",[member(80)]);const count=await logCount();await confirm(80);assert.equal(await aliases(),2);assert.equal(await logCount(),count);
 ok('Login hint is bound to the UUID, follows a confirmed email change, and cannot be retargeted by metadata edits or reconfirmation');
 await q("UPDATE public.allowed_students SET reg_number='CHANGED-NUMBER' WHERE reg_number='TEST-FRESH'");assert.equal(await lookup('CHANGED-NUMBER'),null);assert.equal(await lookup('TEST-FRESH'),null);
 await q("UPDATE public.allowed_students SET reg_number='TEST-FRESH' WHERE reg_number='CHANGED-NUMBER'");
 await q("UPDATE public.allowed_students SET used=true WHERE reg_number='TEST-FRESH'");assert.equal(await lookup('TEST-FRESH'),null);
 await q("UPDATE public.allowed_students SET used=false WHERE reg_number='TEST-FRESH'");
 await q('INSERT INTO public.users(id,email,reg_number) VALUES($1,$2,$3)',[member(100),'official@example.test','TEST-FRESH']);assert.equal(await lookup('TEST-FRESH'),'official@example.test');
 ok('Changed or withdrawn roster entries do not redirect a hint; an official account always wins');
 await create(86,'failed-log@example.test',{reg_number:'TEST-FAIL',username:'FixtureDenied'});await assert.rejects(confirm(86),/fixture_log_failure/);assert.equal(await eligible('TEST-FAIL'),true);assert.equal(await profile(86),undefined);assert.equal(await aliases(),2);
 ok('A failed audit write rolls back the login hint, profile and confirmation together');
 for(const role of ['anon','authenticated']){
   await db.exec('SET ROLE '+role);
   try {await assert.rejects(q('SELECT account_id FROM lh_signup_private.legacy_login'),/permission denied/);
     assert.equal(await lookup('TEST-PENDING'),'pending@example.test');assert.equal(await eligible('TEST-PENDING'),false);
     for(const mail of ['fresh@example.test','nobody@example.test'])assert.equal(await lookup(mail),mail);
   } finally{await db.exec('RESET ROLE');}
 }
 ok('Both web roles retain only the existing lookup interface, not the private mapping; email fallback is independent of existence');
 await assert.rejects(db.exec(sql),/differs from the reviewed baseline/);await db.exec('ROLLBACK');assert.equal(await aliases(),2);assert.deepEqual(await profile(1),oldProfile);
 ok('Reapplying stops with confirmed accounts, grants and hints intact');
 console.log(`Database rehearsal: ${checks.length} scenarios passed.`);
}finally{await db.close();}
