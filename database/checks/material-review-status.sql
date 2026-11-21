-- Metadata only: the published and updated pages intentionally share the existing Materials contract.
-- This checks database access, not the site, live user sessions or external file storage.
WITH p AS (SELECT cmd,roles,permissive,qual,with_check FROM pg_policies WHERE schemaname='public' AND tablename='materials'),
policies AS (SELECT count(*) FILTER(WHERE cmd IN ('ALL','UPDATE'))=1 AND
  count(*) FILTER(WHERE cmd='UPDATE' AND roles=ARRAY['public'::name] AND permissive='PERMISSIVE' AND qual='is_admin(auth.uid())' AND with_check IS NULL)=1 AND
  count(*) FILTER(WHERE cmd='INSERT')=1 AND count(*) FILTER(WHERE cmd='INSERT' AND roles=ARRAY['authenticated'::name] AND permissive='PERMISSIVE' AND with_check='((auth.uid() = uploaded_by) AND (status = ''pending''::text))')=1 AND
  count(*) FILTER(WHERE cmd='SELECT')=2 AND count(*) FILTER(WHERE cmd='SELECT' AND roles=ARRAY['public'::name] AND permissive='PERMISSIVE' AND qual='is_admin(auth.uid())')=1 AND
  count(*) FILTER(WHERE cmd='SELECT' AND roles=ARRAY['public'::name] AND permissive='PERMISSIVE' AND qual='(status = ''approved''::text)')=1 AS ok FROM p),
rights AS (SELECT (SELECT relrowsecurity FROM pg_class WHERE oid='public.materials'::regclass)
  AND has_table_privilege('authenticated','public.materials','SELECT') AND has_table_privilege('authenticated','public.materials','INSERT') AND has_table_privilege('authenticated','public.materials','UPDATE')
  AND NOT has_any_column_privilege('anon','public.materials','INSERT,UPDATE') AND NOT EXISTS(SELECT FROM (VALUES ('anon'::name),('authenticated'::name)) w(r) WHERE has_schema_privilege(r,'public','CREATE') OR has_table_privilege(r,'public.materials','DELETE,TRIGGER,TRUNCATE') OR has_column_privilege(r,'public.users','is_admin','UPDATE'))
  AND EXISTS(SELECT FROM pg_proc WHERE oid=to_regprocedure('public.is_admin(uuid)') AND prosecdef AND prorettype='boolean'::regtype AND md5(replace(prosrc,chr(13),''))='69f42a6e7623c08f38a960fa38b9ba85' AND has_function_privilege('authenticated',oid,'EXECUTE')) AS ok),
shape AS (SELECT NOT EXISTS (SELECT FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('lh_material_review','lh_material_change','lh_material_remove','lh_material_file_done'))
  AND to_regclass('legalhub_console.material_removals') IS NULL
  AND EXISTS(SELECT FROM pg_trigger WHERE tgrelid='public.materials'::regclass AND tgname='lh_resolve_material_course' AND tgenabled IN ('O','A'))
  AND NOT EXISTS(SELECT FROM pg_trigger WHERE tgrelid='public.materials'::regclass AND NOT tgisinternal AND (tgtype::int & 8)<>0)
  AND NOT EXISTS(SELECT FROM pg_constraint WHERE contype='f' AND confrelid='public.materials'::regclass) AS ok)
SELECT CASE WHEN policies.ok AND rights.ok AND shape.ok THEN 'MATERIALS YES/NO DATABASE READY' ELSE 'STOP: REVIEW MATERIAL SCHEMA' END AS material_db_status FROM policies,rights,shape;
