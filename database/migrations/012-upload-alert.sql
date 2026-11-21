-- Reconnect the existing notify-admins-on-upload function to ONE materials INSERT webhook.
-- Owner-reviewed installation only; prerequisite secrets and pg_net are NOT installed here.
-- No old materials are scanned, no test webhook is sent and no existing row is edited.
BEGIN;
SET LOCAL search_path = pg_catalog,pg_temp;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE public.materials IN SHARE ROW EXCLUSIVE MODE;
DO $pre$ BEGIN
 IF auth.uid() IS NOT NULL OR to_regprocedure('public.lh_material_review(uuid,uuid)') IS NULL OR
    to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') IS NULL OR to_regprocedure('extensions.hmac(bytea,bytea,text)') IS NULL OR
    to_regclass('vault.decrypted_secrets') IS NULL OR to_regrole('service_role') IS NULL OR
    EXISTS(SELECT FROM (VALUES ('anon'::name),('authenticated'::name)) x(r) WHERE has_schema_privilege(r,'legalhub_console','USAGE,CREATE') OR has_schema_privilege(r,'public','CREATE') OR has_table_privilege(r,'vault.decrypted_secrets','SELECT')) OR
    EXISTS(SELECT FROM pg_trigger WHERE tgrelid='public.materials'::regclass AND NOT tgisinternal AND (tgtype::int & 4)=4 AND tgname NOT IN ('lh_retired_material_key','lh_resolve_material_course')) OR
    EXISTS(SELECT FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('lh_upload_alert_plan','lh_upload_alert_claim','lh_upload_alert_ack')) THEN
   RAISE EXCEPTION 'Stop: verify 011, pg_net, private Vault, service role and absence of another material-insert webhook. Never double-wire it.';
 END IF;
 IF NOT EXISTS(SELECT FROM pg_trigger WHERE tgrelid='public.materials'::regclass AND tgname='lh_retired_material_key' AND tgenabled IN ('O','A')) OR
    NOT EXISTS(SELECT FROM pg_trigger WHERE tgrelid='public.materials'::regclass AND tgname='lh_resolve_material_course' AND tgenabled IN ('O','A')) THEN RAISE EXCEPTION 'Expected material guards missing.'; END IF;
 PERFORM id,email,email_confirmed_at,deleted_at,banned_until FROM auth.users WHERE false;
END $pre$;
CREATE TABLE legalhub_console.upload_alerts (
 material_id uuid PRIMARY KEY, title text NOT NULL, course text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 last_dispatch_at timestamptz, net_request_id bigint, dispatch_failed boolean NOT NULL DEFAULT false
);
CREATE TABLE legalhub_console.upload_alert_targets (
 material_id uuid NOT NULL REFERENCES legalhub_console.upload_alerts(material_id), admin_id uuid NOT NULL,
 outcome text NOT NULL DEFAULT 'waiting' CHECK(outcome IN ('waiting','accepted','revoked')),
 first_attempt_at timestamptz, address_hash bytea, lease uuid, lease_until timestamptz, accepted_at timestamptz, provider_id text,
 PRIMARY KEY(material_id,admin_id)
);
ALTER TABLE legalhub_console.upload_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE legalhub_console.upload_alert_targets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON legalhub_console.upload_alerts,legalhub_console.upload_alert_targets FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION legalhub_console.upload_hook_config(OUT ref text,OUT anon_jwt text,OUT hook_key text) RETURNS record
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,pg_temp AS $$
DECLARE segment text; claims jsonb; BEGIN
 SELECT max(decrypted_secret) FILTER(WHERE name='lh_upload_project_ref'),max(decrypted_secret) FILTER(WHERE name='lh_upload_anon_jwt'),max(decrypted_secret) FILTER(WHERE name='lh_upload_hook_secret')
 INTO ref,anon_jwt,hook_key FROM vault.decrypted_secrets WHERE name IN ('lh_upload_project_ref','lh_upload_anon_jwt','lh_upload_hook_secret');
 IF ref IS NULL OR ref !~ '^[a-z0-9]{20}$' OR hook_key IS NULL OR hook_key !~ '^[a-f0-9]{64}$' OR anon_jwt IS NULL OR anon_jwt !~ '^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' THEN RAISE EXCEPTION 'Review webhook Vault configuration privately.'; END IF;
 BEGIN
  segment:=translate(split_part(anon_jwt,'.',2),'-_','+/'); claims:=convert_from(decode(segment||repeat('=',(4-length(segment)%4)%4),'base64'),'UTF8')::jsonb;
  IF claims->>'role' IS DISTINCT FROM 'anon' OR claims->>'ref' IS DISTINCT FROM ref OR coalesce((claims->>'exp')::bigint,0)<=extract(epoch FROM now()) THEN RAISE EXCEPTION 'Invalid'; END IF;
 EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Use a current legacy anon JWT for the intended project; never a privileged key.'; END;
END $$;
DO $$ BEGIN PERFORM 1 FROM legalhub_console.upload_hook_config(); END $$;
-- Only the public anon JWT and a short-lived signature for this ONE event enter the HTTP queue.
-- HTTPS destination is constructed from the validated project ref, never an uploaded URL.
CREATE FUNCTION legalhub_console.dispatch_upload_alert(p_id uuid) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,pg_temp AS $$
DECLARE cfg record; stamp text; sig text; req bigint; BEGIN
 PERFORM 1 FROM legalhub_console.upload_alerts WHERE material_id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'No captured upload event.'; END IF;
 BEGIN
  SELECT * INTO STRICT cfg FROM legalhub_console.upload_hook_config(); stamp:=floor(extract(epoch FROM clock_timestamp()))::bigint::text;
  sig:=encode(extensions.hmac(convert_to('lh-upload/1'||chr(10)||p_id::text||chr(10)||stamp,'UTF8'),convert_to(cfg.hook_key,'UTF8'),'sha256'),'hex');
  req:=net.http_post(url=>'https://'||cfg.ref||'.supabase.co/functions/v1/notify-admins-on-upload',
    body=>jsonb_build_object('type','INSERT','schema','public','table','materials','record',jsonb_build_object('id',p_id)),
    headers=>jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||cfg.anon_jwt,'X-LH-Time',stamp,'X-LH-Signature',sig),timeout_milliseconds=>30000);
 EXCEPTION WHEN OTHERS THEN req:=NULL; END;
 UPDATE legalhub_console.upload_alerts SET last_dispatch_at=clock_timestamp(),net_request_id=req,dispatch_failed=req IS NULL WHERE material_id=p_id;
 RETURN req;
END $$;
CREATE FUNCTION legalhub_console.material_upload_alert() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,pg_temp AS $$ BEGIN
 INSERT INTO legalhub_console.upload_alerts(material_id,title,course) VALUES(NEW.id,
   left(regexp_replace(coalesce(nullif(btrim(NEW.material_name),''),NEW.file_name,'Material'),'[[:cntrl:]]+',' ','g'),240),
   left(regexp_replace(coalesce(NEW.course,''),'[[:cntrl:]]+',' ','g'),120));
 -- Capture ids, not profile addresses. Future appointments do not inherit the old notification.
 INSERT INTO legalhub_console.upload_alert_targets(material_id,admin_id) SELECT NEW.id,id FROM public.users WHERE is_admin IS TRUE;
 PERFORM legalhub_console.dispatch_upload_alert(NEW.id); RETURN NEW;
END $$;
CREATE TRIGGER lh_material_upload_alert AFTER INSERT ON public.materials FOR EACH ROW
WHEN (NEW.status='pending') EXECUTE FUNCTION legalhub_console.material_upload_alert();
CREATE FUNCTION public.lh_upload_alert_plan(p_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,pg_temp AS $$ BEGIN
 IF NOT EXISTS(SELECT FROM legalhub_console.upload_alerts WHERE material_id=p_id) THEN RETURN NULL; END IF;
 RETURN (SELECT jsonb_build_object('total',count(*),'accepted',count(*) FILTER(WHERE outcome='accepted'),'revoked',count(*) FILTER(WHERE outcome='revoked'),
   'waiting',coalesce(jsonb_agg(admin_id ORDER BY admin_id) FILTER(WHERE outcome='waiting'),'[]'::jsonb)) FROM legalhub_console.upload_alert_targets WHERE material_id=p_id);
END $$;
CREATE FUNCTION public.lh_upload_alert_claim(p_id uuid,p_admin uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,pg_temp AS $$
DECLARE t legalhub_console.upload_alert_targets%ROWTYPE; dest text; fingerprint bytea; token uuid; ts timestamptz:=clock_timestamp(); BEGIN
 SELECT * INTO t FROM legalhub_console.upload_alert_targets WHERE material_id=p_id AND admin_id=p_admin FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','unknown'); END IF;
 IF t.outcome<>'waiting' THEN RETURN jsonb_build_object('state',t.outcome); END IF;
 IF NOT EXISTS(SELECT FROM public.users WHERE id=p_admin AND is_admin IS TRUE) THEN
  UPDATE legalhub_console.upload_alert_targets SET outcome='revoked',lease=NULL,lease_until=NULL WHERE material_id=p_id AND admin_id=p_admin;
  RETURN jsonb_build_object('state','revoked'); END IF;
 SELECT btrim(a.email) INTO dest FROM auth.users a WHERE a.id=p_admin AND a.email_confirmed_at IS NOT NULL AND a.deleted_at IS NULL AND (a.banned_until IS NULL OR a.banned_until<=ts);
 IF dest IS NULL OR dest !~ '^[^[:space:],;<>@]+@[^[:space:],;<>@]+$' THEN RETURN jsonb_build_object('state','recipient_unavailable'); END IF;
 fingerprint:=sha256(convert_to(dest,'UTF8'));
 -- Resend's idempotency window is 24h. Do not resend an ambiguous old attempt or change its address.
 IF t.first_attempt_at<=ts-interval '23 hours' OR (t.address_hash IS NOT NULL AND t.address_hash<>fingerprint) THEN RETURN jsonb_build_object('state','reconcile'); END IF;
 IF t.lease_until>ts THEN RETURN jsonb_build_object('state','busy'); END IF;
 token:=gen_random_uuid();
 UPDATE legalhub_console.upload_alert_targets SET first_attempt_at=coalesce(first_attempt_at,ts),address_hash=fingerprint,lease=token,lease_until=ts+interval '90 seconds' WHERE material_id=p_id AND admin_id=p_admin;
 RETURN (SELECT jsonb_build_object('state','send','lease',token,'address',dest,'title',e.title,'course',e.course) FROM legalhub_console.upload_alerts e WHERE e.material_id=p_id);
END $$;
CREATE FUNCTION public.lh_upload_alert_ack(p_id uuid,p_admin uuid,p_lease uuid,p_provider_id text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,pg_temp AS $$ BEGIN
 IF p_provider_id IS NULL OR p_provider_id !~ '^[A-Za-z0-9_-]{1,160}$' THEN RETURN false; END IF;
 UPDATE legalhub_console.upload_alert_targets SET outcome='accepted',accepted_at=clock_timestamp(),provider_id=p_provider_id,lease=NULL,lease_until=NULL
 WHERE material_id=p_id AND admin_id=p_admin AND lease=p_lease AND outcome='waiting'; RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION legalhub_console.upload_hook_config(),legalhub_console.dispatch_upload_alert(uuid),legalhub_console.material_upload_alert(),
 public.lh_upload_alert_plan(uuid),public.lh_upload_alert_claim(uuid,uuid),public.lh_upload_alert_ack(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lh_upload_alert_plan(uuid),public.lh_upload_alert_claim(uuid,uuid),public.lh_upload_alert_ack(uuid,uuid,uuid,text) TO service_role;
DO $$ BEGIN IF EXISTS(SELECT FROM (VALUES ('anon'::name),('authenticated'::name)) x(r) WHERE has_function_privilege(r,'public.lh_upload_alert_plan(uuid)','EXECUTE') OR has_function_privilege(r,'public.lh_upload_alert_claim(uuid,uuid)','EXECUTE') OR has_function_privilege(r,'public.lh_upload_alert_ack(uuid,uuid,uuid,text)','EXECUTE') OR has_function_privilege(r,'legalhub_console.upload_hook_config()','EXECUTE') OR has_function_privilege(r,'legalhub_console.dispatch_upload_alert(uuid)','EXECUTE')) THEN RAISE EXCEPTION 'Unexpected webhook permissions.'; END IF; END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
SELECT 'UPLOAD WEBHOOK INSTALLED' AS status;
