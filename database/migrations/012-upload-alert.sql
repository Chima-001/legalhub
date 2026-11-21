-- Reconnect the existing notify-admins-on-upload function to ONE materials INSERT webhook.
-- AFTER INSERT captures only. One private worker calls the existing Edge after commit; no pg_net queue.
-- No old materials are scanned, no test webhook is sent and no existing row is edited.
BEGIN;
SET LOCAL search_path = pg_catalog,pg_temp;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE public.materials IN SHARE ROW EXCLUSIVE MODE;
DO $pre$ BEGIN
 IF auth.uid() IS NOT NULL OR to_regprocedure('public.lh_owner_admin_emails(uuid)') IS NULL OR
    NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.materials'::regclass) OR
    to_regprocedure('lh_mail_transport.http(lh_mail_transport.http_request)') IS NULL OR to_regprocedure('cron.schedule(text,text,text)') IS NULL OR to_regprocedure('extensions.hmac(bytea,bytea,text)') IS NULL OR
    to_regclass('vault.decrypted_secrets') IS NULL OR to_regrole('service_role') IS NULL OR
    EXISTS(SELECT FROM (VALUES ('anon'::name),('authenticated'::name)) x(r) WHERE has_schema_privilege(r,'legalhub_console','USAGE,CREATE') OR has_schema_privilege(r,'public','CREATE') OR has_schema_privilege(r,'lh_mail_transport','USAGE,CREATE') OR (has_schema_privilege(r,'cron','USAGE') AND has_function_privilege(r,'cron.schedule(text,text,text)','EXECUTE')) OR has_table_privilege(r,'vault.decrypted_secrets','SELECT')) OR
    EXISTS(SELECT FROM cron.job WHERE jobname='legalhub_upload_dispatch' OR command ILIKE '%notify-admins-on-upload%' OR command ILIKE '%dispatch_upload_alert%') OR
    EXISTS(SELECT FROM pg_trigger WHERE tgrelid='public.materials'::regclass AND NOT tgisinternal AND (tgtype::int & 4)=4 AND tgname NOT IN ('lh_retired_material_key','lh_resolve_material_course')) OR
    EXISTS(SELECT FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('lh_upload_alert_verify','lh_upload_alert_plan','lh_upload_alert_claim','lh_upload_alert_ack')) THEN
   RAISE EXCEPTION 'Stop: verify catalogue, private HTTP/Vault and scheduler, service role and absence of another material-insert webhook. Never double-wire it.';
 END IF;
 IF NOT EXISTS(SELECT FROM pg_trigger WHERE tgrelid='public.materials'::regclass AND tgname='lh_resolve_material_course' AND tgtype::int & 2 = 2 AND tgenabled IN ('O','A')) OR
    (to_regprocedure('public.lh_material_review(uuid,uuid)') IS NOT NULL) IS DISTINCT FROM EXISTS(SELECT FROM pg_trigger WHERE tgrelid='public.materials'::regclass AND tgname='lh_retired_material_key' AND tgenabled IN ('O','A')) THEN RAISE EXCEPTION 'Expected catalogue or optional moderation guard differs.'; END IF;
 IF NOT EXISTS(SELECT FROM vault.decrypted_secrets WHERE name='lh_upload_hook_secret' AND decrypted_secret ~ '^[a-f0-9]{64}$') OR
    NOT EXISTS(SELECT FROM vault.decrypted_secrets WHERE name='lh_upload_project_ref' AND decrypted_secret ~ '^[a-z0-9]{20}$') THEN RAISE EXCEPTION 'Prepare the private signer and project ref before installing.'; END IF;
 PERFORM id,email,email_confirmed_at,deleted_at,banned_until FROM auth.users WHERE false;
END $pre$;
CREATE TABLE legalhub_console.upload_alerts (
 material_id uuid PRIMARY KEY, title text NOT NULL, course text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 last_dispatch_at timestamptz, last_http_status integer, dispatch_failed boolean NOT NULL DEFAULT false,
 attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz DEFAULT now()
);
CREATE TABLE legalhub_console.upload_alert_targets (
 material_id uuid NOT NULL REFERENCES legalhub_console.upload_alerts(material_id), admin_id uuid NOT NULL,
 outcome text NOT NULL DEFAULT 'waiting' CHECK(outcome IN ('waiting','accepted','revoked')),
 first_attempt_at timestamptz, address_hash bytea, lease uuid, lease_until timestamptz, accepted_at timestamptz, provider_id text,
 PRIMARY KEY(material_id,admin_id)
);
CREATE INDEX upload_alert_due ON legalhub_console.upload_alerts(next_attempt_at,created_at) WHERE next_attempt_at IS NOT NULL;
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
-- A legacy anon JWT may be supplied after capture is installed; an invalid existing value is a configuration error.
DO $$ BEGIN IF EXISTS(SELECT FROM vault.decrypted_secrets WHERE name='lh_upload_anon_jwt') THEN PERFORM 1 FROM legalhub_console.upload_hook_config(); END IF; END $$;
-- Transport sees a fixed project URL, an anon gateway JWT and an event-scoped MAC only. No shared HTTP queue.
CREATE FUNCTION legalhub_console.dispatch_upload_alert(p_id uuid) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,pg_temp AS $$
DECLARE cfg record; stamp text; sig text; code integer; tries integer; BEGIN
 SELECT attempts+1 INTO STRICT tries FROM legalhub_console.upload_alerts WHERE material_id=p_id FOR NO KEY UPDATE;
 IF NOT EXISTS(SELECT FROM legalhub_console.upload_alert_targets WHERE material_id=p_id AND outcome='waiting') THEN RETURN NULL; END IF;
 BEGIN
  SELECT * INTO STRICT cfg FROM legalhub_console.upload_hook_config(); stamp:=floor(extract(epoch FROM clock_timestamp()))::bigint::text;
  sig:=encode(extensions.hmac(convert_to('lh-upload/1'||chr(10)||p_id::text||chr(10)||stamp,'UTF8'),convert_to(cfg.hook_key,'UTF8'),'sha256'),'hex');
  PERFORM set_config('http.curlopt_timeout_ms','15000',true),set_config('http.curlopt_connecttimeout_ms','3000',true);
  SELECT r.status INTO code FROM lh_mail_transport.http(ROW('POST','https://'||cfg.ref||'.supabase.co/functions/v1/notify-admins-on-upload',
   ARRAY[ROW('Authorization','Bearer '||cfg.anon_jwt)::lh_mail_transport.http_header,ROW('X-LH-Time',stamp)::lh_mail_transport.http_header,ROW('X-LH-Signature',sig)::lh_mail_transport.http_header],
   'application/json',jsonb_build_object('type','INSERT','schema','public','table','materials','record',jsonb_build_object('id',p_id))::text)::lh_mail_transport.http_request) r;
 EXCEPTION WHEN OTHERS THEN code:=NULL; END;
 UPDATE legalhub_console.upload_alerts SET last_dispatch_at=clock_timestamp(),attempts=tries,last_http_status=code,dispatch_failed=code IS NULL OR code NOT BETWEEN 200 AND 299,
  next_attempt_at=CASE WHEN NOT EXISTS(SELECT FROM legalhub_console.upload_alert_targets WHERE material_id=p_id AND outcome='waiting') OR tries>=12 OR (code BETWEEN 400 AND 499 AND code NOT IN (408,429)) THEN NULL ELSE clock_timestamp()+make_interval(mins=>least(60,(1<<least(tries,6)))) END WHERE material_id=p_id;
 RETURN code;
END $$;
CREATE FUNCTION legalhub_console.dispatch_upload_alerts_due() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,pg_temp AS $$
DECLARE event uuid; n integer:=0; BEGIN
 IF NOT EXISTS(SELECT FROM vault.decrypted_secrets WHERE name='lh_upload_anon_jwt') THEN RETURN 0; END IF;
 FOR event IN SELECT e.material_id FROM legalhub_console.upload_alerts e WHERE e.next_attempt_at<=clock_timestamp() AND EXISTS(SELECT FROM legalhub_console.upload_alert_targets t WHERE t.material_id=e.material_id AND t.outcome='waiting') ORDER BY e.next_attempt_at,e.created_at LIMIT 4 FOR NO KEY UPDATE OF e SKIP LOCKED LOOP
  PERFORM legalhub_console.dispatch_upload_alert(event); n:=n+1;
 END LOOP; RETURN n;
END $$;
CREATE FUNCTION legalhub_console.material_upload_alert() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,pg_temp AS $$ BEGIN
 INSERT INTO legalhub_console.upload_alerts(material_id,title,course) VALUES(NEW.id,
   left(regexp_replace(coalesce(nullif(btrim(NEW.material_name),''),NEW.file_name,'Material'),'[[:cntrl:]]+',' ','g'),240),
   left(regexp_replace(coalesce(NEW.course,''),'[[:cntrl:]]+',' ','g'),120));
 -- Capture ids, not profile addresses. Future appointments do not inherit the old notification.
 INSERT INTO legalhub_console.upload_alert_targets(material_id,admin_id) SELECT NEW.id,id FROM public.users WHERE is_admin IS TRUE;
 RETURN NEW;
END $$;
CREATE TRIGGER lh_material_upload_alert AFTER INSERT ON public.materials FOR EACH ROW
WHEN (NEW.status='pending') EXECUTE FUNCTION legalhub_console.material_upload_alert();
-- The Edge needs no copy of the signing key. This service-only check returns a boolean, never recipients or key material.
CREATE FUNCTION public.lh_upload_alert_verify(p_id uuid,p_stamp text,p_sig text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,pg_temp AS $$
DECLARE k text; age numeric; expected bytea; BEGIN
 IF p_id IS NULL OR p_stamp IS NULL OR p_stamp !~ '^[0-9]{10,11}$' OR p_sig IS NULL OR p_sig !~ '^[a-f0-9]{64}$' THEN RETURN false; END IF;
 age:=extract(epoch FROM clock_timestamp())-p_stamp::bigint;
 IF age < -60 OR age > 600 THEN RETURN false; END IF;
 SELECT decrypted_secret INTO STRICT k FROM vault.decrypted_secrets WHERE name='lh_upload_hook_secret';
 IF k IS NULL OR k !~ '^[a-f0-9]{64}$' THEN RETURN false; END IF;
 expected:=extensions.hmac(convert_to('lh-upload/1'||chr(10)||p_id::text||chr(10)||p_stamp,'UTF8'),convert_to(k,'UTF8'),'sha256');
 RETURN sha256(expected)=sha256(decode(p_sig,'hex')) AND EXISTS(SELECT FROM legalhub_console.upload_alerts WHERE material_id=p_id);
END $$;
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
REVOKE ALL ON FUNCTION legalhub_console.upload_hook_config(),legalhub_console.dispatch_upload_alert(uuid),legalhub_console.dispatch_upload_alerts_due(),legalhub_console.material_upload_alert(),
 public.lh_upload_alert_verify(uuid,text,text),public.lh_upload_alert_plan(uuid),public.lh_upload_alert_claim(uuid,uuid),public.lh_upload_alert_ack(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lh_upload_alert_verify(uuid,text,text),public.lh_upload_alert_plan(uuid),public.lh_upload_alert_claim(uuid,uuid),public.lh_upload_alert_ack(uuid,uuid,uuid,text) TO service_role;
DO $$ BEGIN IF EXISTS(SELECT FROM (VALUES ('anon'::name),('authenticated'::name)) x(r) WHERE has_function_privilege(r,'public.lh_upload_alert_verify(uuid,text,text)','EXECUTE') OR has_function_privilege(r,'public.lh_upload_alert_plan(uuid)','EXECUTE') OR has_function_privilege(r,'public.lh_upload_alert_claim(uuid,uuid)','EXECUTE') OR has_function_privilege(r,'public.lh_upload_alert_ack(uuid,uuid,uuid,text)','EXECUTE') OR has_function_privilege(r,'legalhub_console.upload_hook_config()','EXECUTE') OR has_function_privilege(r,'legalhub_console.dispatch_upload_alert(uuid)','EXECUTE') OR has_function_privilege(r,'legalhub_console.dispatch_upload_alerts_due()','EXECUTE')) THEN RAISE EXCEPTION 'Unexpected webhook permissions.'; END IF; END $$;
SELECT cron.schedule('legalhub_upload_dispatch','* * * * *','SELECT legalhub_console.dispatch_upload_alerts_due()');
NOTIFY pgrst,'reload schema';
COMMIT;
SELECT 'UPLOAD WEBHOOK INSTALLED' AS status;
