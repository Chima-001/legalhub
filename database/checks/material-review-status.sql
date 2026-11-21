-- Metadata only: never calls a privileged action, reads a material, inspects a secret or changes a role.
WITH expected(sig,body_hash,access,definer) AS (VALUES
 ('legalhub_console.require_actor(uuid,boolean)','8b1ee95927b63a61bdfa0ae5288ac982','private',false),
 ('legalhub_console.check_material_key()','c24d10644268a0e437cab44174c149e4','private',true),
 ('legalhub_console.material_title(public.materials)','d849f6988d7c5c6a11ca8fb776bfdee3','private',false),
 ('public.lh_material_review(uuid,uuid)','c623890a21cc13712ccb814b809a47cd','authenticated',true),
 ('public.lh_material_change(uuid,uuid,text,text,text,jsonb)','c402dcfedc48b27486df59673eddb932','authenticated',true),
 ('public.lh_material_remove(uuid,uuid,text,text,text)','b7b66a7743206857e70ff3caae3031e4','service_role',true),
 ('public.lh_material_file_done(uuid,text)','d33d9f63d2063f536000e80f615bb884','service_role',true)), checked AS (
 SELECT e.*,p.oid,md5(replace(p.prosrc,chr(13),''))=body_hash AND p.prosecdef=definer AS body_ok,
   NOT has_function_privilege('anon',p.oid,'EXECUTE') AND
   (has_function_privilege('authenticated',p.oid,'EXECUTE')=(access='authenticated')) AND
   (access='private' OR has_function_privilege('service_role',p.oid,'EXECUTE')=(access='service_role')) AS acl_ok
 FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.sig)
), facts AS (
 SELECT (SELECT count(*) FROM checked WHERE oid IS NOT NULL) AS installed,
  (SELECT count(*) FROM checked WHERE body_ok AND acl_ok) AS reviewed,
  EXISTS(SELECT FROM checked WHERE sig='legalhub_console.require_actor(uuid,boolean)' AND body_ok AND acl_ok) AS actor,
  EXISTS(SELECT FROM pg_trigger WHERE tgrelid='public.materials'::regclass AND tgname='lh_resolve_material_course' AND tgenabled IN ('O','A')) AS catalogue,
  EXISTS(SELECT FROM pg_trigger WHERE tgrelid='public.materials'::regclass AND tgname='lh_retired_material_key' AND tgenabled IN ('O','A') AND tgfoid=to_regprocedure('legalhub_console.check_material_key()')) AS retired,
  coalesce((SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('legalhub_console.material_removals')),false) AS receipts,
  (SELECT relrowsecurity FROM pg_class WHERE oid='public.materials'::regclass) AND has_table_privilege('authenticated','public.materials','SELECT') AND has_table_privilege('authenticated','public.materials','INSERT') AS reads_uploads,
  NOT EXISTS(SELECT FROM (VALUES ('anon'::name),('authenticated'::name)) w(r) WHERE has_schema_privilege(r,'legalhub_console','USAGE,CREATE') OR has_schema_privilege(r,'public','CREATE') OR has_table_privilege(r,'public.materials','TRUNCATE,TRIGGER')) AS private_baseline,
  NOT EXISTS(SELECT FROM (VALUES ('anon'::name),('authenticated'::name)) w(r) WHERE has_any_column_privilege(r,'public.materials','UPDATE') OR has_table_privilege(r,'public.materials','DELETE')) AS no_unreviewed_write
)
SELECT CASE WHEN installed=1 AND actor AND catalogue AND reads_uploads AND private_baseline AND NOT retired AND to_regclass('legalhub_console.material_removals') IS NULL THEN 'REVIEW SERVICE NOT INSTALLED'
 WHEN installed=7 AND reviewed=7 AND actor AND catalogue AND retired AND receipts AND reads_uploads AND private_baseline AND no_unreviewed_write THEN 'MATERIAL DATABASE READY'
 ELSE 'STOP: REVIEW MATERIAL SCHEMA' END AS material_db_status FROM facts;
