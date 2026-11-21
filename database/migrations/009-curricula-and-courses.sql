-- An admin creates each named curriculum. One curriculum has many courses across levels/semesters.
-- Additive to the existing canonical public.courses IDs. No invented curriculum and no material-row backfill.
BEGIN;
SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='30s';
LOCK TABLE public.courses,public.course_case_links,public.materials IN SHARE ROW EXCLUSIVE MODE;
DO $pre$ BEGIN
 IF to_regprocedure('legalhub_console.require_actor(uuid,boolean)') IS NULL OR (SELECT count(*) FROM legalhub_console.owner_identity)<>1 THEN RAISE EXCEPTION 'Reviewed single-owner authority is required.'; END IF;
 PERFORM id,name,code,level,semester,created_at FROM public.courses WHERE false;
 PERFORM id,course,level,semester FROM public.materials WHERE false;
 IF EXISTS(SELECT FROM public.courses) THEN RAISE EXCEPTION 'Course baseline changed. Keep these rows and review an ID-preserving import; do not clear the table.'; END IF;
 IF EXISTS(SELECT FROM pg_class WHERE oid IN ('public.courses'::regclass,'public.materials'::regclass,'public.course_case_links'::regclass) AND (NOT relrowsecurity OR relkind<>'r')) OR NOT EXISTS(
 SELECT FROM pg_constraint WHERE conrelid='public.course_case_links'::regclass AND confrelid='public.courses'::regclass AND conname='course_case_links_course_id_fkey' AND contype='f' AND confdeltype='c' AND conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=conrelid AND attname='course_id')] AND confkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=confrelid AND attname='id')]) THEN RAISE EXCEPTION 'Unreviewed RLS, relation or course-case constraint.'; END IF;
 IF EXISTS(SELECT FROM pg_constraint WHERE confrelid='public.courses'::regclass AND contype='f' AND confdeltype NOT IN ('a','r') AND NOT(conrelid='public.course_case_links'::regclass AND conname='course_case_links_course_id_fkey')) THEN RAISE EXCEPTION 'Unexpected destructive course relationship. Review before installation.'; END IF;
END $pre$;
-- Preserve case associations, including for deletes outside the new RPC. The case-side FK is untouched.
ALTER TABLE public.course_case_links DROP CONSTRAINT course_case_links_course_id_fkey,
 ADD CONSTRAINT course_case_links_course_id_fkey FOREIGN KEY(course_id) REFERENCES public.courses(id) ON DELETE RESTRICT;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER,REFERENCES,MAINTAIN ON public.courses FROM PUBLIC,anon,authenticated;
REVOKE TRUNCATE,TRIGGER,REFERENCES,MAINTAIN ON public.course_case_links,public.materials FROM PUBLIC,anon,authenticated;
-- Existing SELECT policies and row-level upload/moderation rights are not widened or replaced.
CREATE TABLE legalhub_console.curricula (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL CHECK(length(name) BETWEEN 1 AND 100 AND name=btrim(name) AND name !~ '[[:cntrl:]]'),
 description text NOT NULL DEFAULT '' CHECK(length(description)<=400), revision integer NOT NULL DEFAULT 1 CHECK(revision>0)
);
CREATE UNIQUE INDEX lh_curriculum_label ON legalhub_console.curricula(lower(name));
CREATE TABLE legalhub_console.course_listings (
 course_id uuid PRIMARY KEY REFERENCES public.courses(id) ON DELETE RESTRICT,
 curriculum_id uuid REFERENCES legalhub_console.curricula(id) ON DELETE RESTRICT,
 slug text NOT NULL UNIQUE, material_key text NOT NULL, position integer NOT NULL DEFAULT 1000,
 authored boolean NOT NULL DEFAULT false, archived boolean NOT NULL DEFAULT false, revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 CHECK(curriculum_id IS NOT NULL OR authored)
);
CREATE INDEX lh_course_curriculum ON legalhub_console.course_listings(curriculum_id);
CREATE TABLE legalhub_console.retired_course_keys(level text NOT NULL,semester text NOT NULL,key_lower text NOT NULL,PRIMARY KEY(level,semester,key_lower));
ALTER TABLE legalhub_console.curricula ENABLE ROW LEVEL SECURITY;
ALTER TABLE legalhub_console.course_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE legalhub_console.retired_course_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON legalhub_console.curricula,legalhub_console.course_listings,legalhub_console.retired_course_keys FROM PUBLIC,anon,authenticated;
-- No real administrator has chosen a curriculum for the authored desk yet. Preserve its exact identity and links.
DO $seed$ DECLARE r record; cid uuid; BEGIN
 FOR r IN SELECT * FROM (VALUES
 ('legal-method','Legal Method','PUL 102','Legal Method',1),('customary-law','Customary Law','UNN LAW','Customary Law',2),
 ('philosophy','Philosophy','PHIL 105','Philosophy',3),('psychology','Psychology','PSY 102','Psychology',4),
 ('intro-to-nigerian-literature','Intro to Nigerian Literature','ELS 110','Introduction to Nigerian Literature',5),
 ('communication-in-english','Communication in English','GST 114','Communication in English',6),
 ('natural-science','Natural Science','GST','Natural Science',7),('logics','Logics','Law 102','Logics',8)) AS seed(slug,name,code,key,position) LOOP
  INSERT INTO public.courses(name,code,level,semester) VALUES(r.name,r.code,'100L','second') RETURNING id INTO cid;
  INSERT INTO legalhub_console.course_listings(course_id,slug,material_key,position,authored) VALUES(cid,r.slug,r.key,r.position,true);
 END LOOP;
END $seed$;
-- New or re-scoped material rows acquire a real FK whenever the text key resolves to one listing.
-- Keep pre-existing text and unscoped/general material reachable. Never accept a user-supplied FK as authority.
ALTER TABLE public.materials ADD COLUMN catalog_course_id uuid REFERENCES public.courses(id) ON DELETE RESTRICT;
CREATE INDEX lh_material_catalog_course ON public.materials(catalog_course_id) WHERE catalog_course_id IS NOT NULL;
CREATE FUNCTION legalhub_console.material_course_ref() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE matches uuid[]; any_live boolean; BEGIN
 IF TG_OP='UPDATE' AND ROW(OLD.course,OLD.level,OLD.semester) IS NOT DISTINCT FROM ROW(NEW.course,NEW.level,NEW.semester) THEN NEW.catalog_course_id:=OLD.catalog_course_id; RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock_shared(1751326952,9);
 SELECT array_agg(c.id),bool_or(NOT s.archived) INTO matches,any_live FROM public.courses c JOIN legalhub_console.course_listings s ON s.course_id=c.id
 WHERE lower(s.material_key)=lower(btrim(NEW.course)) AND c.level=NEW.level AND (NEW.semester IS NULL OR NEW.semester='all' OR c.semester=NEW.semester);
 IF any_live IS FALSE THEN RAISE EXCEPTION 'That course is archived. Refresh the course list.' USING ERRCODE='23503'; END IF;
 IF cardinality(matches)=1 THEN NEW.catalog_course_id:=matches[1]; ELSE NEW.catalog_course_id:=NULL; END IF;
 IF coalesce(cardinality(matches),0)=0 AND (lower(NEW.course) LIKE 'lh-course-%' OR EXISTS(SELECT FROM legalhub_console.retired_course_keys k WHERE k.key_lower=lower(btrim(NEW.course)) AND k.level=NEW.level AND (NEW.semester IS NULL OR NEW.semester='all' OR k.semester=NEW.semester))) THEN
   RAISE EXCEPTION 'That course was removed. Refresh the course list.' USING ERRCODE='23503'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER lh_resolve_material_course BEFORE INSERT OR UPDATE OF course,level,semester,catalog_course_id ON public.materials FOR EACH ROW EXECUTE FUNCTION legalhub_console.material_course_ref();

CREATE FUNCTION public.lh_curricula(p_actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$ BEGIN
 PERFORM legalhub_console.require_actor(p_actor,false);
 RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('id',k.id,'name',k.name,'description',k.description,'revision',k.revision,'count',(SELECT count(*) FROM legalhub_console.course_listings s WHERE s.curriculum_id=k.id)) ORDER BY lower(k.name),k.id),'[]'::jsonb) FROM legalhub_console.curricula k); END $$;
CREATE FUNCTION public.lh_course_list(p_level text,p_semester text,p_include_archived boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$ BEGIN
 IF auth.uid() IS NULL OR (p_include_archived AND NOT EXISTS(SELECT FROM public.users WHERE id=auth.uid() AND is_admin IS TRUE)) THEN RAISE EXCEPTION 'Not authorized.' USING ERRCODE='42501'; END IF;
 RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'level',c.level,'semester',c.semester,'slug',s.slug,'name',c.name,'code',coalesce(c.code,''),'key',s.material_key,'archived',s.archived,'revision',s.revision,'curriculum_id',k.id,'curriculum_name',k.name)
 ORDER BY c.level,c.semester,s.position,lower(k.name),lower(c.name),c.id),'[]'::jsonb)
 FROM public.courses c JOIN legalhub_console.course_listings s ON s.course_id=c.id LEFT JOIN legalhub_console.curricula k ON k.id=s.curriculum_id
 WHERE (p_level IS NULL OR c.level=p_level) AND (p_semester IS NULL OR c.semester=p_semester) AND (NOT s.archived OR p_include_archived IS TRUE)); END $$;

CREATE FUNCTION public.lh_write_curriculum(p_actor uuid,p_action text,p_id uuid,p_revision integer,p_name text,p_description text,p_phrase text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE old legalhub_console.curricula%ROWTYPE; label text:=btrim(p_name); note text:=btrim(coalesce(p_description,'')); cid uuid; BEGIN
 PERFORM legalhub_console.require_actor(p_actor,false); PERFORM pg_advisory_xact_lock(1751326952,9);
 IF p_action IS NULL OR p_action NOT IN ('add','edit','delete') THEN RAISE EXCEPTION 'Unknown curriculum action.' USING ERRCODE='22023'; END IF;
 IF p_action<>'delete' AND (label IS NULL OR length(label) NOT BETWEEN 1 AND 100 OR label ~ '[[:cntrl:]]' OR length(note)>400) THEN RAISE EXCEPTION 'Check curriculum name and description.' USING ERRCODE='22023'; END IF;
 IF p_action='add' THEN
  IF p_id IS NOT NULL OR p_revision IS DISTINCT FROM 0 OR p_phrase IS DISTINCT FROM 'i add '||label THEN RAISE EXCEPTION 'Review the new curriculum and type the exact phrase.' USING ERRCODE='22023'; END IF;
  INSERT INTO legalhub_console.curricula(name,description) VALUES(label,note) RETURNING id INTO cid;
 ELSE
  SELECT * INTO old FROM legalhub_console.curricula WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR old.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'Curriculum changed. Reload.' USING ERRCODE='40001'; END IF;
  IF p_phrase IS DISTINCT FROM 'i '||p_action||' '||old.name THEN RAISE EXCEPTION 'Typed curriculum confirmation does not match.' USING ERRCODE='22023'; END IF; cid:=old.id;
  IF p_action='edit' THEN UPDATE legalhub_console.curricula SET name=label,description=note,revision=revision+1 WHERE id=cid;
  ELSE IF EXISTS(SELECT FROM legalhub_console.course_listings WHERE curriculum_id=cid) THEN RAISE EXCEPTION 'Move the assigned courses first. Nothing was deleted.' USING ERRCODE='23503'; END IF;
   DELETE FROM legalhub_console.curricula WHERE id=cid; END IF;
 END IF; INSERT INTO legalhub_console.changes(actor_id,subject_id,action) VALUES(auth.uid(),cid,'curriculum.'||p_action); RETURN cid; END $$;

CREATE FUNCTION public.lh_write_course(p_actor uuid,p_action text,p_id uuid,p_revision integer,p_level text,p_semester text,p_curriculum uuid,p_curriculum_revision integer,p_name text,p_code text,p_phrase text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE old record; label text:=btrim(p_name); cc text:=btrim(coalesce(p_code,'')); cid uuid; key text; currev integer; BEGIN
 PERFORM legalhub_console.require_actor(p_actor,false); PERFORM pg_advisory_xact_lock(1751326952,9);
 IF p_action IS NULL OR p_action NOT IN ('add','edit','archive','restore','delete') OR p_level IS NULL OR p_level NOT IN ('100L','200L','300L','400L','500L') OR p_semester IS NULL OR p_semester NOT IN ('first','second') THEN RAISE EXCEPTION 'Check course action and semester.' USING ERRCODE='22023'; END IF;
 IF p_action<>'add' THEN
  SELECT c.name,s.* INTO old FROM public.courses c JOIN legalhub_console.course_listings s ON s.course_id=c.id WHERE c.id=p_id AND c.level=p_level AND c.semester=p_semester FOR UPDATE OF c,s;
  IF NOT FOUND OR old.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'Course changed. Reload.' USING ERRCODE='40001'; END IF; cid:=p_id;
  IF p_phrase IS DISTINCT FROM 'i '||p_action||' '||old.name THEN RAISE EXCEPTION 'Typed course confirmation does not match.' USING ERRCODE='22023'; END IF;
 ELSIF p_id IS NOT NULL OR p_revision IS DISTINCT FROM 0 OR p_phrase IS DISTINCT FROM 'i add '||label THEN RAISE EXCEPTION 'Review the new course and type the exact phrase.' USING ERRCODE='22023'; END IF;
 IF p_action IN ('add','edit') THEN
  IF label IS NULL OR length(label) NOT BETWEEN 1 AND 120 OR label ~ '[[:cntrl:]]' OR lower(label) IN ('all','relevant materials') OR lower(label) LIKE 'lh-course-%' OR length(cc)>32 OR cc ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'Check course name and code.' USING ERRCODE='22023'; END IF;
  SELECT revision INTO currev FROM legalhub_console.curricula WHERE id=p_curriculum FOR SHARE;
  IF NOT FOUND OR currev IS DISTINCT FROM p_curriculum_revision THEN RAISE EXCEPTION 'Choose a current curriculum. Reload if it changed.' USING ERRCODE='40001'; END IF;
  IF EXISTS(SELECT FROM public.courses c JOIN legalhub_console.course_listings s ON s.course_id=c.id WHERE c.level=p_level AND c.semester=p_semester AND s.curriculum_id=p_curriculum AND lower(c.name)=lower(label) AND c.id IS DISTINCT FROM p_id) THEN RAISE EXCEPTION 'This course is already in that curriculum and semester.' USING ERRCODE='23505'; END IF;
  IF p_action='add' THEN
   INSERT INTO public.courses(name,code,level,semester) VALUES(label,cc,p_level,p_semester) RETURNING id INTO cid; key:=label;
   IF EXISTS(SELECT FROM legalhub_console.course_listings s JOIN public.courses c ON c.id=s.course_id WHERE c.level=p_level AND c.semester=p_semester AND lower(s.material_key)=lower(key)) OR EXISTS(SELECT FROM legalhub_console.retired_course_keys WHERE level=p_level AND semester=p_semester AND key_lower=lower(key)) THEN key:='lh-course-'||cid::text; END IF;
   INSERT INTO legalhub_console.course_listings(course_id,curriculum_id,slug,material_key) VALUES(cid,p_curriculum,'course-'||replace(cid::text,'-',''),key);
  ELSE UPDATE public.courses SET name=label,code=cc WHERE id=cid; UPDATE legalhub_console.course_listings SET curriculum_id=p_curriculum,revision=revision+1 WHERE course_id=cid; END IF;
 ELSIF p_action IN ('archive','restore') THEN
  IF old.archived=(p_action='archive') THEN RAISE EXCEPTION 'Listing state changed.' USING ERRCODE='40001'; END IF;
  UPDATE legalhub_console.course_listings SET archived=(p_action='archive'),revision=revision+1 WHERE course_id=cid;
 ELSE
  IF old.authored OR EXISTS(SELECT FROM public.course_case_links WHERE course_id=cid) OR EXISTS(SELECT FROM public.materials m WHERE m.catalog_course_id=cid OR (lower(btrim(m.course))=lower(old.material_key) AND (m.level IS NULL OR m.level=p_level) AND (m.semester IS NULL OR m.semester IN ('all',p_semester)))) THEN RAISE EXCEPTION 'Referenced course. Archive instead; no material or case link was deleted.' USING ERRCODE='23503'; END IF;
  IF EXISTS(SELECT FROM pg_constraint WHERE contype='f' AND confrelid='public.courses'::regclass AND confdeltype NOT IN ('a','r')) THEN RAISE EXCEPTION 'Course references changed. Review deletion first.' USING ERRCODE='23503'; END IF;
  INSERT INTO legalhub_console.retired_course_keys VALUES(p_level,p_semester,lower(old.material_key));
  DELETE FROM legalhub_console.course_listings WHERE course_id=cid; DELETE FROM public.courses WHERE id=cid;
 END IF; INSERT INTO legalhub_console.changes(actor_id,subject_id,action) VALUES(auth.uid(),cid,'course.'||p_action); RETURN cid; END $$;
REVOKE ALL ON FUNCTION legalhub_console.material_course_ref() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.lh_curricula(uuid),public.lh_course_list(text,text,boolean),public.lh_write_curriculum(uuid,text,uuid,integer,text,text,text),public.lh_write_course(uuid,text,uuid,integer,text,text,uuid,integer,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lh_curricula(uuid),public.lh_course_list(text,text,boolean),public.lh_write_curriculum(uuid,text,uuid,integer,text,text,text),public.lh_write_course(uuid,text,uuid,integer,text,text,uuid,integer,text,text,text) TO authenticated;
DO $verify$ BEGIN IF EXISTS(SELECT FROM (VALUES('anon'::name),('authenticated'::name)) x(r) WHERE has_any_column_privilege(r,'public.courses','INSERT,UPDATE') OR has_table_privilege(r,'public.courses','DELETE,TRUNCATE,TRIGGER,REFERENCES,MAINTAIN') OR has_table_privilege(r,'public.materials','TRUNCATE,TRIGGER,REFERENCES,MAINTAIN') OR has_table_privilege(r,'public.course_case_links','TRUNCATE,TRIGGER,REFERENCES,MAINTAIN')) OR EXISTS(SELECT FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN ('lh_curricula','lh_course_list','lh_write_curriculum','lh_write_course') AND has_function_privilege('anon',p.oid,'EXECUTE')) THEN RAISE EXCEPTION 'Unexpected inherited catalogue privileges. Stop and review.'; END IF; END $verify$;
COMMIT;
