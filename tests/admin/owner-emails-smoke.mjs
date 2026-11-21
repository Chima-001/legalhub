// Disposable PostgreSQL with synthetic members only. No connection string, network or real identities.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { catalogFixture, uid } from './catalog-fixture.mjs';
const { db, as, query, scalar, rpc, calls } = await catalogFixture();
const sql = await readFile(
  new URL('../../database/migrations/010-owner-admin-emails.sql', import.meta.url),
  'utf8',
);
calls.lh_owner_admin_emails = ['p_actor'];
const emails = (n) => rpc('lh_owner_admin_emails', { p_actor: n ? uid(n) : null });
const cap = () => rpc('lh_admin_capabilities');
const mail = (n) => `reader${n}@example.test`;
async function toggle(actor, address) {
  await as(actor);
  const t = await rpc('lh_review_admin', { p_actor: uid(actor), p_email: address });
  assert.equal(
    await rpc('lh_change_admin', {
      p_actor: uid(actor),
      p_target: t.id,
      p_email: t.email,
      p_grant: !t.is_admin,
      p_version: t.version,
      p_confirmation: (t.is_admin ? 'revoke ' : 'grant ') + t.email,
    }),
    true,
  );
}
const denied = (p) => assert.rejects(p, (e) => e.code === '42501');
const pass = (s) => console.log('PASS:', s);
try {
  await query('INSERT INTO legalhub_console.role_managers(user_id) VALUES ($1)', [uid(2)]);
  await toggle(1, mail(3));
  await toggle(1, mail(6));
  await toggle(2, mail(6));
  await toggle(2, mail(6)); // latest grant isn't the owner's
  await toggle(2, mail(4)); // never the owner's
  await as(0);
  await query('UPDATE public.users SET username=$2 WHERE id=$1', [uid(3), 'Changed display name']);
  for (const n of [7, 8]) {
    await query('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())', [
      uid(n),
      mail(n),
    ]);
    await query('INSERT INTO public.users(id,is_admin) VALUES($1,false)', [uid(n)]);
    await toggle(1, mail(n));
    await toggle(1, mail(n));
    await as(0);
  }
  // 7 remains revoked. 8 has ambiguous historical ordering; do not guess the actor by UUID order.
  await toggle(1, mail(8));
  await as(0);
  await query("UPDATE legalhub_console.changes SET at=timestamptz '2040-01-01' WHERE subject_id=$1", [
    uid(8),
  ]);
  const rolesBefore = await query('SELECT id,is_admin FROM public.users ORDER BY id');
  const auditBefore = await query('SELECT * FROM legalhub_console.changes ORDER BY id');
  await db.exec(
    'CREATE FUNCTION public.lh_owner_admin_emails(text) RETURNS text LANGUAGE sql AS $$SELECT $1$$',
  );
  await assert.rejects(db.exec(sql), /already present/);
  await db.exec('ROLLBACK');
  assert.equal(await scalar("SELECT to_regclass('legalhub_console.owner_appointments') IS NULL"), true);
  await db.exec('DROP FUNCTION public.lh_owner_admin_emails(text)');
  const install = await db.exec(sql);
  assert.deepEqual(install.at(-1).rows, [{ status: 'OWNER LIST READY' }]);
  assert.deepEqual(await query('SELECT id,is_admin FROM public.users ORDER BY id'), rolesBefore);
  assert.deepEqual(await query('SELECT * FROM legalhub_console.changes ORDER BY id'), auditBefore);
  await assert.rejects(db.exec(sql));
  await db.exec('ROLLBACK');
  await as(1);
  assert.deepEqual(await cap(), { admin: true, roles: true, owner: true });
  assert.deepEqual(await emails(1), [mail(3)]);
  await denied(emails(2));
  await denied(emails(0));
  pass(
    'Installation imports only current grants last recorded for this owner, not all admins or old superseded grants; no role or historical audit changes, collision/reinstall refused.',
  );
  for (const [n, r, expected] of [
    [2, 'authenticated', [true, true]],
    [3, 'authenticated', [true, false]],
    [5, 'authenticated', [false, false]],
    [0, 'authenticated', [false, false]],
    [0, 'anon', null],
  ]) {
    await as(n, r);
    if (expected)
      assert.deepEqual(await cap(), { admin: expected[0], roles: expected[1], owner: false });
    for (const arg of [n, 1, 0]) await denied(emails(arg));
    await denied(query('SELECT * FROM legalhub_console.owner_appointments'));
    await denied(query('SELECT * FROM legalhub_console.changes'));
  }
  pass(
    'Direct RPC denied to delegate, ordinary admin, member, anonymous and missing identity, even when declaring the owner UUID. Private tables are not readable.',
  );
  await toggle(1, mail(6));
  await toggle(1, mail(6)); // fresh owner grant after a delegate's grant
  await as(1);
  assert.deepEqual(await emails(1), [mail(3), mail(6)]);
  await as(0);
  await query('UPDATE auth.users SET email=$2 WHERE id=$1', [uid(6), 'AA.New@example.test']);
  await as(1);
  assert.deepEqual(await emails(1), ['aa.new@example.test', mail(3)]);
  await as(0);
  await query("UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id=$1", [uid(6)]);
  await as(1);
  assert.deepEqual(await emails(1), [mail(3)]);
  await as(0);
  await query('UPDATE auth.users SET banned_until=NULL,email_confirmed_at=NULL WHERE id=$1', [uid(6)]);
  await as(1);
  assert.deepEqual(await emails(1), [mail(3)]);
  await as(0);
  await query('UPDATE auth.users SET email_confirmed_at=now(),deleted_at=now() WHERE id=$1', [uid(6)]);
  await as(1);
  assert.deepEqual(await emails(1), [mail(3)]);
  await toggle(2, mail(3));
  await as(1);
  assert.deepEqual(await emails(1), []);
  await toggle(2, mail(3));
  await as(1);
  assert.deepEqual(await emails(1), []);
  pass(
    'Sorted email strings only; uses current confirmed Auth email, not profile email; excludes inactive targets, revokes and grants made by a different manager.',
  );
  await toggle(1, mail(3));
  await toggle(1, mail(3));
  assert.deepEqual(await emails(1), [mail(3)]);
  await as(0);
  await query('UPDATE public.users SET is_admin=false WHERE reg_number=$1', ['FIX-REG-3']);
  await query('UPDATE public.users SET is_admin=true WHERE reg_number=$1', ['FIX-REG-3']);
  await as(1);
  assert.deepEqual(await emails(1), []);
  await toggle(1, mail(3));
  await toggle(1, mail(3));
  assert.deepEqual(await emails(1), [mail(3)]);
  await as(0);
  await query('DELETE FROM auth.users WHERE id=$1', [uid(3)]);
  await as(1);
  assert.deepEqual(await emails(1), []);
  await as(0);
  await query('UPDATE public.users SET is_admin=false WHERE reg_number=$1', ['FIX-REG-1']);
  await as(1);
  await denied(emails(1));
  assert.deepEqual(await cap(), { admin: false, roles: false, owner: false });
  await as(0);
  await query('UPDATE public.users SET is_admin=true WHERE reg_number=$1', ['FIX-REG-1']);
  await as(1);
  assert.deepEqual(await emails(1), []);
  pass(
    'SQL recovery still works and does not resurrect old attribution; deleted identity is removed, owner needs current admin status, successful empty read returns [].',
  );
} finally {
  await db.close();
}
