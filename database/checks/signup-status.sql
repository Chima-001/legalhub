-- Read-only catalogue check, not a signup or a production mailbox test. PostgreSQL 17+.
WITH expected(fn,body) AS (VALUES
  ('public.handle_new_confirmed_user()', '01bced5f720ced8f5503141107eaa15f'),
  ('public.check_student_eligibility(text)', '779fcc639b6e004799555609d290f142'),
  ('public.get_email_by_reg_number(text)', '246993505ecf02938537b1c3575d4ed7')
), checks AS (
 SELECT
   (SELECT count(*)=3 FROM expected e JOIN pg_proc p ON p.oid=to_regprocedure(e.fn)
     WHERE md5(replace(p.prosrc,chr(13),''))=e.body AND p.prosecdef AND 'search_path=pg_catalog, pg_temp'=ANY(p.proconfig)) AS handlers_match,
   EXISTS (SELECT FROM pg_trigger t WHERE t.tgrelid='auth.users'::regclass AND t.tgname='on_auth_user_confirmed' AND t.tgtype=17
     AND t.tgenabled IN ('O','A') AND NOT t.tgisinternal AND t.tgattr::text='' AND t.tgqual IS NULL AND t.tgfoid=to_regprocedure('public.handle_new_confirmed_user()')) AS confirmation_hook,
   (SELECT count(*)=2 FROM pg_attribute WHERE attrelid='public.users'::regclass AND attname IN ('reg_number','full_name') AND NOT attnotnull AND NOT attisdropped) AS ordinary_fields,
   EXISTS (SELECT FROM pg_class c WHERE c.oid=to_regclass('lh_signup_private.legacy_login') AND c.relrowsecurity
     AND NOT EXISTS (SELECT FROM pg_policy WHERE polrelid=c.oid)
     AND NOT EXISTS (SELECT FROM (VALUES ('anon'::name),('authenticated'::name)) r(n)
       WHERE has_schema_privilege(r.n,c.relnamespace,'USAGE,CREATE') OR has_any_column_privilege(r.n,c.oid,'SELECT,INSERT,UPDATE,REFERENCES')
         OR has_table_privilege(r.n,c.oid,'DELETE,TRUNCATE,TRIGGER,MAINTAIN'))) AS hints_private,
   (SELECT count(*)=2 FROM pg_proc p WHERE p.oid IN (to_regprocedure('public.get_email_by_reg_number(text)'),to_regprocedure('public.check_student_eligibility(text)'))
     AND has_function_privilege('anon',p.oid,'EXECUTE') AND has_function_privilege('authenticated',p.oid,'EXECUTE')) AS old_clients_allowed
)
SELECT checks.*, CASE WHEN handlers_match AND confirmation_hook AND ordinary_fields AND hints_private AND old_clients_allowed
 THEN 'BOTH SIGNUP CLIENTS READY' ELSE 'CHECK SIGNUP CONTRACT' END AS status FROM checks;
