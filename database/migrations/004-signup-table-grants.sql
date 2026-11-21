-- REVIEW / STAGING ONLY until separately approved. For PostgreSQL 17.
-- Restrict four effective administrative table privileges found on both web roles.
-- This changes permissions only. It does not perform any of the named operations,
-- modify rows, change RLS, or change the normal profile column grants.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '20s';

REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN
  ON TABLE public.users, public.allowed_students, public.signup_log
  FROM anon, authenticated;

DO $check$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (VALUES ('anon'::name), ('authenticated'::name)) AS r(role_name)
    CROSS JOIN (VALUES ('public.users'::regclass), ('public.allowed_students'::regclass),
                       ('public.signup_log'::regclass)) AS t(id)
    WHERE pg_catalog.has_table_privilege(r.role_name, t.id, 'TRUNCATE, TRIGGER, REFERENCES, MAINTAIN')
  ) THEN
    RAISE EXCEPTION 'A web role still inherits a maintenance privilege. Stop and review grants; do not broaden the revocation automatically.';
  END IF;
END;
$check$;
COMMIT;
