-- Operator SELECTs after installation; counts/metadata only. Does not invoke the sender or dispatch function.
SELECT (SELECT count(*) FROM pg_trigger WHERE tgrelid='public.materials'::regclass AND NOT tgisinternal AND (tgtype::int & 4)=4 AND (tgtype::int & 2)=0 AND tgenabled IN ('O','A')) AS enabled_after_insert,
 EXISTS(SELECT FROM pg_trigger WHERE tgrelid='public.materials'::regclass AND tgname='lh_material_upload_alert' AND tgfoid='legalhub_console.material_upload_alert()'::regprocedure AND tgenabled IN ('O','A')) AS expected_capture,
 (SELECT count(*) FROM cron.job WHERE jobname='legalhub_upload_dispatch' AND active AND schedule='* * * * *' AND command='SELECT legalhub_console.dispatch_upload_alerts_due()') AS active_dispatch_jobs,
 (SELECT count(*) FROM vault.secrets WHERE name IN ('lh_upload_project_ref','lh_upload_hook_secret'))=2 AS signer_slots,
 EXISTS(SELECT FROM vault.secrets WHERE name='lh_upload_anon_jwt') AS gateway_slot_present,
 NOT EXISTS(SELECT FROM (VALUES('anon'::name),('authenticated'::name)) r(n) WHERE has_schema_privilege(n,'lh_mail_transport','USAGE,CREATE') OR has_schema_privilege(n,'legalhub_console','USAGE,CREATE') OR has_table_privilege(n,'vault.decrypted_secrets','SELECT') OR has_function_privilege(n,'public.lh_upload_alert_claim(uuid,uuid)','EXECUTE')) AS private_boundaries;
SELECT count(*) AS captured_uploads, count(*) FILTER(WHERE attempts=0) AS not_attempted,
 count(*) FILTER(WHERE last_http_status>=200 AND last_http_status<300) AS edge_2xx,
 count(*) FILTER(WHERE dispatch_failed) AS last_attempt_failed,
 count(*) FILTER(WHERE next_attempt_at IS NULL AND EXISTS(SELECT FROM legalhub_console.upload_alert_targets t WHERE t.material_id=e.material_id AND t.outcome='waiting')) AS parked_with_pending_targets,
 count(*) FILTER(WHERE NOT EXISTS(SELECT FROM legalhub_console.upload_alert_targets t WHERE t.material_id=e.material_id)) AS no_targets FROM legalhub_console.upload_alerts e;
SELECT count(*) FILTER(WHERE outcome='accepted' AND provider_id IS NOT NULL) AS provider_acceptances,
 count(*) FILTER(WHERE outcome='waiting') AS waiting_recipients,count(*) FILTER(WHERE outcome='revoked') AS no_longer_admin FROM legalhub_console.upload_alert_targets;
SELECT r.status,r.end_time FROM cron.job_run_details r JOIN cron.job j USING(jobid) WHERE j.jobname='legalhub_upload_dispatch' ORDER BY r.start_time DESC LIMIT 1;
