// Existing upload capture with ordinary Materials policies, synthetic Vault/transport/provider only. Never use a hosted project here.
import assert from 'node:assert/strict';
import { alertFixture, uid } from './alert-fixture.mjs';
const f = await alertFixture(false);
const { db, query, scalar, as, add, record, installAlert } = f;
try {
  const [{ decrypted_secret: anon }] = await query(
    "DELETE FROM vault.decrypted_secrets WHERE name='lh_upload_anon_jwt' RETURNING decrypted_secret",
  );
  await installAlert();
  assert.equal(await f.tick(), 0);
  assert.equal(await scalar("select to_regprocedure('public.lh_material_review(uuid,uuid)') is null"), true);
  await as(3);
  await add(21, 'Waiting for gateway');
  const id = uid(121);
  await as(0);
  assert.equal(
    await scalar('select attempts from legalhub_console.upload_alerts where material_id=$1', [id]),
    0,
  );
  assert.equal(await record(id), undefined);
  assert.equal(
    await scalar('select count(*)::int from legalhub_console.upload_alert_targets where material_id=$1', [
      id,
    ]),
    2,
  );
  console.log(
    'PASS capture with 011 absent and no gateway key: upload completes, private receipt/targets retained, no request sent.',
  );
  await query("insert into vault.decrypted_secrets values('lh_upload_anon_jwt',$1)", [anon]);
  assert.equal(await record(id), undefined);
  // Both the old and updated admin controls can publish via RLS; this must not create another upload event.
  await as(1);
  assert.deepEqual(
    await query("UPDATE public.materials SET status='approved' WHERE id=$1 RETURNING id", [id]),
    [{ id }],
  );
  await as(0);
  assert.equal(
    await scalar(
      "select count(*)::int from pg_trigger where tgrelid='public.materials'::regclass and not tgisinternal and (tgtype::int & 4)=4 and (tgtype::int & 2)=0",
    ),
    1,
  );
  await as(3);
  await add(22, 'First configured upload');
  const id2 = uid(122);
  assert.equal(await record(id2), undefined);
  assert.equal(await f.tick(), 2);
  const event = await record(id2);
  assert(event);
  assert(await record(id));
  assert.equal(await f.tick(), 0); // bounded backoff; no repeated rapid retries
  const args = { p_id: id2, p_stamp: event.headers['X-LH-Time'], p_sig: event.headers['X-LH-Signature'] };
  assert.equal((await f.rpc('lh_upload_alert_verify', args)).data, true);
  for (const r of ['anon', 'authenticated']) {
    await as(0);
    await db.exec('SET ROLE ' + r);
    await assert.rejects(
      scalar('select public.lh_upload_alert_verify($1,$2,$3)', Object.values(args)),
      (e) => e.code === '42501',
    );
  }
  await as(0);
  assert.equal(
    await scalar('select public.lh_upload_alert_verify($1,$2,$3)', [id, args.p_stamp, args.p_sig]),
    false,
  );
  for (const from of [undefined, 'onboarding@resend.dev', 'LegalHub <onboarding@resend.dev>']) {
    const resp = await f.sendEvent(event, () => assert.fail('no mail for missing or testing sender'), {
      env: (n) => (n === 'RESEND_FROM' ? from : f.env[n]),
    });
    assert.equal(resp.status, 503);
  }
  await as(0);
  assert.equal(
    await scalar(
      'select count(*)::int from legalhub_console.upload_alert_targets where first_attempt_at is not null',
    ),
    0,
  );
  console.log(
    'PASS later gateway configuration drains captured uploads; approval produces no alert, without duplicate jobs or hooks; SQL verifies signed ID and time, web roles cannot verify, absent/testing sender is never acceptance.',
  );
} finally {
  await db.close();
}
