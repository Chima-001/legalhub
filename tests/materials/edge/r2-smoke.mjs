// Run only in Deno with the fixture import map and NO net or production credentials. No real R2 request.
import assert from 'node:assert/strict';
import { S3Client, DeleteObjectCommand } from 'npm:@aws-sdk/client-s3@3.1175.0';
for (const [name, value] of Object.entries({
  SUPABASE_URL: 'https://fixture.invalid',
  SUPABASE_ANON_KEY: 'fixture-anon',
  SUPABASE_SERVICE_ROLE_KEY: 'fixture-service',
  R2_ACCOUNT_ID: 'fixture-account',
  R2_BUCKET_NAME: 'fixture-bucket',
  R2_ACCESS_KEY_ID: 'fixture-access',
  R2_SECRET_ACCESS_KEY: 'fixture-secret',
}))
  Deno.env.set(name, value);
const f = (globalThis.fixture = {
  actor: '00000000-0000-4000-8000-000000000003',
  material: '00000000-0000-4000-8000-000000000021',
  uploader: 'fixture',
  key: 'materials/fixture/sample.pdf',
  status: 'pending',
  admin: false,
  verified: false,
  trace: [],
});
let handle;
const listen = Deno.serve,
  send = S3Client.prototype.send;
try {
  Deno.serve = (fn) => {
    handle = fn;
  };
  S3Client.prototype.send = async function (cmd) {
    assert(cmd instanceof DeleteObjectCommand);
    assert.deepEqual(cmd.input, { Bucket: 'fixture-bucket', Key: f.key });
    f.trace.push('object');
    if (f.storeError) throw Error('simulated storage failure');
    return {};
  };
  await import('../../../supabase/functions/r2-presign/index.ts');
  const request = (method, body, auth = true) =>
    handle(
      new Request('https://fixture.invalid/functions/v1/r2-presign', {
        method,
        headers: { Authorization: auth ? 'Bearer fixture-session' : '', 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    );
  let r = await request('GET');
  assert.equal(r.status, 405);
  assert.equal(r.headers.get('X-LegalHub-Storage-Contract'), 'material-id-key-v1');
  assert.equal((await request('OPTIONS')).status, 200);
  assert.equal((await request('POST', { action: 'upload' }, false)).status, 401);
  r = await request('POST', { action: 'upload', fileName: 'my notes.pdf', contentType: 'application/pdf' });
  assert.equal(r.status, 200);
  const put = await r.json(),
    u = new URL(put.uploadUrl);
  assert(put.key.startsWith('materials/' + f.actor + '/'));
  assert(put.key.endsWith('_my_notes.pdf'));
  assert.equal(u.searchParams.get('X-Amz-Expires'), '300');
  assert(u.searchParams.has('X-Amz-Signature'));
  assert.equal(u.hostname, 'fixture-bucket.fixture-account.r2.cloudflarestorage.com');
  assert.equal((await request('POST', { action: 'download', key: f.key })).status, 403);
  f.status = 'approved';
  r = await request('POST', { action: 'download', key: f.key });
  assert.equal(r.status, 200);
  assert.equal(new URL((await r.json()).downloadUrl).searchParams.get('X-Amz-Expires'), '3600');
  f.status = 'pending';
  f.admin = true;
  assert.equal((await request('POST', { action: 'download', key: f.key })).status, 200);
  assert.equal((await request('POST', { action: 'reject' })).status, 400);
  assert.deepEqual(f.trace, []);
  const remove = { action: 'reject', key: f.key, materialId: f.material };
  assert.equal((await request('POST', { ...remove, materialId: 'different' })).status, 404);
  f.admin = false;
  assert.equal((await request('POST', remove)).status, 403);
  f.admin = true;
  f.shared = true;
  assert.equal((await request('POST', remove)).status, 409);
  assert.deepEqual(f.trace, []);
  f.shared = false;
  f.uploader = 'different-uploader';
  assert.equal((await request('POST', remove)).status, 409);
  f.uploader = 'fixture';
  assert.equal((await request('POST', { ...remove, key: 'not-this-pdf' })).status, 404);
  assert.equal((await request('POST', remove, false)).status, 401);
  assert.deepEqual(f.trace, []);
  f.storeError = true;
  assert.equal((await request('POST', remove)).status, 500);
  assert.deepEqual(f.trace, ['object']);
  f.trace = [];
  f.storeError = false;
  f.zeroRow = true;
  const incomplete = await request('POST', remove);
  assert.equal(incomplete.status, 500);
  assert.notEqual((await incomplete.json()).deleted, true);
  assert.deepEqual(f.trace, ['object', 'row']);
  f.zeroRow = false;
  for (const state of ['pending', 'approved']) {
    f.status = state;
    f.trace = [];
    const r = await request('POST', remove);
    assert.equal(r.status, 200);
    assert.equal((await r.json()).deleted, true);
    assert.deepEqual(f.trace, ['object', 'row']);
  }
  console.log(
    'PASS actual repository R2 entry: upload/download signatures and access, valid admin ID/key removal for pending and approved items, stale/shared/unauthorized refusal. No network or real objects.',
  );
} finally {
  Deno.serve = listen;
  S3Client.prototype.send = send;
  delete globalThis.fixture;
}
