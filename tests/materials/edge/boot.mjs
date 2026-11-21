// Test boot of the *unmapped* reviewed R2 entry and its actual SDK imports. No production settings or network.
// The separate r2-smoke uses a fake database and intercepted object IO to exercise signing/removal behavior.
import assert from 'node:assert/strict';
const serve = Deno.serve;
let handler;
try {
  Deno.serve = (fn) => {
    handler = fn;
  };
  for (const [key, value] of Object.entries({
    R2_ACCOUNT_ID: 'fixture',
    R2_BUCKET_NAME: 'fixture',
    R2_ACCESS_KEY_ID: 'test',
    R2_SECRET_ACCESS_KEY: 'test',
    SUPABASE_URL: 'https://fixture.invalid',
    SUPABASE_ANON_KEY: 'fixture',
    SUPABASE_SERVICE_ROLE_KEY: 'fixture',
  }))
    Deno.env.set(key, value);
  await import('../../../supabase/functions/r2-presign/index.ts');
  const r = await handler(new Request('https://fixture.invalid/functions/v1/r2-presign'));
  assert.equal(r.status, 405);
  assert.equal(r.headers.get('X-LegalHub-Storage-Contract'), 'reviewed-removal-v1');
  console.log(
    'PASS actual R2 dependency graph boots offline and GET returns the reviewed contract; no signature, RPC, network or object operation.',
  );
} finally {
  Deno.serve = serve;
}
