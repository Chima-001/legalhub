// No project URL: runs the actual migration against disposable PostgreSQL.
import assert from 'node:assert/strict';
import { fixture, uid } from './fixture.mjs';
const { db, sql, bind, as, scalar, query, rpc } = await fixture();
const review = (i, email) => rpc('lh_review_admin', { p_actor: uid(i), p_email: email });
const change = (i, t, extra = {}) =>
  rpc('lh_change_admin', {
    p_actor: uid(i),
    p_target: t.id,
    p_email: t.email,
    p_grant: !t.is_admin,
    p_version: t.version,
    p_confirmation: (t.is_admin ? 'revoke ' : 'grant ') + t.email,
    ...extra,
  });
const passed = (s) => console.log('PASS:', s);
try {
  for (const setup of [
    async () => {},
    () => bind(1, 'wrong'),
    () => bind(1, 'FIX-REG-1', 'other@example.test'),
    () => bind(3),
  ]) {
    await setup();
    await assert.rejects(db.exec(sql), /owner|Owner/);
    await db.exec('ROLLBACK');
    assert.equal(await scalar("SELECT to_regnamespace('legalhub_console') IS NULL"), true);
  }
  await bind();
  await db.exec('GRANT UPDATE(is_admin) ON public.users TO authenticated');
  await assert.rejects(db.exec(sql), /permissions/);
  await db.exec('ROLLBACK; REVOKE UPDATE(is_admin) ON public.users FROM authenticated');
  const before = await query('SELECT * FROM public.users ORDER BY id');
  await db.exec(sql);
  assert.deepEqual(await query('SELECT * FROM public.users ORDER BY id'), before);
  assert.equal(await scalar('SELECT user_id FROM legalhub_console.owner_identity'), uid(1));
  passed(
    'Atomic refusal of missing/wrong/non-admin owner and ACL drift; install pins one verified existing owner without appointing anyone.',
  );
  await as(0, 'anon');
  await assert.rejects(rpc('lh_admin_capabilities'));
  await as(3);
  assert.deepEqual(await rpc('lh_admin_capabilities'), { admin: false, roles: false });
  await assert.rejects(review(3, 'reader4@example.test'));
  await as(2);
  assert.deepEqual(await rpc('lh_admin_capabilities'), { admin: true, roles: false });
  await assert.rejects(review(2, 'reader4@example.test'));
  await assert.rejects(query('SELECT * FROM legalhub_console.owner_identity'));
  await assert.rejects(review(1, 'reader4@example.test'));
  await as(1);
  assert.deepEqual(await rpc('lh_admin_capabilities'), { admin: true, roles: true });
  for (const x of [
    'reader1@example.test',
    'reader5@example.test',
    'profile3@example.test',
    'reader%@example.test',
  ])
    await assert.rejects(review(1, x));
  let t = await review(1, ' READER3@example.test ');
  await assert.rejects(change(1, t, { p_confirmation: 'yes' }));
  await assert.rejects(change(1, t, { p_target: uid(4) }));
  assert.equal(await change(1, t), true);
  await assert.rejects(change(1, t), /changed/);
  await as(3);
  assert.deepEqual(await rpc('lh_admin_capabilities'), { admin: true, roles: false });
  passed(
    'No ordinary delegation or directory; exact reviewed confirmed email, identity, current role and phrase.',
  );
  await as(1);
  t = await review(1, 'reader3@example.test');
  await as(0);
  await query('INSERT INTO legalhub_console.role_managers(user_id) VALUES($1)', [uid(3)]);
  await as(1);
  await assert.rejects(change(1, t), /changed/);
  await as(3);
  await assert.rejects(review(3, 'reader1@example.test'), /owner/);
  await assert.rejects(review(3, 'reader3@example.test'), /own account/);
  await as(1);
  t = await review(1, 'reader3@example.test');
  assert.equal(t.delegates, true);
  assert.equal(await change(1, t), true);
  await as(3);
  await assert.rejects(review(3, 'reader2@example.test'));
  await as(1);
  assert.equal(await change(1, await review(1, 'reader3@example.test')), true);
  await as(3);
  assert.deepEqual(await rpc('lh_admin_capabilities'), { admin: true, roles: false });
  passed(
    'A second delegate cannot revoke owner; owner can demote that delegate. Regranting admin never restores delegation.',
  );
  await as(1);
  t = await review(1, 'reader4@example.test');
  await as(0);
  await query('UPDATE auth.users SET email=$1 WHERE id=$2', ['changed@example.test', uid(4)]);
  await as(1);
  await assert.rejects(change(1, t));
  await as(0);
  await query("SELECT set_config('test.viewer',$1,false)", [uid(2)]);
  await assert.rejects(query('UPDATE public.users SET is_admin=false WHERE id=$1', [uid(1)]), /owner/);
  await assert.rejects(
    query("UPDATE public.users SET reg_number='replaced' WHERE id=$1", [uid(1)]),
    /operator/,
  );
  await assert.rejects(query('DELETE FROM auth.users WHERE id=$1', [uid(1)]), /foreign key/);
  await assert.rejects(query('DELETE FROM public.users WHERE id=$1', [uid(1)]), /foreign key/);
  await assert.rejects(
    query('UPDATE public.users SET is_admin=false WHERE id=$1', [uid(2)]),
    /reviewed role/,
  );
  await as(0);
  await query('UPDATE public.users SET is_admin=false WHERE reg_number=$1', ['FIX-REG-1']);
  assert.equal(await scalar('SELECT is_admin FROM public.users WHERE id=$1', [uid(1)]), false);
  await query('UPDATE public.users SET is_admin=true WHERE reg_number=$1', ['FIX-REG-1']);
  assert.equal(await scalar('SELECT count(*)::int FROM legalhub_console.role_intent'), 0);
  assert.equal(await scalar('SELECT count(*)::int FROM legalhub_console.changes'), 3);
  assert.equal(await scalar('SELECT count(*)::int FROM public.users'), 6);
  passed(
    'Changed email refused; legacy web transitions and owner removal blocked, deliberate private SQL recovery still works, audit and membership preserved.',
  );
} finally {
  await db.close();
}
