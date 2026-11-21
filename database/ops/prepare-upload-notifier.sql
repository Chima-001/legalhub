-- Operator record of the LegalHub project-specific, one-time transport preparation. Already installed on legalhub.
-- Never run this file to fix a missing provider setting. No sender key, JWT, upload or outgoing request here.
BEGIN;
SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='30s';
DO $$ BEGIN IF auth.uid() IS NOT NULL OR to_regprocedure('public.lh_owner_admin_emails(uuid)') IS NULL OR EXISTS(SELECT FROM pg_extension WHERE extname IN ('http','pg_cron','pg_net')) OR to_regnamespace('lh_mail_transport') IS NOT NULL OR EXISTS(SELECT FROM vault.secrets WHERE name IN ('lh_upload_hook_secret','lh_upload_project_ref','lh_upload_anon_jwt')) OR EXISTS(SELECT FROM pg_trigger WHERE tgrelid='public.materials'::regclass AND NOT tgisinternal AND (tgtype::int & 4)=4 AND tgname <> 'lh_resolve_material_course') THEN RAISE EXCEPTION 'Unexpected transport baseline; no second sender or configuration replacement.'; END IF; END $$;
CREATE SCHEMA lh_mail_transport; REVOKE ALL ON SCHEMA lh_mail_transport FROM PUBLIC,anon,authenticated,service_role;
CREATE EXTENSION http WITH SCHEMA lh_mail_transport; CREATE EXTENSION pg_cron WITH SCHEMA pg_catalog;
DO $$ BEGIN IF to_regprocedure('lh_mail_transport.http(lh_mail_transport.http_request)') IS NULL OR to_regprocedure('cron.schedule(text,text,text)') IS NULL OR NOT has_function_privilege(current_user,'cron.schedule(text,text,text)','EXECUTE') OR EXISTS(SELECT FROM cron.job) OR EXISTS(SELECT FROM (VALUES ('anon'::name),('authenticated'::name)) w(r) WHERE has_schema_privilege(r,'lh_mail_transport','USAGE,CREATE') OR (has_schema_privilege(r,'cron','USAGE') AND has_function_privilege(r,'cron.schedule(text,text,text)','EXECUTE')) OR has_table_privilege(r,'vault.decrypted_secrets','SELECT')) THEN RAISE EXCEPTION 'Expected an empty private transport, scheduler and Vault.'; END IF;
 PERFORM vault.create_secret('iyeekpmutpugpmarddpa','lh_upload_project_ref','Fixed destination of LegalHub upload notifications');
 PERFORM vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'lh_upload_hook_secret','Generated and used only inside PostgreSQL for signed LegalHub upload events');
END $$;
COMMIT;
