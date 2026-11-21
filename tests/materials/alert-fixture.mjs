// Real PostgreSQL/HMAC; the Vault and pg_net interfaces below are local fixtures. No outbound requests.
import { PGlite } from '../auth/node_modules/@electric-sql/pglite/dist/index.js';
import { pgcrypto } from '../auth/node_modules/@electric-sql/pglite/dist/contrib/pgcrypto.js';
import { materialFixture, sqlFile, uid } from './release-fixture.mjs';
import { handleUploadAlert } from '../../supabase/functions/notify-admins-on-upload/handler.mjs';
export { uid };
export async function alertFixture(install = true) {
  const f = await materialFixture(new PGlite({ extensions: { pgcrypto } }));
  const { db, query, scalar, as, service } = f;
  await db.exec(`CREATE SCHEMA vault;CREATE SCHEMA lh_mail_transport;CREATE SCHEMA cron;CREATE SCHEMA extensions;CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
 CREATE TABLE vault.decrypted_secrets(name text primary key,decrypted_secret text NOT NULL);CREATE TABLE lh_mail_transport.fake_requests(id bigint GENERATED ALWAYS AS IDENTITY,url text,body jsonb,headers jsonb);
 CREATE TABLE cron.job(jobname text unique, schedule text, command text);
 CREATE FUNCTION cron.schedule(text,text,text) RETURNS bigint LANGUAGE plpgsql AS $$ BEGIN INSERT INTO cron.job VALUES($1,$2,$3);RETURN 1;END$$;
 CREATE TYPE lh_mail_transport.http_header AS (field text,value text);
 CREATE TYPE lh_mail_transport.http_request AS (method text,uri text,headers lh_mail_transport.http_header[],content_type text,content text);
 CREATE TYPE lh_mail_transport.http_response AS (status integer,content_type text,headers lh_mail_transport.http_header[],content text);
 CREATE FUNCTION lh_mail_transport.http(req lh_mail_transport.http_request) RETURNS lh_mail_transport.http_response LANGUAGE plpgsql AS $$ BEGIN
 IF current_setting('test.net_error',true)='yes' THEN RAISE EXCEPTION 'Fake private transport unavailable'; END IF;
 INSERT INTO lh_mail_transport.fake_requests(url,body,headers) VALUES(req.uri,req.content::jsonb,(SELECT jsonb_object_agg(h.field,h.value) FROM unnest(req.headers) h)||jsonb_build_object('Content-Type',req.content_type)); RETURN ROW(coalesce(nullif(current_setting('test.http_status',true),''),'200')::int,'application/json',NULL,'{}')::lh_mail_transport.http_response; END $$;`);
  const ref = 'a'.repeat(20),
    hook = 'c'.repeat(64),
    jwt = [
      'e30',
      Buffer.from(JSON.stringify({ role: 'anon', ref, exp: 4102444800 })).toString('base64url'),
      'fixture',
    ].join('.');
  for (const [k, v] of [
    ['lh_upload_project_ref', ref],
    ['lh_upload_anon_jwt', jwt],
    ['lh_upload_hook_secret', hook],
  ])
    await query('insert into vault.decrypted_secrets values($1,$2)', [k, v]);
  const installAlert = async () => {
    await as(0);
    await db.exec(await sqlFile('012-upload-alert.sql'));
  };
  if (install) await installAlert();
  const env = {
    RESEND_API_KEY: 'local-only',
    RESEND_FROM: 'Fixture <sender@example.test>',
  };
  const calls = new Map(
    Object.entries({
      lh_upload_alert_verify: ['p_id', 'p_stamp', 'p_sig'],
      lh_upload_alert_plan: ['p_id'],
      lh_upload_alert_claim: ['p_id', 'p_admin'],
      lh_upload_alert_ack: ['p_id', 'p_admin', 'p_lease', 'p_provider_id'],
    }),
  );
  const rpc = async (name, args) => {
    if (!calls.has(name)) throw Error('Unknown fixture alert RPC');
    const keys = calls.get(name);
    try {
      await service();
      return {
        data: await scalar(
          `SELECT public.${name}(${keys.map((_, i) => '$' + (i + 1)).join(',')})`,
          keys.map((k) => args[k]),
        ),
        error: null,
      };
    } catch (e) {
      return { data: null, error: { code: e.code } };
    }
  };
  const retry = async (id) => {
    await as(0);
    return scalar('SELECT legalhub_console.dispatch_upload_alert($1)', [id]);
  };
  const record = async (id) => {
    await as(0);
    return (
      await query(
        "SELECT url,body,headers FROM lh_mail_transport.fake_requests WHERE body->'record'->>'id'=$1 ORDER BY id DESC LIMIT 1",
        [id],
      )
    )[0];
  };
  const sendEvent = async (event, send, overrides = {}) => {
    if (!send) throw Error('A fake sender is required');
    const req = new Request(event.url, {
      method: 'POST',
      headers: event.headers,
      body: JSON.stringify(event.body),
    });
    return handleUploadAlert(req, { env: (n) => env[n], rpc, send, ...overrides });
  };
  const tick = async () => {
    await as(0);
    return scalar('SELECT legalhub_console.dispatch_upload_alerts_due()');
  };
  return { ...f, tick, installAlert, env, rpc, retry, record, sendEvent };
}
