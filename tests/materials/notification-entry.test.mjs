import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const entry = createRequire(import.meta.url)('../../tools/build-notification-entry.cjs');
function boot() {
  let respond,
    verified = true,
    saved = false;
  const traffic = [],
    warnings = [];
  const endpoint = 'https://project.example.test',
    serviceKey = 'fixture-service',
    token = 'fixture-sender';
  const env = {
    SUPABASE_URL: endpoint,
    SUPABASE_SERVICE_ROLE_KEY: serviceKey,
    RESEND_API_KEY: token,
    RESEND_FROM: 'noreply@example.test',
  };
  const id = '00000000-0000-4000-8000-000000000001',
    admin = '00000000-0000-4000-8000-000000000002';
  const lease = '00000000-0000-4000-8000-000000000003';
  const api = async (url, opt) => {
    traffic.push(url);
    assert.equal(opt.redirect, 'error');
    assert.equal(opt.method, 'POST');
    if (url === 'https://api.resend.com/emails') {
      assert.equal(opt.headers.Authorization, 'Bearer ' + token);
      assert.equal(opt.headers.apikey, undefined);
      const body = JSON.parse(opt.body);
      assert.equal(body.from, 'LegalHub <noreply@example.test>');
      assert(body.html.includes('href="https://legalhub-io.netlify.app/pages/materials.html"'));
      assert(body.text.includes('https://legalhub-io.netlify.app/pages/materials.html'));
      assert(!body.html.includes('Bearer'));
      assert.equal(opt.headers['Idempotency-Key'], 'lh-upload/' + id + '/' + admin);
      return Response.json({ id: 'fixture-receipt' });
    }
    assert.equal(new URL(url).origin, endpoint);
    assert.equal(opt.headers.Authorization, 'Bearer ' + serviceKey);
    assert.equal(opt.headers.apikey, serviceKey);
    const name = new URL(url).pathname.replace('/rest/v1/rpc/', ''),
      args = JSON.parse(opt.body);
    assert.equal(args.p_id, id);
    if (name === 'lh_upload_alert_verify') return Response.json(verified);
    if (name === 'lh_upload_alert_plan')
      return Response.json({ total: 1, accepted: saved ? 1 : 0, revoked: 0, waiting: saved ? [] : [admin] });
    if (name === 'lh_upload_alert_claim')
      return Response.json({ state: 'send', address: 'reader@example.test', title: 'Fixture', lease });
    assert.equal(name, 'lh_upload_alert_ack');
    assert.equal(args.p_provider_id, 'fixture-receipt');
    saved = true;
    return Response.json(true);
  };
  vm.runInNewContext(entry.replace(/^export /gm, ''), {
    Deno: {
      serve: (fn) => {
        respond = fn;
      },
      env: { get: (n) => env[n] },
    },
    console: { warn: (...v) => warnings.push(v) },
    fetch: api,
    Response,
    Request,
    Date,
    TextDecoder,
    URL,
    AbortSignal,
    Uint8Array,
  });
  const submit = () =>
    respond(
      new Request(endpoint + '/functions/v1/notify-admins-on-upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-LH-Time': String(Math.floor(Date.now() / 1000)),
          'X-LH-Signature': 'a'.repeat(64),
        },
        body: JSON.stringify({ type: 'INSERT', schema: 'public', table: 'materials', record: { id } }),
      }),
    );
  return {
    respond,
    submit,
    traffic,
    env,
    warnings,
    refuse: () => {
      verified = false;
    },
  };
}
test('exact standalone deployment boots without any external import; GET cannot read a secret, call a service or send', async () => {
  const f = boot();
  for (const k of Object.keys(f.env)) delete f.env[k];
  const r = await f.respond(new Request('https://fixture.invalid/'));
  assert.equal(r.status, 405);
  assert.deepEqual(await r.json(), { error: 'POST required' });
  assert.deepEqual(f.traffic, []);
});
test('one-file entry uses the existing verified RPC flow; provider key and service credential never cross origins', async () => {
  const f = boot();
  let r = await f.submit();
  assert.equal(r.status, 200);
  assert.equal((await r.json()).accepted, 1);
  r = await f.submit();
  assert.equal(r.status, 200);
  assert.equal(f.traffic.filter((x) => x === 'https://api.resend.com/emails').length, 1);
  const blocked = boot();
  blocked.refuse();
  r = await blocked.submit();
  assert.equal(r.status, 403);
  assert.equal(blocked.traffic.length, 1);
  assert.deepEqual(blocked.warnings, []);
});

test('bare domains and header injection are refused before claiming a recipient', async () => {
  for (const address of ['example.test', 'a@example.test\r\nBcc: x@example.test', 'onboarding@resend.dev']) {
    const f = boot();
    f.env.RESEND_FROM = address;
    assert.equal((await f.submit()).status, 503);
    assert.equal(f.traffic.length, 1);
  }
});
