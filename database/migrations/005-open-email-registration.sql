-- LegalHub v3 / revised candidate, not applied to production.
-- Replaces the earlier review draft; do not run both. Run AFTER the separately approved table-grants change.
-- Rehearse with email confirmation ON and an email-login-capable frontend first.
-- This migration has no backfill. Existing profile, roster and audit rows are not updated.
-- The body fingerprint checks for accidental schema drift, not for security/authentication.

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '20s';

DO $preflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger AS t
    JOIN pg_catalog.pg_proc AS p ON p.oid = t.tgfoid
    WHERE t.tgrelid = 'auth.users'::pg_catalog.regclass
      AND p.oid = 'public.handle_new_confirmed_user()'::pg_catalog.regprocedure
      AND t.tgname = 'on_auth_user_confirmed' AND NOT t.tgisinternal
      AND t.tgenabled IN ('O','A') AND t.tgtype = 17 -- AFTER UPDATE, FOR EACH ROW
      AND t.tgqual IS NULL AND t.tgattr::text = '' AND p.prosecdef
      AND pg_catalog.md5(pg_catalog.replace(p.prosrc, pg_catalog.chr(13), '')) = '49913e2910d3ec06670725d830b2538b'
  ) THEN
    RAISE EXCEPTION 'Confirmation function/trigger differs from the reviewed baseline. Stop and review; do not force the migration.';
  END IF;
  -- Do not widen membership while owner-privileged test maintenance is public.
  -- Check metadata only: never invoke a maintenance function to verify this.
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'reset_test_signup' AND p.prosecdef
      AND (pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
           OR pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  ) THEN
    RAISE EXCEPTION 'Privileged test-maintenance routines are still executable by a browser role. Resolve separately before open signup.';
  END IF;
  -- Fail closed on the audited web-role privileges. Never invoke a maintenance command here.
  IF EXISTS (
    SELECT 1 FROM (VALUES ('anon'::name), ('authenticated'::name)) AS r(role_name)
    CROSS JOIN (VALUES ('public.users'::regclass), ('public.allowed_students'::regclass),
                       ('public.signup_log'::regclass)) AS t(id)
    WHERE pg_catalog.has_table_privilege(r.role_name, t.id, 'TRUNCATE, TRIGGER, REFERENCES, MAINTAIN')
  ) THEN
    RAISE EXCEPTION 'Web roles still have administrative table privileges. Review the separate scope-limited permissions change first.';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid='public.users'::regclass)
    OR EXISTS (
      SELECT 1 FROM (VALUES ('anon'::name), ('authenticated'::name)) AS r(role_name)
      WHERE pg_catalog.has_any_column_privilege(r.role_name, 'public.users', 'INSERT')
         OR pg_catalog.has_table_privilege(r.role_name, 'public.users', 'DELETE')
         OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                    WHERE a.attrelid='public.users'::regclass AND a.attnum>0 AND NOT a.attisdropped
                      AND a.attname NOT IN ('username','current_level','level_updated_at','avatar_path')
                      AND pg_catalog.has_column_privilege(r.role_name, a.attrelid, a.attnum, 'UPDATE'))
    ) THEN
    RAISE EXCEPTION 'Profile RLS or web-role writes differ from the reviewed baseline. Stop and inspect.';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'signup_log'
        AND column_name IN ('reg_number', 'full_name', 'username') AND is_nullable = 'YES' AND data_type = 'text') <> 3 THEN
    RAISE EXCEPTION 'Unexpected signup_log definition. No changes applied.';
  END IF;
END;
$preflight$;

-- Ordinary UNIQUE(reg_number) remains in force for official, non-NULL numbers.
-- Email remains UNIQUE and NOT NULL. Auth UUID remains the profile primary key.
ALTER TABLE public.users
  ALTER COLUMN reg_number DROP NOT NULL,
  ALTER COLUMN full_name DROP NOT NULL;

-- Replace the existing function in place; preserve trigger binding, ownership and ACLs.
CREATE OR REPLACE FUNCTION public.handle_new_confirmed_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $confirmation$
DECLARE
  display_username text;
BEGIN
  IF TG_RELID <> 'auth.users'::pg_catalog.regclass OR TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'Unexpected confirmation trigger binding';
  END IF;
  IF OLD.email_confirmed_at IS NOT NULL OR NEW.email_confirmed_at IS NULL THEN
    RETURN NEW;
  END IF;

  IF pg_catalog.jsonb_typeof(NEW.raw_user_meta_data -> 'username') = 'string' THEN
    display_username := NULLIF(pg_catalog.btrim(NEW.raw_user_meta_data ->> 'username'), '');
  END IF;

  -- Verified address and identity come from Auth, never from client-supplied metadata.
  -- Optional numbers stay self-reported in Auth metadata; they do not occupy official
  -- unique slots, disclose roster names, change roles, or consume an allowed_students row.
  INSERT INTO public.users (id, email, email_verified, username, reg_number, full_name, is_admin)
  VALUES (NEW.id, NEW.email, true, display_username, NULL, NULL, false)
  ON CONFLICT (id) DO NOTHING;

  IF FOUND THEN
    -- Preserve confirmation logging. Do not add emails or unverified numbers to the log.
    INSERT INTO public.signup_log (reg_number, username, full_name)
    VALUES (NULL, display_username, NULL);
  END IF;
  RETURN NEW;
END;
$confirmation$;

COMMIT;
