-- New 008: single owner authority. No default identity; read docs/admin-access.md before a separately approved installation.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '25s';
DO $preflight$ BEGIN
  -- Validate the identity columns without selecting any account rows.
  PERFORM a.id,a.email,a.email_confirmed_at,a.deleted_at,a.banned_until FROM auth.users a WHERE false;
  IF to_regprocedure('public.get_academic_calendar()') IS NULL OR NOT
     (SELECT relrowsecurity FROM pg_class WHERE oid='public.users'::regclass) OR EXISTS (
    SELECT 1 FROM (VALUES ('anon'::name),('authenticated'::name)) x(r)
    WHERE has_schema_privilege(r,'public','CREATE') OR has_any_column_privilege(r,'public.users','INSERT')
       OR has_column_privilege(r,'public.users','is_admin','UPDATE') OR has_column_privilege(r,'public.users','id','UPDATE')
       OR has_table_privilege(r,'public.users','DELETE,TRIGGER,TRUNCATE,REFERENCES,MAINTAIN')) THEN
    RAISE EXCEPTION 'Unexpected calendar or profile permissions. Stop and review; do not broaden grants.';
  END IF;
END $preflight$;
CREATE SCHEMA legalhub_console;
REVOKE ALL ON SCHEMA legalhub_console FROM PUBLIC, anon, authenticated;
CREATE TABLE legalhub_console.role_managers (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  designated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE legalhub_console.owner_identity (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  user_id uuid NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE RESTRICT,
  FOREIGN KEY(user_id) REFERENCES auth.users(id) ON DELETE RESTRICT
);
ALTER TABLE legalhub_console.owner_identity ENABLE ROW LEVEL SECURITY;
-- These three operator-supplied session settings are read ONLY here, not at request time.
-- A blank/mismatched binding aborts the entire migration. It never promotes an account.
DO $bind$ DECLARE who uuid:=nullif(current_setting('legalhub.install_owner_uuid',true),'')::uuid;
 reg text:=nullif(btrim(current_setting('legalhub.install_owner_reg',true)),'');
 mail text:=nullif(lower(btrim(current_setting('legalhub.install_owner_email',true))),''); BEGIN
 IF who IS NULL OR reg IS NULL OR mail IS NULL THEN RAISE EXCEPTION 'Verified owner binding required; nothing installed.'; END IF;
 PERFORM FROM public.users u JOIN auth.users a ON a.id=u.id WHERE u.id=who AND u.reg_number=reg
   AND u.is_admin IS TRUE AND lower(btrim(a.email))=mail AND a.email_confirmed_at IS NOT NULL AND a.deleted_at IS NULL
   AND (a.banned_until IS NULL OR a.banned_until<=now()) FOR UPDATE OF u FOR SHARE OF a;
 IF NOT FOUND OR (SELECT count(*) FROM public.users WHERE reg_number=reg)<>1 THEN
   RAISE EXCEPTION 'Owner identity, official registration and confirmed administrator must match uniquely.'; END IF;
 INSERT INTO legalhub_console.owner_identity(user_id) VALUES (who);
END $bind$;
CREATE TABLE legalhub_console.changes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), at timestamptz NOT NULL DEFAULT clock_timestamp(),
 actor_id uuid NOT NULL, subject_id uuid NOT NULL, action text NOT NULL
);
-- A transaction-local authorization ticket in private storage, never a browser flag or JWT claim.
CREATE TABLE legalhub_console.role_intent (
  change_tx xid8 PRIMARY KEY, actor_id uuid NOT NULL, subject_id uuid NOT NULL, new_flag boolean NOT NULL
);
ALTER TABLE legalhub_console.role_intent ENABLE ROW LEVEL SECURITY;
ALTER TABLE legalhub_console.role_managers ENABLE ROW LEVEL SECURITY;
ALTER TABLE legalhub_console.changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA legalhub_console FROM PUBLIC, anon, authenticated;
CREATE FUNCTION legalhub_console.check_role_transition() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE login_role name := coalesce(nullif(current_setting('role',true),'none'),session_user::text)::name;
BEGIN
  IF auth.uid() IS NULL AND pg_has_role(session_user,current_user,'USAGE') AND pg_has_role(login_role,current_user,'USAGE') THEN
    IF NEW.is_admin IS NOT TRUE THEN DELETE FROM legalhub_console.role_managers WHERE user_id=NEW.id; END IF;
    RETURN NULL; -- trusted SQL Editor; preserves direct recovery by official registration number
  END IF;
  IF NEW.is_admin IS NOT TRUE AND EXISTS(SELECT FROM legalhub_console.owner_identity WHERE user_id=NEW.id) THEN
    RAISE EXCEPTION 'The owner cannot be demoted through an application.' USING ERRCODE='42501'; END IF;
  DELETE FROM legalhub_console.role_intent WHERE change_tx=pg_current_xact_id() AND actor_id=auth.uid()
    AND subject_id=NEW.id AND new_flag=coalesce(NEW.is_admin,false);
  IF NOT FOUND THEN RAISE EXCEPTION 'Use the reviewed role-manager operation.' USING ERRCODE='42501'; END IF;
  IF NEW.is_admin IS NOT TRUE THEN DELETE FROM legalhub_console.role_managers WHERE user_id=NEW.id; END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER lh_guard_admin_insert AFTER INSERT ON public.users FOR EACH ROW
  WHEN (NEW.is_admin IS TRUE) EXECUTE FUNCTION legalhub_console.check_role_transition();
CREATE TRIGGER lh_guard_admin_update AFTER UPDATE ON public.users FOR EACH ROW
  WHEN (coalesce(OLD.is_admin,false) IS DISTINCT FROM coalesce(NEW.is_admin,false)) EXECUTE FUNCTION legalhub_console.check_role_transition();

CREATE FUNCTION public.lh_admin_capabilities() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object('admin',EXISTS (SELECT FROM public.users WHERE id=auth.uid() AND is_admin IS TRUE),
    'roles',EXISTS (SELECT FROM public.users u WHERE u.id=auth.uid() AND u.is_admin IS TRUE AND
      (EXISTS(SELECT FROM legalhub_console.owner_identity WHERE user_id=u.id) OR EXISTS(SELECT FROM legalhub_console.role_managers WHERE user_id=u.id))));
$$;
CREATE FUNCTION legalhub_console.require_actor(p_actor uuid,p_manager boolean) RETURNS void LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp AS $$ BEGIN
  IF auth.uid() IS NULL OR p_actor IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Account changed.' USING ERRCODE='42501'; END IF;
  PERFORM FROM public.users WHERE id=auth.uid() AND is_admin IS TRUE FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Administrator access required.' USING ERRCODE='42501'; END IF;
  IF p_manager AND NOT EXISTS(SELECT FROM legalhub_console.owner_identity WHERE user_id=auth.uid()) THEN
    PERFORM FROM legalhub_console.role_managers WHERE user_id=auth.uid() FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Role manager access required.' USING ERRCODE='42501'; END IF;
  END IF;
END $$;
-- Exact current Auth email, not a profile email, metadata field, wildcard or client-provided account identity.
CREATE FUNCTION legalhub_console.review_target(p_email text) RETURNS jsonb LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp AS $$ DECLARE who uuid; mail text; flag boolean; version text; delegated boolean; BEGIN
  IF p_email IS NULL OR length(btrim(p_email)) NOT BETWEEN 3 AND 254 OR btrim(p_email) !~ '^[^[:space:]@]+@[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'Enter one complete email address.' USING ERRCODE='22023'; END IF;
  BEGIN
    SELECT u.id, lower(btrim(a.email)), coalesce(u.is_admin,false), u.xmin::text INTO STRICT who,mail,flag,version
      FROM auth.users a JOIN public.users u ON u.id=a.id
      WHERE lower(btrim(a.email))=lower(btrim(p_email)) AND a.email_confirmed_at IS NOT NULL
        AND a.deleted_at IS NULL AND (a.banned_until IS NULL OR a.banned_until<=now()) FOR SHARE OF a,u;
  EXCEPTION WHEN NO_DATA_FOUND OR TOO_MANY_ROWS THEN
    RAISE EXCEPTION 'No unique active, confirmed member matches that email.' USING ERRCODE='22023';
  END;
  IF who=auth.uid() OR EXISTS(SELECT FROM legalhub_console.owner_identity WHERE user_id=who) THEN
    RAISE EXCEPTION 'Your own account and the owner cannot be changed here.' USING ERRCODE='22023'; END IF;
  SELECT m.xmin::text INTO version FROM legalhub_console.role_managers m WHERE m.user_id=who FOR SHARE;
  delegated:=FOUND; SELECT u.xmin::text||'.'||coalesce(version,'0') INTO version FROM public.users u WHERE u.id=who;
  RETURN jsonb_build_object('id',who,'email',mail,'is_admin',flag,'delegates',delegated,'version',version);
END $$;
CREATE FUNCTION public.lh_review_admin(p_actor uuid,p_email text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$ BEGIN
  PERFORM legalhub_console.require_actor(p_actor,true); RETURN legalhub_console.review_target(p_email);
END $$;
CREATE FUNCTION public.lh_change_admin(p_actor uuid,p_target uuid,p_email text,p_grant boolean,p_version text,p_confirmation text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$ DECLARE snap jsonb; action text; saved boolean; BEGIN
  PERFORM pg_advisory_xact_lock(1751326951,1);
  PERFORM legalhub_console.require_actor(p_actor,true);
  snap := legalhub_console.review_target(p_email);
  IF p_grant IS NULL OR p_target IS DISTINCT FROM (snap->>'id')::uuid OR p_version IS DISTINCT FROM snap->>'version'
     OR p_grant=(snap->>'is_admin')::boolean THEN RAISE EXCEPTION 'Account or role changed. Review again.' USING ERRCODE='40001'; END IF;
  action := CASE WHEN p_grant THEN 'grant' ELSE 'revoke' END;
  IF p_confirmation IS DISTINCT FROM action || ' ' || (snap->>'email') THEN RAISE EXCEPTION 'Confirmation does not match.' USING ERRCODE='22023'; END IF;
  IF NOT p_grant AND NOT EXISTS(SELECT FROM public.users WHERE is_admin IS TRUE AND id<>p_target) THEN
    RAISE EXCEPTION 'Cannot remove the last administrator.' USING ERRCODE='22023'; END IF;
  INSERT INTO legalhub_console.role_intent(change_tx,actor_id,subject_id,new_flag) VALUES(pg_current_xact_id(),auth.uid(),p_target,p_grant);
  UPDATE public.users SET is_admin=p_grant WHERE id=p_target RETURNING is_admin INTO saved;
  IF NOT FOUND OR saved IS DISTINCT FROM p_grant OR EXISTS(SELECT FROM legalhub_console.role_intent WHERE change_tx=pg_current_xact_id()) THEN
    RAISE EXCEPTION 'Account change was not confirmed. Stop and review.' USING ERRCODE='40001'; END IF;
  INSERT INTO legalhub_console.changes(actor_id,subject_id,action) VALUES(auth.uid(),p_target,'admin.'||action);
  RETURN true;
END $$;

-- Avoid changing the protected operator lookup from the web. The owner pin is a separate stable UUID.
CREATE FUNCTION legalhub_console.guard_owner_registration() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp AS $$ DECLARE r name:=coalesce(nullif(current_setting('role',true),'none'),session_user::text)::name; BEGIN
 IF EXISTS(SELECT FROM legalhub_console.owner_identity WHERE user_id=OLD.id) AND NOT
   (auth.uid() IS NULL AND pg_has_role(session_user,current_user,'USAGE') AND pg_has_role(r,current_user,'USAGE')) THEN
   RAISE EXCEPTION 'The owner registration is operator-managed.' USING ERRCODE='42501'; END IF; RETURN NULL;
END $$;
CREATE TRIGGER lh_owner_registration AFTER UPDATE ON public.users FOR EACH ROW WHEN (OLD.reg_number IS DISTINCT FROM NEW.reg_number) EXECUTE FUNCTION legalhub_console.guard_owner_registration();
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA legalhub_console FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.lh_admin_capabilities(), public.lh_review_admin(uuid,text), public.lh_change_admin(uuid,uuid,text,boolean,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lh_admin_capabilities(), public.lh_review_admin(uuid,text), public.lh_change_admin(uuid,uuid,text,boolean,text,text) TO authenticated;
DO $verify$ BEGIN IF EXISTS(SELECT FROM (VALUES ('anon'::name),('authenticated'::name)) x(r) WHERE has_schema_privilege(r,'legalhub_console','USAGE,CREATE')) OR
 EXISTS(SELECT FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN ('lh_admin_capabilities','lh_review_admin','lh_change_admin') AND has_function_privilege('anon',p.oid,'EXECUTE')) THEN RAISE EXCEPTION 'Unexpected inherited console access.'; END IF; END $verify$;
COMMIT;
