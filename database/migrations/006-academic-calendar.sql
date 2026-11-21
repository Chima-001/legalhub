-- Candidate only: do not run on production without a separately approved rollout.
-- No invented term dates, history migration, role changes or student-row updates.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '20s';

DO $preflight$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid='public.users'::regclass)
    OR EXISTS (SELECT 1 FROM (VALUES ('anon'::name),('authenticated'::name)) AS r(role_name)
      WHERE has_schema_privilege(r.role_name,'public','CREATE')
         OR has_column_privilege(r.role_name,'public.users','is_admin','UPDATE')
         OR has_any_column_privilege(r.role_name,'public.users','INSERT')
         OR has_table_privilege(r.role_name,'public.users','DELETE,TRIGGER,TRUNCATE,REFERENCES,MAINTAIN'))
  THEN RAISE EXCEPTION 'Profile permissions differ from the reviewed baseline. Stop; review the separate 004 permissions change first.';
  END IF;
END;
$preflight$;

CREATE TABLE public.academic_term (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  session_year integer NOT NULL CHECK (session_year BETWEEN 2000 AND 9998),
  semester integer NOT NULL CHECK (semester IN (1,2)),
  semester_start date NOT NULL,
  exam_start date NOT NULL,
  exam_end date NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  CHECK (semester_start >= DATE '1900-01-01' AND exam_end <= DATE '9999-12-31'
         AND semester_start <= exam_start AND exam_start <= exam_end)
);
ALTER TABLE public.academic_term ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.academic_term FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.academic_term TO authenticated;
CREATE POLICY term_member_read ON public.academic_term FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) IS NOT NULL);

-- Only non-sensitive schedule fields are in this table. No user ID is accepted from the UI.
CREATE FUNCTION public.get_academic_calendar() RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object(
    'today', (now() AT TIME ZONE 'Africa/Lagos')::date,
    'can_manage', EXISTS (SELECT 1 FROM public.users WHERE id=auth.uid() AND is_admin IS TRUE),
    'term', (SELECT jsonb_build_object('session_year',session_year,'semester',semester,
             'semester_start',semester_start,'exam_start',exam_start,'exam_end',exam_end,'revision',revision)
             FROM public.academic_term WHERE singleton))
  WHERE auth.uid() IS NOT NULL;
$$;

CREATE FUNCTION public.save_academic_calendar(p_session_year integer, p_semester integer,
  p_semester_start date, p_exam_start date, p_exam_end date, p_expected_revision integer, p_confirmation text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE new_revision integer; phrase text;
BEGIN
  -- Authorize each write against the current profile, not a previous UI decision or JWT metadata.
  -- Hold the role row through this transaction, including if another transaction is revoking it.
  PERFORM 1 FROM public.users WHERE id=auth.uid() AND is_admin IS TRUE FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Administrator access required.' USING ERRCODE='42501'; END IF;
  IF p_session_year IS NULL OR p_session_year NOT BETWEEN 2000 AND 9998
     OR p_semester IS NULL OR p_semester NOT IN (1,2) OR p_expected_revision IS NULL OR p_expected_revision < 0
     OR p_semester_start IS NULL OR p_exam_start IS NULL OR p_exam_end IS NULL
     OR p_semester_start < DATE '1900-01-01' OR p_exam_end > DATE '9999-12-31'
     OR p_semester_start > p_exam_start OR p_exam_start > p_exam_end THEN
    RAISE EXCEPTION 'Choose a valid session and ordered semester/exam dates.' USING ERRCODE='22023';
  END IF;
  phrase := format('i %s %s/%s %s semester',CASE WHEN p_expected_revision=0 THEN 'publish' ELSE 'update' END,
                   p_session_year,p_session_year+1,CASE p_semester WHEN 1 THEN 'first' ELSE 'second' END);
  IF p_confirmation IS DISTINCT FROM phrase THEN
    RAISE EXCEPTION 'Typed confirmation does not match.' USING ERRCODE='22023';
  END IF;
  IF p_expected_revision=0 THEN
    INSERT INTO public.academic_term(singleton,session_year,semester,semester_start,exam_start,exam_end,revision)
      VALUES(true,p_session_year,p_semester,p_semester_start,p_exam_start,p_exam_end,1)
      ON CONFLICT(singleton) DO NOTHING RETURNING revision INTO new_revision;
  ELSE
    UPDATE public.academic_term SET session_year=p_session_year, semester=p_semester,
      semester_start=p_semester_start, exam_start=p_exam_start, exam_end=p_exam_end, revision=revision+1
      WHERE singleton AND revision=p_expected_revision RETURNING revision INTO new_revision;
  END IF;
  IF new_revision IS NULL THEN RAISE EXCEPTION 'Calendar changed. Reload and review before saving.' USING ERRCODE='40001'; END IF;
  RETURN new_revision;
END;
$$;
REVOKE ALL ON FUNCTION public.get_academic_calendar(),public.save_academic_calendar(integer,integer,date,date,date,integer,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_academic_calendar(),public.save_academic_calendar(integer,integer,date,date,date,integer,text) TO authenticated;
DO $acl$
BEGIN
  IF EXISTS (SELECT 1 FROM (VALUES ('anon'::name),('authenticated'::name)) r(role_name)
    WHERE has_any_column_privilege(r.role_name,'public.academic_term','INSERT,UPDATE')
       OR has_table_privilege(r.role_name,'public.academic_term','DELETE,TRUNCATE,TRIGGER,REFERENCES,MAINTAIN'))
    OR has_any_column_privilege('anon','public.academic_term','SELECT')
    OR has_function_privilege('anon','public.save_academic_calendar(integer,integer,date,date,date,integer,text)','EXECUTE')
    OR has_function_privilege('anon','public.get_academic_calendar()','EXECUTE') THEN
    RAISE EXCEPTION 'Unexpected inherited calendar privileges. Stop and review.';
  END IF;
END;
$acl$;
COMMIT;
