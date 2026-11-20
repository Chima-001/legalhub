-- Candidate only. Academic-calendar migration 006 first. No bulk UPDATE/backfill.
-- Owner decision: every existing saved level is a 2025/2026 baseline, regardless of account age.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '20s';
DO $preflight$
BEGIN
  IF to_regclass('public.academic_term') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid='public.get_effective_level(uuid)'::regprocedure
    AND p.prorettype='text'::regtype AND p.proargnames=ARRAY['p_uid']::text[]
    AND md5(replace(p.prosrc,chr(13),''))='2639e14bfd9df4cb66ddc38e9e41410a') THEN
    RAISE EXCEPTION 'Calendar or December level function differs from reviewed baseline. Stop and inspect.';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.users'::regclass)
     OR EXISTS (SELECT 1 FROM (VALUES ('anon'::name),('authenticated'::name)) r(role_name)
       WHERE has_schema_privilege(r.role_name,'public','CREATE')
          OR has_column_privilege(r.role_name,'public.users','is_admin','UPDATE')
          OR has_column_privilege(r.role_name,'public.users','level','UPDATE')
          OR has_any_column_privilege(r.role_name,'public.users','INSERT')
          OR has_table_privilege(r.role_name,'public.users','UPDATE,DELETE,TRIGGER,TRUNCATE,REFERENCES,MAINTAIN')) THEN
    RAISE EXCEPTION 'Unsafe or unexpected profile privileges. Stop and review.';
  END IF;
END;
$preflight$;

CREATE FUNCTION public.academic_cycle_year(p_on date) RETURNS integer
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXTRACT(YEAR FROM p_on)::integer - CASE WHEN p_on < make_date(EXTRACT(YEAR FROM p_on)::integer,11,7) THEN 1 ELSE 0 END;
$$;
-- A published upcoming session may be used for early entrants. Rewinding the term or
-- publishing a far-future schedule cannot retroactively change an existing level anchor.
CREATE FUNCTION public.academic_assignment_year() RETURNS integer
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
  WITH cycle(y) AS (SELECT public.academic_cycle_year((now() AT TIME ZONE 'Africa/Lagos')::date))
  SELECT CASE WHEN (SELECT session_year FROM public.academic_term WHERE singleton)=y+1 THEN y+1 ELSE y END FROM cycle;
$$;

-- In two steps: existing rows stay NULL (2025 baseline); only future inserts receive the default.
ALTER TABLE public.users ADD COLUMN level_base_year integer CHECK (level_base_year BETWEEN 2000 AND 9998);
ALTER TABLE public.users ALTER COLUMN level_base_year SET DEFAULT public.academic_assignment_year();

CREATE FUNCTION public.academic_level_on(p_level text, p_base_year integer, p_on date) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog, pg_temp AS $$
  WITH a(tiers) AS (VALUES (ARRAY['100L','200L','300L','400L','500L'])),
       b(tiers,idx) AS (SELECT tiers,array_position(tiers,p_level) FROM a)
  SELECT CASE WHEN idx IS NULL THEN coalesce(p_level,'100L') ELSE tiers[least(5::bigint,idx + greatest(0::bigint,
    public.academic_cycle_year(p_on)::bigint-coalesce(p_base_year,2025)::bigint))::integer] END FROM b;
$$;
-- Preserve signature for the profile/library. Reads respect the caller's existing profile RLS.
CREATE OR REPLACE FUNCTION public.get_effective_level(p_uid uuid) RETURNS text
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
  -- Keep a recognised older library level if current_level was never saved. With neither,
  -- retain the old 100L display fallback, not an invented 2025/26 record to advance.
  SELECT public.academic_level_on(coalesce(u.current_level,
    CASE WHEN u.level::text IN ('100L','200L','300L','400L','500L') THEN u.level::text END),
    u.level_base_year,(now() AT TIME ZONE 'Africa/Lagos')::date)
    FROM public.users u WHERE u.id=p_uid;
$$;
CREATE FUNCTION public.get_my_level_context() RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object('account_id',auth.uid(),'level',public.get_effective_level(auth.uid()),'assignment_year',public.academic_assignment_year())
    WHERE auth.uid() IS NOT NULL AND EXISTS(SELECT 1 FROM public.users u WHERE u.id=auth.uid());
$$;

CREATE FUNCTION public.set_my_academic_level(p_level text, p_session_year integer, p_confirmation text, p_expected_uid uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE uid uuid := auth.uid(); current_year integer := public.academic_assignment_year(); saved text;
BEGIN
  -- The reviewed account ID is a precondition only. The UPDATE target is always auth.uid().
  IF uid IS NULL OR uid IS DISTINCT FROM p_expected_uid THEN
    RAISE EXCEPTION 'Your signed-in account changed. Reload before saving.' USING ERRCODE='42501';
  END IF;
  IF p_level IS NULL OR p_level NOT IN ('100L','200L','300L','400L','500L') THEN
    RAISE EXCEPTION 'Choose a valid level.' USING ERRCODE='22023';
  END IF;
  IF p_session_year IS DISTINCT FROM current_year THEN
    RAISE EXCEPTION 'The assignment session changed. Reload and confirm again.' USING ERRCODE='40001';
  END IF;
  IF p_confirmation IS DISTINCT FROM format('i update %s for %s/%s',p_level,current_year,current_year+1) THEN
    RAISE EXCEPTION 'Typed confirmation does not match.' USING ERRCODE='22023';
  END IF;
  UPDATE public.users SET current_level=p_level, level_base_year=current_year, level_updated_at=now()
    WHERE id=uid RETURNING current_level INTO saved;
  IF NOT FOUND THEN RAISE EXCEPTION 'Your profile is unavailable.' USING ERRCODE='42501'; END IF;
  RETURN saved;
END;
$$;
-- Self-service still works via the single-purpose RPC. Do not revoke username/avatar editing.
REVOKE UPDATE(current_level,level_updated_at,level_base_year) ON public.users FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.academic_cycle_year(date),public.academic_assignment_year(),public.academic_level_on(text,integer,date),
  public.get_effective_level(uuid),public.get_my_level_context(),public.set_my_academic_level(text,integer,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.academic_cycle_year(date),public.academic_assignment_year(),public.academic_level_on(text,integer,date),
  public.get_effective_level(uuid),public.get_my_level_context(),public.set_my_academic_level(text,integer,text,uuid) TO authenticated;
DO $acl$
BEGIN
  IF EXISTS (SELECT 1 FROM (VALUES ('anon'::name),('authenticated'::name)) r(role_name)
    CROSS JOIN (VALUES ('current_level'::text),('level_updated_at'),('level_base_year'),('is_admin')) c(col)
    WHERE has_column_privilege(r.role_name,'public.users',c.col,'UPDATE'))
    OR has_function_privilege('anon','public.set_my_academic_level(text,integer,text,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'Unexpected inherited level grants. Stop and review.';
  END IF;
END;
$acl$;
COMMIT;
