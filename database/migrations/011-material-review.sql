-- Material review; no existing file/row is edited, removed or backfilled at installation.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
DO $pre$ BEGIN
  IF auth.uid() IS NOT NULL OR to_regprocedure('legalhub_console.require_actor(uuid,boolean)') IS NULL OR
     to_regprocedure('public.lh_owner_admin_emails(uuid)') IS NULL OR to_regrole('service_role') IS NULL OR
     NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.materials'::regclass) OR
     NOT EXISTS(SELECT FROM pg_trigger WHERE tgrelid='public.materials'::regclass AND tgname='lh_resolve_material_course' AND tgenabled IN ('O','A')) OR
     EXISTS(SELECT FROM pg_constraint WHERE confrelid='public.materials'::regclass AND contype='f' AND confdeltype NOT IN ('r','a')) OR
     EXISTS(SELECT FROM (VALUES ('anon'::name),('authenticated'::name)) x(r) WHERE has_schema_privilege(r,'legalhub_console','USAGE,CREATE') OR has_schema_privilege(r,'public','CREATE')) OR
     EXISTS(SELECT FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('lh_material_review','lh_material_change','lh_material_remove','lh_material_file_done')) THEN
    RAISE EXCEPTION 'Material baseline differs or already installed. Stop; do not replay migrations.';
  END IF;
  PERFORM id,storage_path,uploaded_by,status,material_name,file_name,course,level,semester FROM public.materials WHERE false;
END $pre$;
LOCK TABLE public.materials IN SHARE ROW EXCLUSIVE MODE;
CREATE TABLE legalhub_console.material_removals (
  material_id uuid PRIMARY KEY, storage_path text NOT NULL UNIQUE, actor_id uuid NOT NULL,
  action text NOT NULL CHECK(action IN ('reject','delete')), version text NOT NULL, phrase_hash bytea NOT NULL,
  removed_at timestamptz NOT NULL DEFAULT now(), file_done_at timestamptz
);
ALTER TABLE legalhub_console.material_removals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON legalhub_console.material_removals FROM PUBLIC,anon,authenticated,service_role;
-- Retire the id/key after unlinking; a failed or repeated object cleanup must never target a new material.
CREATE FUNCTION legalhub_console.check_material_key() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog,pg_temp AS $$ BEGIN
  IF EXISTS(SELECT FROM legalhub_console.material_removals r WHERE r.material_id=NEW.id OR r.storage_path=NEW.storage_path) THEN
    RAISE EXCEPTION 'This file reference is retired.' USING ERRCODE='23503'; END IF;
  IF TG_OP='INSERT' AND auth.uid() IS NOT NULL AND
     (NEW.uploaded_by IS DISTINCT FROM auth.uid() OR NEW.storage_path IS NULL OR NOT
      (NEW.storage_path ~ ('^materials/'||auth.uid()::text||'/[A-Za-z0-9_-]+_[A-Za-z0-9._-]+$')) OR length(NEW.storage_path)>1024) THEN
    RAISE EXCEPTION 'Use the file key issued for this upload.' USING ERRCODE='22023'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER lh_retired_material_key BEFORE INSERT OR UPDATE OF id,uploaded_by,storage_path ON public.materials
FOR EACH ROW EXECUTE FUNCTION legalhub_console.check_material_key();
CREATE FUNCTION legalhub_console.material_title(m public.materials) RETURNS text LANGUAGE sql STABLE
SET search_path = pg_catalog,pg_temp AS $$ SELECT coalesce(nullif(btrim(regexp_replace(coalesce(nullif(btrim(m.material_name),''),m.file_name),'[[:space:]]+',' ','g')),''),'Untitled material '||m.id::text); $$;
CREATE FUNCTION public.lh_material_review(p_actor uuid,p_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog,pg_temp AS $$ DECLARE result jsonb; BEGIN
  PERFORM legalhub_console.require_actor(p_actor,false);
  SELECT jsonb_build_object('id',m.id,'title',legalhub_console.material_title(m),'file_name',m.file_name,'material_name',m.material_name,
    'level',m.level,'semester',m.semester,'course',m.course,'status',m.status,'version',m.xmin::text) INTO STRICT result
  FROM public.materials m WHERE m.id=p_id AND m.status IN ('pending','approved'); RETURN result;
EXCEPTION WHEN NO_DATA_FOUND THEN RAISE EXCEPTION 'Item changed or is unavailable.' USING ERRCODE='40001'; END $$;
CREATE FUNCTION public.lh_material_change(p_actor uuid,p_id uuid,p_version text,p_action text,p_phrase text,p_values jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,pg_temp AS $$
DECLARE r public.materials%ROWTYPE; v text; label text; lev text; sem text; k text; BEGIN
  PERFORM legalhub_console.require_actor(p_actor,false);
  PERFORM pg_advisory_xact_lock_shared(1751326952,9);
  LOCK TABLE public.materials IN ROW EXCLUSIVE MODE; -- acquire the write lock before the row lock, as in removal
  SELECT m.* INTO r FROM public.materials m WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR r.status IS DISTINCT FROM 'pending' THEN RAISE EXCEPTION 'The material changed.' USING ERRCODE='40001'; END IF;
  SELECT m.xmin::text INTO v FROM public.materials m WHERE id=p_id;
  IF v IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'Review the current version.' USING ERRCODE='40001'; END IF;
  IF p_action IS NULL OR p_action NOT IN ('edit','approve') OR p_phrase IS DISTINCT FROM 'i '||p_action||' '||legalhub_console.material_title(r) THEN
    RAISE EXCEPTION 'Exact item confirmation required.' USING ERRCODE='22023'; END IF;
  IF p_action='approve' THEN
    IF p_values IS NOT NULL THEN RAISE EXCEPTION 'Unexpected edit fields.' USING ERRCODE='22023'; END IF;
    UPDATE public.materials SET status='approved' WHERE id=p_id;
  ELSE
    IF jsonb_typeof(p_values) IS DISTINCT FROM 'object' OR NOT (p_values ?& ARRAY['material_name','level','semester','course']) OR
       (p_values - ARRAY['material_name','level','semester','course']) <> '{}'::jsonb OR
       EXISTS(SELECT FROM jsonb_each(p_values) x WHERE jsonb_typeof(x.value)<>'string') THEN RAISE EXCEPTION 'Unexpected edit fields.' USING ERRCODE='22023'; END IF;
    label:=btrim(p_values->>'material_name');lev:=p_values->>'level';sem:=p_values->>'semester';k:=p_values->>'course';
    IF length(label) NOT BETWEEN 1 AND 240 OR label ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'Check material title.' USING ERRCODE='22023'; END IF;
    IF ROW(lev,sem,k) IS DISTINCT FROM ROW(r.level,r.semester,r.course) THEN
      IF NOT ((lev='relevant' AND sem='all' AND k='relevant materials') OR
         (lev IN ('100L','200L','300L','400L','500L') AND sem IN ('first','second','all') AND EXISTS(
          SELECT FROM legalhub_console.course_listings s JOIN public.courses c ON c.id=s.course_id WHERE NOT s.archived AND s.material_key=k AND c.level=lev AND (sem='all' OR c.semester=sem)))) THEN
        RAISE EXCEPTION 'Choose a current course in the selected scope.' USING ERRCODE='22023'; END IF;
    END IF;
    UPDATE public.materials SET material_name=label,level=lev,semester=sem,course=k WHERE id=p_id;
  END IF;
  INSERT INTO legalhub_console.changes(actor_id,subject_id,action) VALUES(p_actor,p_id,'material.'||p_action);
  RETURN true;
END $$;
-- Server only: p_actor comes from auth.getUser() in the Edge Function, never from an unchecked request.
CREATE FUNCTION public.lh_material_remove(p_actor uuid,p_id uuid,p_version text,p_action text,p_phrase text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,pg_temp AS $$
DECLARE r public.materials%ROWTYPE; ticket legalhub_console.material_removals%ROWTYPE; v text; h bytea:=sha256(convert_to(p_phrase,'UTF8')); BEGIN
  PERFORM FROM public.users WHERE id=p_actor AND is_admin IS TRUE FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Administrator access required.' USING ERRCODE='42501'; END IF;
  IF p_action IS NULL OR p_action NOT IN ('reject','delete') OR p_id IS NULL OR h IS NULL THEN RAISE EXCEPTION 'Invalid review.' USING ERRCODE='22023'; END IF;
  -- Short database-only critical section. No network call while this lock is held. No concurrent new reference can be missed.
  LOCK TABLE public.materials IN SHARE ROW EXCLUSIVE MODE;
  SELECT * INTO ticket FROM legalhub_console.material_removals WHERE material_id=p_id;
  IF FOUND THEN
    IF ROW(ticket.actor_id,ticket.version,ticket.action,ticket.phrase_hash) IS DISTINCT FROM ROW(p_actor,p_version,p_action,h) THEN
      RAISE EXCEPTION 'Already removed.' USING ERRCODE='40001'; END IF;
    RETURN jsonb_build_object('key',ticket.storage_path,'done',ticket.file_done_at IS NOT NULL);
  END IF;
  SELECT m.* INTO r FROM public.materials m WHERE m.id=p_id FOR UPDATE;
  IF NOT FOUND OR r.status IS DISTINCT FROM (CASE p_action WHEN 'reject' THEN 'pending' ELSE 'approved' END) THEN
    RAISE EXCEPTION 'Review the current item.' USING ERRCODE='40001'; END IF;
  SELECT m.xmin::text INTO v FROM public.materials m WHERE m.id=p_id;
  IF p_version IS DISTINCT FROM v THEN RAISE EXCEPTION 'Review the current version.' USING ERRCODE='40001'; END IF;
  IF p_phrase IS DISTINCT FROM 'i '||p_action||' '||legalhub_console.material_title(r) THEN RAISE EXCEPTION 'Exact item confirmation required.' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT FROM pg_constraint WHERE confrelid='public.materials'::regclass AND contype='f' AND confdeltype NOT IN ('r','a')) OR
     EXISTS(SELECT FROM pg_trigger WHERE tgrelid='public.materials'::regclass AND NOT tgisinternal AND (tgtype::int & 8)=8 AND tgenabled IN ('O','A')) THEN
    RAISE EXCEPTION 'Material removal dependencies changed. Operator review required.' USING ERRCODE='23503'; END IF;
  IF r.uploaded_by IS NULL OR r.storage_path IS NULL OR length(r.storage_path)>1024 OR NOT
     (r.storage_path ~ ('^materials/'||r.uploaded_by::text||'/[A-Za-z0-9_-]+_[A-Za-z0-9._-]+$')) OR
     EXISTS(SELECT FROM public.materials m WHERE m.id<>p_id AND m.storage_path=r.storage_path) THEN
    RAISE EXCEPTION 'Cannot remove a shared or unverified file reference.' USING ERRCODE='23503'; END IF;
  INSERT INTO legalhub_console.material_removals(material_id,storage_path,actor_id,action,version,phrase_hash) VALUES(p_id,r.storage_path,p_actor,p_action,v,h);
  DELETE FROM public.materials WHERE id=p_id;
  INSERT INTO legalhub_console.changes(actor_id,subject_id,action) VALUES(p_actor,p_id,'material.'||p_action);
  RETURN jsonb_build_object('key',r.storage_path,'done',false);
END $$;
CREATE FUNCTION public.lh_material_file_done(p_id uuid,p_key text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog,pg_temp AS $$ BEGIN
  UPDATE legalhub_console.material_removals SET file_done_at=coalesce(file_done_at,now()) WHERE material_id=p_id AND storage_path=p_key; RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION legalhub_console.material_title(public.materials), legalhub_console.check_material_key(),
 public.lh_material_review(uuid,uuid), public.lh_material_change(uuid,uuid,text,text,text,jsonb), public.lh_material_remove(uuid,uuid,text,text,text),public.lh_material_file_done(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lh_material_review(uuid,uuid),public.lh_material_change(uuid,uuid,text,text,text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lh_material_remove(uuid,uuid,text,text,text),public.lh_material_file_done(uuid,text) TO service_role;
-- Keep existing read and pending-insert permissions/policies. Old web UPDATE/DELETE paths must not bypass review.
REVOKE UPDATE,DELETE ON public.materials FROM PUBLIC,anon,authenticated;
DO $acl$ BEGIN
 IF EXISTS(SELECT FROM (VALUES('anon'::name),('authenticated'::name)) x(r) WHERE has_any_column_privilege(r,'public.materials','UPDATE') OR has_table_privilege(r,'public.materials','DELETE,TRUNCATE,TRIGGER') OR has_function_privilege(r,'public.lh_material_remove(uuid,uuid,text,text,text)','EXECUTE') OR has_function_privilege(r,'public.lh_material_file_done(uuid,text)','EXECUTE')) OR
    NOT has_table_privilege('authenticated','public.materials','INSERT') OR NOT has_table_privilege('authenticated','public.materials','SELECT') THEN RAISE EXCEPTION 'Unexpected material permissions. Stop and review.'; END IF;
END $acl$;
NOTIFY pgrst,'reload schema';
COMMIT;
SELECT 'MATERIAL REVIEW READY' AS status;
