-- 010 · Admins you added. Run once after 008 + 009; no identity input or role changes.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '25s';
DO $preflight$
BEGIN
  IF auth.uid() IS NOT NULL OR to_regprocedure('public.lh_curricula(uuid)') IS NULL OR
     (SELECT md5(replace(prosrc,E'\r\n',E'\n')) FROM pg_proc WHERE oid=to_regprocedure('public.lh_admin_capabilities()'))
       IS DISTINCT FROM 'cb0d6600f3b62187e4127f566dcddde0' OR
     (SELECT md5(replace(prosrc,E'\r\n',E'\n')) FROM pg_proc WHERE oid=to_regprocedure('public.lh_change_admin(uuid,uuid,text,boolean,text,text)'))
       IS DISTINCT FROM '10722daade86111fcd263c2e7f638b25' THEN
    RAISE EXCEPTION 'Expected the reviewed admin functions and a trusted SQL session without impersonation. Do not replay setup.';
  END IF;
  IF EXISTS (SELECT FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='lh_owner_admin_emails') OR
     to_regclass('legalhub_console.owner_appointments') IS NOT NULL THEN
    RAISE EXCEPTION 'The owner-list update is already present in whole or in part. No reinstall.';
  END IF;
  IF NOT pg_try_advisory_xact_lock(1751326951,1) THEN RAISE EXCEPTION 'An access change is in progress. Try later.'; END IF;
  IF (SELECT count(*) FROM legalhub_console.owner_identity)<>1 OR
     EXISTS (SELECT FROM (VALUES ('anon'::name),('authenticated'::name)) x(r) WHERE
       has_schema_privilege(r,'legalhub_console','USAGE,CREATE') OR has_schema_privilege(r,'public','CREATE')) OR
     (SELECT count(*) FROM pg_trigger WHERE tgrelid='public.users'::regclass
       AND tgname IN ('lh_guard_admin_insert','lh_guard_admin_update') AND tgenabled IN ('O','A'))<>2 THEN
    RAISE EXCEPTION 'Owner binding or admin access controls differ from the reviewed baseline. Nothing installed.';
  END IF;
END $preflight$;
-- No role change may fall between the one-time audit import and installation of the two hooks.
LOCK TABLE public.users, legalhub_console.changes IN SHARE ROW EXCLUSIVE MODE;

-- Only current owner-attributed grant references; never a second source of authority or a copy of emails.
CREATE TABLE legalhub_console.owner_appointments (
  subject_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  grant_id uuid NOT NULL REFERENCES legalhub_console.changes(id) ON DELETE CASCADE,
  FOREIGN KEY (subject_id) REFERENCES auth.users(id) ON DELETE CASCADE
);
ALTER TABLE legalhub_console.owner_appointments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE legalhub_console.owner_appointments FROM PUBLIC, anon, authenticated;

-- Consider all actors' role events BEFORE filtering for the owner. Don't guess in a timestamp tie.
WITH ranked AS (
  SELECT c.*, rank() OVER (PARTITION BY c.subject_id ORDER BY c.at DESC) AS pos,
         count(*) OVER (PARTITION BY c.subject_id,c.at) AS peers
    FROM legalhub_console.changes c WHERE c.action IN ('admin.grant','admin.revoke')
)
INSERT INTO legalhub_console.owner_appointments(subject_id,grant_id)
SELECT c.subject_id,c.id FROM ranked c
JOIN legalhub_console.owner_identity o ON o.user_id=c.actor_id
JOIN public.users u ON u.id=c.subject_id AND u.is_admin IS TRUE
JOIN auth.users a ON a.id=u.id
WHERE c.pos=1 AND c.peers=1 AND c.action='admin.grant' AND c.subject_id<>o.user_id;

-- Every real role transition, including SQL recovery, first ends the previous appointment.
-- A subsequent matching reviewed grant can re-establish it. Neither hook grants or blocks a role.
CREATE FUNCTION legalhub_console.expire_owner_appointment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  DELETE FROM legalhub_console.owner_appointments WHERE subject_id=NEW.id;
  RETURN NULL;
END $$;
CREATE TRIGGER lh_expire_owner_appointment AFTER UPDATE ON public.users FOR EACH ROW
  WHEN (coalesce(OLD.is_admin,false) IS DISTINCT FROM coalesce(NEW.is_admin,false))
  EXECUTE FUNCTION legalhub_console.expire_owner_appointment();
CREATE FUNCTION legalhub_console.remember_owner_appointment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  INSERT INTO legalhub_console.owner_appointments(subject_id,grant_id)
  SELECT NEW.subject_id,NEW.id FROM legalhub_console.owner_identity o
  JOIN public.users u ON u.id=NEW.subject_id AND u.is_admin IS TRUE
  WHERE o.user_id=NEW.actor_id AND NEW.actor_id=auth.uid() AND NEW.subject_id<>o.user_id
  ON CONFLICT (subject_id) DO UPDATE SET grant_id=EXCLUDED.grant_id;
  RETURN NULL;
END $$;
CREATE TRIGGER lh_remember_owner_appointment AFTER INSERT ON legalhub_console.changes FOR EACH ROW
  WHEN (NEW.action='admin.grant') EXECUTE FUNCTION legalhub_console.remember_owner_appointment();
REVOKE ALL ON FUNCTION legalhub_console.expire_owner_appointment(), legalhub_console.remember_owner_appointment()
  FROM PUBLIC, anon, authenticated;

-- Backward-compatible UI hints about the caller only. 'roles' still includes designated managers.
CREATE OR REPLACE FUNCTION public.lh_admin_capabilities() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  WITH me AS (SELECT u.id FROM public.users u WHERE u.id=auth.uid() AND u.is_admin IS TRUE),
  flags AS (
    SELECT EXISTS(SELECT FROM me) AS admin,
      EXISTS(SELECT FROM me JOIN legalhub_console.owner_identity o ON o.user_id=me.id) AS owner,
      EXISTS(SELECT FROM me JOIN legalhub_console.role_managers m ON m.user_id=me.id) AS manager
  )
  SELECT jsonb_build_object('admin',admin,'roles',owner OR manager,'owner',owner) FROM flags;
$$;

CREATE FUNCTION public.lh_owner_admin_emails(p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE me uuid := auth.uid(); result jsonb;
BEGIN
  -- Do not trust the capability flag, a supplied UUID, role-management rights, or public profile email.
  IF me IS NULL OR me IS DISTINCT FROM p_actor OR NOT EXISTS (
    SELECT FROM legalhub_console.owner_identity o JOIN public.users u ON u.id=o.user_id
      JOIN auth.users a ON a.id=o.user_id
    WHERE o.user_id=me AND u.is_admin IS TRUE AND a.email_confirmed_at IS NOT NULL
      AND a.deleted_at IS NULL AND (a.banned_until IS NULL OR a.banned_until<=now())
  ) THEN RAISE EXCEPTION 'Owner access required.' USING ERRCODE='42501'; END IF;
  SELECT coalesce(jsonb_agg(e.email ORDER BY e.email),'[]'::jsonb) INTO result FROM (
    SELECT DISTINCT lower(btrim(a.email)) AS email FROM legalhub_console.owner_appointments p
    JOIN legalhub_console.changes c ON c.id=p.grant_id AND c.subject_id=p.subject_id
    JOIN public.users u ON u.id=p.subject_id AND u.is_admin IS TRUE
    JOIN auth.users a ON a.id=u.id
    WHERE c.actor_id=me AND c.action='admin.grant' AND u.id<>me AND nullif(btrim(a.email),'') IS NOT NULL
      AND a.email_confirmed_at IS NOT NULL AND a.deleted_at IS NULL AND (a.banned_until IS NULL OR a.banned_until<=now())
  ) e;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.lh_admin_capabilities(), public.lh_owner_admin_emails(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lh_admin_capabilities(), public.lh_owner_admin_emails(uuid) TO authenticated;
DO $verify$
BEGIN
  IF has_function_privilege('anon','public.lh_owner_admin_emails(uuid)','EXECUTE') OR
     NOT has_function_privilege('authenticated','public.lh_owner_admin_emails(uuid)','EXECUTE') OR
     EXISTS (SELECT FROM (VALUES ('anon'::name),('authenticated'::name)) x(r) WHERE
       has_any_column_privilege(r,'legalhub_console.owner_appointments','SELECT,INSERT,UPDATE,REFERENCES') OR
       has_table_privilege(r,'legalhub_console.owner_appointments','DELETE,TRIGGER,TRUNCATE') OR
       has_function_privilege(r,'legalhub_console.expire_owner_appointment()','EXECUTE') OR
       has_function_privilege(r,'legalhub_console.remember_owner_appointment()','EXECUTE')) THEN
    RAISE EXCEPTION 'Unexpected owner-list privileges. Changes rolled back.';
  END IF;
END $verify$;
NOTIFY pgrst, 'reload schema';
COMMIT;
SELECT 'OWNER LIST READY' AS status;
