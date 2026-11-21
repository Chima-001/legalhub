-- LegalHub: one full frontend publish; both signup/login contracts are supported.
-- Replaces the never-applied signup draft. Run once only on the reviewed legacy baseline.
-- No profile/roster/auth/log backfill. No new public endpoint. Do not replay other migrations.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '20s';
-- An in-flight confirmation finishes on one contract, never half of each.
LOCK TABLE auth.users IN SHARE ROW EXCLUSIVE MODE;
DO $guard$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
    WHERE t.tgrelid='auth.users'::regclass AND t.tgname='on_auth_user_confirmed' AND t.tgtype=17
      AND NOT t.tgisinternal AND t.tgenabled IN ('O','A') AND t.tgqual IS NULL AND t.tgattr::text=''
      AND p.oid='public.handle_new_confirmed_user()'::regprocedure AND p.prosecdef AND p.proowner=current_user::regrole
      AND md5(replace(p.prosrc,chr(13),''))='49913e2910d3ec06670725d830b2538b') THEN
    RAISE EXCEPTION 'Confirmation trigger differs from the reviewed baseline';
  END IF;
  IF EXISTS (SELECT FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname='reset_test_signup' AND p.prosecdef
    AND (has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE'))) THEN
    RAISE EXCEPTION 'Privileged test-maintenance access must be restricted first';
  END IF;
  IF EXISTS (SELECT FROM (VALUES ('anon'::name),('authenticated'::name)) r(role_name),
    (VALUES ('public.users'::regclass),('public.allowed_students'::regclass),('public.signup_log'::regclass)) t(id)
    WHERE has_table_privilege(r.role_name,t.id,'TRUNCATE,TRIGGER,REFERENCES,MAINTAIN')) THEN
    RAISE EXCEPTION 'Unexpected administrative table privileges';
  END IF;
  IF EXISTS (SELECT FROM pg_class WHERE oid IN ('public.users'::regclass,'public.allowed_students'::regclass,'public.signup_log'::regclass) AND NOT relrowsecurity)
    OR EXISTS (SELECT FROM (VALUES ('anon'::name),('authenticated'::name)) r(role_name),
      (VALUES ('public.users'::regclass),('public.allowed_students'::regclass),('public.signup_log'::regclass)) t(id)
      WHERE has_any_column_privilege(r.role_name,t.id,'INSERT') OR has_table_privilege(r.role_name,t.id,'DELETE')
        OR EXISTS (SELECT FROM pg_attribute a WHERE a.attrelid=t.id AND a.attnum>0 AND NOT a.attisdropped
          AND (t.id<>'public.users'::regclass OR a.attname NOT IN ('username','current_level','level_updated_at','avatar_path'))
          AND has_column_privilege(r.role_name,t.id,a.attnum,'UPDATE'))) THEN
    RAISE EXCEPTION 'Profile RLS or web-role writes differ from the reviewed baseline';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='signup_log'
    AND column_name IN ('reg_number','full_name','username') AND is_nullable='YES' AND data_type='text')<>3 THEN
    RAISE EXCEPTION 'Unexpected signup log definition';
  END IF;
  IF to_regnamespace('lh_signup_private') IS NOT NULL OR (SELECT count(*) FROM pg_attribute WHERE attrelid='public.users'::regclass
    AND attname IN ('reg_number','full_name') AND atttypid='text'::regtype AND attnotnull AND NOT attisdropped)<>2
    OR (SELECT count(*) FROM pg_proc p JOIN (VALUES
       ('public.check_student_eligibility(text)'::regprocedure,'c41b52529200facc7a9b67a909bf8f63','boolean'::regtype),
       ('public.get_email_by_reg_number(text)'::regprocedure,'ecc2987f035519f87a9ca827ac2d6ca3','text'::regtype)) v(id,body,ret)
       ON p.oid=v.id WHERE p.proowner=current_user::regrole AND p.proargnames=ARRAY['p_reg_number'] AND p.prosecdef AND p.prorettype=v.ret
       AND md5(replace(p.prosrc,chr(13),''))=v.body AND has_function_privilege('anon',p.oid,'EXECUTE')
       AND has_function_privilege('authenticated',p.oid,'EXECUTE'))<>2 THEN
    RAISE EXCEPTION 'Unexpected legacy login/signup contract; do not force';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE t.tgrelid='auth.users'::regclass
    AND t.tgname='on_auth_user_email_changed' AND t.tgtype=17 AND NOT t.tgisinternal AND t.tgenabled IN ('O','A') AND t.tgqual IS NULL AND t.tgattr::text=''
    AND p.oid='public.handle_email_change()'::regprocedure AND p.prosecdef AND md5(replace(p.prosrc,chr(13),''))='3f4ee4a7a27c29596fbde7de57da15de') THEN
    RAISE EXCEPTION 'Unexpected confirmed-email mirror';
  END IF;
  IF (SELECT count(*) FROM (VALUES ('public.users'::regclass,'id','p'),('public.users'::regclass,'reg_number','u'),
    ('public.users'::regclass,'email','u'),('public.allowed_students'::regclass,'id','p'),('public.allowed_students'::regclass,'reg_number','u')) v(id,col,kind)
    WHERE EXISTS (SELECT FROM pg_attribute a JOIN pg_constraint k ON k.conrelid=a.attrelid AND k.conkey=ARRAY[a.attnum]
      JOIN pg_index i ON i.indexrelid=k.conindid
      WHERE a.attrelid=v.id AND a.attname=v.col AND k.contype::text=v.kind AND k.convalidated AND NOT k.condeferrable
        AND i.indisvalid AND NOT i.indnullsnotdistinct))<>5 THEN
    RAISE EXCEPTION 'Required identity and uniqueness constraints not found';
  END IF;
END;
$guard$;

ALTER TABLE public.users ALTER COLUMN reg_number DROP NOT NULL, ALTER COLUMN full_name DROP NOT NULL;
CREATE SCHEMA lh_signup_private;
REVOKE ALL ON SCHEMA lh_signup_private FROM PUBLIC,anon,authenticated;
-- A login hint, not a student identity. No names, emails or plaintext numbers stored here.
CREATE TABLE lh_signup_private.legacy_login (
  roster_id uuid NOT NULL REFERENCES public.allowed_students(id) ON DELETE CASCADE,
  number_tag bytea NOT NULL,
  account_id uuid NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  PRIMARY KEY (roster_id,number_tag)
);
ALTER TABLE lh_signup_private.legacy_login ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE lh_signup_private.legacy_login FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.check_student_eligibility(p_reg_number text) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $eligibility$
  SELECT EXISTS (SELECT FROM public.allowed_students r WHERE r.reg_number=p_reg_number AND r.used IS FALSE
    AND NOT EXISTS (SELECT FROM public.users u WHERE u.reg_number=r.reg_number)
    AND NOT EXISTS (SELECT FROM lh_signup_private.legacy_login h WHERE h.roster_id=r.id AND h.number_tag=sha256(convert_to(r.reg_number,'UTF8'))));
$eligibility$;

CREATE OR REPLACE FUNCTION public.get_email_by_reg_number(p_reg_number text) RETURNS text
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $login$
  SELECT coalesce(
    (SELECT u.email FROM public.users u WHERE u.reg_number=p_reg_number),
    (SELECT u.email FROM public.allowed_students r JOIN lh_signup_private.legacy_login h
       ON h.roster_id=r.id AND h.number_tag=sha256(convert_to(r.reg_number,'UTF8'))
       JOIN public.users u ON u.id=h.account_id
       WHERE r.reg_number=p_reg_number AND r.used IS FALSE AND u.email_verified IS TRUE AND u.reg_number IS NULL),
    -- A stale text-based sign-in page can also pass an email to Auth. Echo the input;
    -- do not look up whether this email exists. Auth still verifies the password.
    CASE WHEN octet_length(p_reg_number)<=320 AND p_reg_number ~ '^[^[:space:]@]+@[^[:space:]@]+$' THEN p_reg_number END);
$login$;

CREATE OR REPLACE FUNCTION public.handle_new_confirmed_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $confirmation$
DECLARE display_name text; old_hint text;
BEGIN
  IF TG_RELID<>'auth.users'::regclass OR TG_OP<>'UPDATE' THEN RAISE EXCEPTION 'Unexpected confirmation trigger binding'; END IF;
  IF OLD.email_confirmed_at IS NOT NULL OR NEW.email_confirmed_at IS NULL THEN RETURN NEW; END IF;
  IF jsonb_typeof(NEW.raw_user_meta_data->'username')='string' THEN display_name:=nullif(btrim(NEW.raw_user_meta_data->>'username'),''); END IF;
  INSERT INTO public.users(id,email,email_verified,username,reg_number,full_name,is_admin)
    VALUES(NEW.id,NEW.email,true,display_name,NULL,NULL,false) ON CONFLICT (id) DO NOTHING;
  IF NOT FOUND THEN RETURN NEW; END IF;
  -- v3 never uses the roster. Even an explicit legacy hint cannot assign official identity,
  -- take an existing login, set a level or grant a role. An alias collision is not a failed confirmation.
  IF NOT (NEW.raw_user_meta_data ? 'reported_reg_number') AND jsonb_typeof(NEW.raw_user_meta_data->'reg_number')='string' THEN
    old_hint:=NEW.raw_user_meta_data->>'reg_number';
    INSERT INTO lh_signup_private.legacy_login(roster_id,number_tag,account_id)
      SELECT r.id,sha256(convert_to(r.reg_number,'UTF8')),NEW.id FROM public.allowed_students r
      WHERE r.reg_number=old_hint AND r.used IS FALSE AND NOT EXISTS (SELECT FROM public.users u WHERE u.reg_number=r.reg_number)
      ON CONFLICT DO NOTHING;
  END IF;
  INSERT INTO public.signup_log(reg_number,username,full_name) VALUES(NULL,display_name,NULL);
  RETURN NEW;
END;
$confirmation$;
DO $private$
BEGIN
  IF EXISTS (SELECT FROM (VALUES ('anon'::name),('authenticated'::name)) r(role_name)
    WHERE has_schema_privilege(r.role_name,'lh_signup_private','USAGE,CREATE') OR has_any_column_privilege(r.role_name,'lh_signup_private.legacy_login','SELECT,INSERT,UPDATE,REFERENCES')
    OR has_table_privilege(r.role_name,'lh_signup_private.legacy_login','DELETE,TRUNCATE,TRIGGER,MAINTAIN')) THEN
    RAISE EXCEPTION 'Login compatibility storage is not private';
  END IF;
END;
$private$;
NOTIFY pgrst,'reload schema';
COMMIT;
