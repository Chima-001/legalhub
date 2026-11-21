import assert from 'node:assert/strict';
import { materialFixture, uid } from './release-fixture.mjs';
const f = await materialFixture();
const { db, as, query, scalar, add, key, service, review, change, remove } = f;
const denied = (p) => assert.rejects(p, (e) => e.code === '42501');
try {
  await add(1, 'Draft');
  await add(2, 'Shared');
  await add(3, 'Other', key(2));
  await add(4, 'Legacy', 'old/unchecked.pdf');
  const before = await query('select * from public.materials order by id');
  await f.install();
  assert.deepEqual(await query('select * from public.materials order by id'), before);
  await as(3);
  await add(5, 'New');
  await denied(review(5, 3));
  await denied(change(5, '0', 'approve', 'i approve New', null, 3));
  await denied(query("UPDATE public.materials SET status='approved'"));
  await denied(remove(5, '0', 'reject', 'i reject New'));
  await denied(query('select * from legalhub_console.material_removals'));
  await as(0, 'anon');
  await denied(review(1));
  await as(1);
  await denied(review(1, 2));
  await denied(query("UPDATE public.materials SET status='approved'"));
  await denied(remove(1, '0', 'reject', 'i reject Draft'));
  console.log(
    'PASS existing rows unchanged, pending upload preserved, browser cannot bypass review or access private cleanup.',
  );
  let snap = await review(1);
  assert.equal(snap.title, 'Draft');
  const changes = {
    material_name: 'Revised notes',
    level: '100L',
    semester: 'second',
    course: 'Legal Method',
  };
  await assert.rejects(change(1, snap.version, 'edit', 'i edit Revised notes', changes));
  await assert.rejects(
    change(1, snap.version, 'edit', 'i edit Draft', { ...changes, course: 'Unknown' }),
  );
  await assert.rejects(
    change(1, snap.version, 'edit', 'i edit Draft', { ...changes, storage_path: 'different' }),
  );
  assert.equal(await change(1, snap.version, 'edit', 'i edit Draft', changes), true);
  await assert.rejects(change(1, snap.version, 'approve', 'i approve Draft'), (e) => e.code === '40001');
  snap = await review(1);
  await as(0);
  await query('UPDATE public.users SET is_admin=false WHERE id=$1', [uid(2)]);
  await as(2);
  await denied(change(1, snap.version, 'approve', 'i approve Revised notes', null, 2));
  await as(1);
  assert.equal(await change(1, snap.version, 'approve', 'i approve Revised notes'), true);
  snap = await review(1);
  assert.equal(snap.status, 'approved');
  console.log(
    'PASS current admin, exact original title, scope and fields, actor and concurrent version verified for edit/approval.',
  );
  const shared = await review(2),
    legacy = await review(4),
    pending = await review(5);
  await service();
  await denied(remove(1, snap.version, 'delete', 'i delete Revised notes', 2));
  await assert.rejects(remove(1, snap.version, 'reject', 'i reject Revised notes'));
  await assert.rejects(remove(1, '0', 'delete', 'i delete Revised notes'));
  await assert.rejects(remove(1, snap.version, 'delete', 'yes'));
  await assert.rejects(remove(2, shared.version, 'reject', 'i reject Shared'), (e) => e.code === '23503');
  await assert.rejects(remove(4, legacy.version, 'reject', 'i reject Legacy'), (e) => e.code === '23503');
  // Exercise a late FK refusal: the claim rolls back too; no storage operation is possible without a committed ticket.
  await as(0);
  await db.exec(
    'CREATE TABLE keep_material(ref uuid references public.materials(id) ON DELETE RESTRICT)',
  );
  await query('INSERT INTO keep_material VALUES($1)', [uid(101)]);
  await service();
  await assert.rejects(
    remove(1, snap.version, 'delete', 'i delete Revised notes'),
    (e) => e.code === '23503',
  );
  await as(0);
  assert.equal(await scalar('select count(*)::int from legalhub_console.material_removals'), 0);
  await db.exec('DROP TABLE keep_material');
  await service();
  const t = await remove(1, snap.version, 'delete', 'i delete Revised notes');
  assert.deepEqual(t, { key: key(1), done: false });
  assert.deepEqual(await remove(1, snap.version, 'delete', 'i delete Revised notes'), t);
  await as(3);
  await assert.rejects(add(6, 'Reuse', key(1)), (e) => e.code === '23503');
  await service();
  assert.equal(await scalar('SELECT public.lh_material_file_done($1,$2)', [uid(101), key(2)]), false);
  assert.equal(await scalar('SELECT public.lh_material_file_done($1,$2)', [uid(101), key(1)]), true);
  assert.equal((await remove(1, snap.version, 'delete', 'i delete Revised notes')).done, true);
  assert.equal((await remove(5, pending.version, 'reject', 'i reject New')).key, key(5));
  console.log(
    'PASS pending rejection vs approved deletion; shared/unverified/ref-linked file refusal, atomic unlink, exact retry, retired key protection.',
  );
} finally {
  await db.close();
}
