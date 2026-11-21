-- Read-only (Postgres 17). No profile, term, account, roster or email rows are read.
-- Run privately as the operator on the intended project; this identifies schema state, not deployment.
WITH expected(signature,name,body_hash,returns,definer) AS (VALUES
  ('public.academic_cycle_year(date)','academic_cycle_year','487cca9c7513f0bdf3e0881282c9b9bb','integer'::regtype,false),
  ('public.academic_assignment_year()','academic_assignment_year','1ba9991ecef86fe748fc11fef938efaf','integer'::regtype,false),
  ('public.academic_level_on(text,integer,date)','academic_level_on','b2d07590b44d88f19663a0158811a884','text'::regtype,false),
  ('public.get_effective_level(uuid)','get_effective_level','a9bef8136f08c9f83c8681b01702d627','text'::regtype,false),
  ('public.get_my_level_context()','get_my_level_context','0504258bccf6cdd1e2fd50ef5b454173','jsonb'::regtype,false),
  ('public.set_my_academic_level(text,integer,text,uuid)','set_my_academic_level','e2102e7ac500cb00f63e726153598db1','text'::regtype,true)
), roles(r) AS (VALUES ('anon'::name),('authenticated'::name)), facts AS (
 SELECT (SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('public.users')) AS rls,
        coalesce(has_table_privilege('authenticated',to_regclass('public.academic_term'),'SELECT'),false) AS calendar,
        has_table_privilege('authenticated','public.users','SELECT') AND has_schema_privilege('authenticated','public','USAGE') AND has_function_privilege('authenticated','auth.uid()','EXECUTE') AS own_reads,
        (SELECT count(*)=4 FROM pg_attribute WHERE attrelid='public.users'::regclass AND attnum>0 AND NOT attisdropped AND attname IN ('id','current_level','level_updated_at','level')) AS fields,
        NOT EXISTS(SELECT FROM roles WHERE has_schema_privilege(r,'public','CREATE') OR has_table_privilege(r,'public.users','UPDATE,DELETE,TRIGGER,TRUNCATE,REFERENCES,MAINTAIN') OR has_any_column_privilege(r,'public.users','INSERT') OR has_column_privilege(r,'public.users','is_admin','UPDATE') OR has_column_privilege(r,'public.users','level','UPDATE')) AS safe_baseline,
        EXISTS(SELECT FROM pg_proc WHERE oid=to_regprocedure('public.get_effective_level(uuid)') AND prorettype='text'::regtype AND proargnames=ARRAY['p_uid']::text[] AND md5(replace(prosrc,chr(13),''))='2639e14bfd9df4cb66ddc38e9e41410a') AS prior_reader,
        (SELECT count(*) FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN (SELECT name FROM expected)) AS named_slots,
        EXISTS(SELECT FROM pg_attribute WHERE attrelid='public.users'::regclass AND attname='level_base_year' AND NOT attisdropped) AS anchor,
        EXISTS(SELECT FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid='public.users'::regclass AND a.attname='level_base_year' AND a.atttypid='integer'::regtype AND NOT a.attnotnull AND pg_get_expr(d.adbin,d.adrelid) IN ('academic_assignment_year()','public.academic_assignment_year()')) AS anchor_default,
        (SELECT count(*)=6 FROM expected e JOIN pg_proc p ON p.oid=to_regprocedure(e.signature) WHERE p.prorettype=e.returns AND md5(replace(p.prosrc,chr(13),''))=e.body_hash AND p.prosecdef=e.definer AND has_function_privilege('authenticated',p.oid,'EXECUTE') AND NOT has_function_privilege('anon',p.oid,'EXECUTE')) AS reviewed_rpcs,
        EXISTS(SELECT FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE t.tgrelid='public.users'::regclass AND t.tgname='lh_anchor_own_profile_level' AND t.tgenabled IN ('O','A') AND t.tgtype=19 AND p.oid=to_regprocedure('public.lh_anchor_own_profile_level()') AND NOT p.prosecdef AND md5(replace(p.prosrc,chr(13),''))='493bcaa0590f17c4bb584f564eb1a65b' AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE') AND NOT has_function_privilege('anon',p.oid,'EXECUTE')) AS writer_guard,
        has_column_privilege('authenticated','public.users','current_level','UPDATE') AND has_column_privilege('authenticated','public.users','level_updated_at','UPDATE') AND NOT has_any_column_privilege('anon','public.users','UPDATE') AS self_columns,
        NOT EXISTS(SELECT FROM pg_attribute a WHERE a.attrelid='public.users'::regclass AND a.attname='level_base_year' AND NOT a.attisdropped AND has_column_privilege('authenticated',a.attrelid,a.attnum,'UPDATE')) AS protected_anchor
)
SELECT CASE WHEN rls AND calendar AND own_reads AND fields AND safe_baseline AND prior_reader AND named_slots=1 AND NOT anchor AND self_columns THEN 'READY TO REVIEW 007'
            WHEN rls AND calendar AND own_reads AND fields AND safe_baseline AND named_slots=6 AND anchor AND anchor_default AND reviewed_rpcs AND writer_guard AND self_columns AND protected_anchor THEN 'BOTH PROFILE EDITORS READY'
            ELSE 'STOP: REVIEW LEVEL SCHEMA' END AS profile_level_status FROM facts;
