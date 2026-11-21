import assert from 'node:assert/strict';
import { alertFixture, uid } from './alert-fixture.mjs';
const f = await alertFixture(false);
const { db, as, query, scalar, add } = f;
const title = 'Evidence & Proof <Notes>';
const id = (n) => uid(n + 100);
const provider = [];
const ids = new Map();
let rejectTo = null;
const fake = async (url, opt) => {
  assert.equal(url, 'https://api.resend.com/emails');
  const b = JSON.parse(opt.body);
  assert.deepEqual(Object.keys(b).sort(), ['from', 'subject', 'text', 'to']);
  assert.equal(b.to.length, 1);
  assert.match(b.to[0], /^reader\d+@example\.test$/);
  const key = opt.headers['Idempotency-Key'];
  provider.push({ to: b.to[0], key, body: b });
  if (b.to[0] === rejectTo) return Response.json({ id: 'do-not-count-http-failure' }, { status: 429 });
  if (!ids.has(key)) ids.set(key, 'fixture-' + (ids.size + 1));
  return Response.json({ id: ids.get(key) });
};
const count = async (table) => {
  await as(0);
  return scalar('SELECT count(*)::int FROM ' + table);
};
const expire = async (n) => {
  await as(0);
  await query(
    "update legalhub_console.upload_alert_targets set lease_until=now()-interval '1 minute' where material_id=$1",
    [id(n)],
  );
};
try {
  await add(1, 'Predates installation');
  await db.exec(
    `CREATE FUNCTION public.fixture_hook() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NEW;END$$;CREATE TRIGGER fixture_existing AFTER INSERT ON public.materials FOR EACH ROW EXECUTE FUNCTION public.fixture_hook()`,
  );
  await assert.rejects(f.installAlert(), /double-wire/);
  await db.exec('ROLLBACK;DROP TRIGGER fixture_existing ON public.materials');
  await f.installAlert();
  assert.equal(await count('legalhub_console.upload_alerts'), 0);
  assert.equal(await count('net.fake_requests'), 0);
  await as(3);
  await assert.rejects(
    scalar('select public.lh_upload_alert_plan($1)', [id(1)]),
    (e) => e.code === '42501',
  );
  await assert.rejects(
    query('select * from legalhub_console.upload_alert_targets'),
    (e) => e.code === '42501',
  );
  await assert.rejects(
    query('select * from legalhub_console.upload_hook_config()'),
    (e) => e.code === '42501',
  );
  await as(0);
  await db.exec('BEGIN');
  await add(2);
  await db.exec('ROLLBACK');
  assert.equal(await count('net.fake_requests'), 0);
  await as(3);
  await add(3, title);
  const event = await f.record(id(3));
  assert.equal(event.body.record.id, id(3));
  assert.deepEqual(Object.keys(event.body.record), ['id']);
  assert(!JSON.stringify(event.headers).includes(f.env.UPLOAD_WEBHOOK_SECRET));
  assert.equal(await count('legalhub_console.upload_alert_targets'), 2);
  await as(0);
  await query("update public.materials set status='approved' where id=$1", [id(3)]);
  assert.equal(await count('net.fake_requests'), 1);
  console.log(
    'PASS single INSERT hook, no replay/backfill at install, rollback cancels request, no extra approval event, server-only recipients and signer.',
  );
  let touched = 0;
  const nope = () => {
    touched++;
    throw Error('must not access privileged operation');
  };
  for (const [change, code] of [
    [{ headers: { ...event.headers, 'X-LH-Signature': '0'.repeat(64) } }, 403],
    [{ body: { ...event.body, type: 'UPDATE' } }, 400],
    [{ body: { ...event.body, table: 'users' } }, 400],
    [{ body: { ...event.body, record: { id: id(1) } } }, 403],
    [{ headers: { ...event.headers, 'X-LH-Time': '1000000000' } }, 403],
  ]) {
    assert.equal((await f.sendEvent({ ...event, ...change }, nope, { rpc: nope })).status, code);
  }
  assert.equal(
    (
      await f.sendEvent(event, nope, {
        env: (n) => (n === 'RESEND_FROM' ? undefined : f.env[n]),
        rpc: nope,
      })
    ).status,
    503,
  );
  assert.equal(touched, 0);
  assert.equal(
    (await f.sendEvent(event, nope, { rpc: async () => ({ data: null, error: {} }) })).status,
    503,
  );
  assert.equal(touched, 0);
  console.log(
    'PASS wrong origin/event/id/time, missing sender and database failure are not mail success.',
  );
  rejectTo = 'reader2@example.test';
  let resp = await f.sendEvent(event, fake);
  assert.equal(resp.status, 502);
  assert.deepEqual(await resp.json(), {
    accepted: 1,
    pending: 1,
    noLongerAdmin: 0,
    reason: 'Provider acceptance not confirmed',
  });
  assert.equal(ids.size, 1);
  assert.equal(provider[0].body.subject, 'New LegalHub upload: ' + title);
  rejectTo = null;
  await expire(3);
  await f.retry(id(3));
  resp = await f.sendEvent(await f.record(id(3)), fake);
  assert.equal(resp.status, 200);
  assert.deepEqual(await resp.json(), { accepted: 2, pending: 0, noLongerAdmin: 0 });
  assert.equal(ids.size, 2);
  assert.equal(provider.filter((p) => p.to === 'reader1@example.test').length, 1);
  const n = provider.length;
  assert.equal((await f.sendEvent(event, fake)).status, 200);
  assert.equal(provider.length, n);
  console.log(
    'PASS per-current-admin addresses, plain text/title, HTTP rejection ≠ notified, partial retry only for unaccepted recipient, durable duplicate suppression.',
  );
  await as(0);
  await db.exec("SELECT set_config('test.net_error','yes',false)");
  await as(3);
  await add(4, 'Dispatch failure');
  await as(0);
  assert.equal(
    await scalar('select dispatch_failed from legalhub_console.upload_alerts where material_id=$1', [
      id(4),
    ]),
    true,
  );
  assert.equal(await f.record(id(4)), undefined);
  await db.exec("SELECT set_config('test.net_error','no',false)");
  await f.retry(id(4));
  await query('update public.users set is_admin=false where id=$1', [uid(2)]);
  let ackLost = true;
  const loseAck = async (name, args) => {
    if (name === 'lh_upload_alert_ack' && ackLost) {
      ackLost = false;
      return { error: { code: 'fake' } };
    }
    return f.rpc(name, args);
  };
  resp = await f.sendEvent(await f.record(id(4)), fake, { rpc: loseAck });
  assert.equal(resp.status, 502);
  const received = ids.size;
  await expire(4);
  resp = await f.sendEvent(await f.record(id(4)), fake);
  assert.equal(resp.status, 200);
  assert.equal((await resp.json()).noLongerAdmin, 1);
  assert.equal(ids.size, received);
  assert.equal(provider.at(-1).key, provider.at(-2).key);
  await as(3);
  await add(5, 'Ambiguous receipt');
  resp = await f.sendEvent(await f.record(id(5)), async () => Response.json({}));
  assert.equal(resp.status, 502);
  await as(0);
  await query(
    "UPDATE legalhub_console.upload_alert_targets SET first_attempt_at=now()-interval '25 hours',lease_until=now()-interval '1 minute' WHERE material_id=$1",
    [id(5)],
  );
  resp = await f.sendEvent(await f.record(id(5)), nope);
  assert.equal(resp.status, 409);
  assert.equal(touched, 0);
  await as(0);
  await query('update auth.users set email_confirmed_at=null where id=$1', [uid(1)]);
  await as(3);
  await add(6, 'No verified address');
  assert.equal((await f.sendEvent(await f.record(id(6)), nope)).status, 409);
  assert.equal(touched, 0);
  // No-admin condition without changing the fixture owner's protected role.
  await as(3);
  await add(7);
  await as(0);
  await query('DELETE FROM legalhub_console.upload_alert_targets WHERE material_id=$1', [id(7)]);
  assert.equal((await f.sendEvent(await f.record(id(7)), nope)).status, 503);
  assert.equal(touched, 0);
  console.log(
    'PASS broken dispatch recoverable, demotion checked, ambiguous acknowledgement reuses provider key, unsafe late retry and empty/unverified recipients do not claim success.',
  );
} finally {
  await db.close();
}
