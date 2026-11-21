// Exercise the same direct writes the published site makes, under real PostgreSQL policies. No object/storage requests.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { materialFixture, uid } from './release-fixture.mjs';
const { db, as, query, scalar, add } = await materialFixture();
const denied = (p) => assert.rejects(p, (e) => e.code === '42501');
const status = await readFile(
  new URL('../../database/checks/material-review-status.sql', import.meta.url),
  'utf8',
);
try {
  assert.equal(await scalar(status), 'MATERIALS YES/NO DATABASE READY');
  await add(1, 'Law notes');
  await add(2, 'Law notes');
  const id = uid(101);
  await as(3);
  await add(3, 'My upload');
  await denied(add(4, 'Cannot publish', undefined, 'approved'));
  const approve = () =>
    query("UPDATE public.materials SET status='approved' WHERE id=$1 AND status='pending' RETURNING id", [
      id,
    ]);
  assert.deepEqual(await approve(), []);
  await denied(query('DELETE FROM public.materials WHERE id=$1', [id]));
  assert.deepEqual(await query('SELECT id FROM public.materials WHERE id=$1', [id]), []);
  await as(0, 'anon');
  await denied(approve());
  await as(1);
  assert.deepEqual(
    await query(
      "UPDATE public.materials SET material_name='Revised law notes' WHERE id=$1 AND material_name='Law notes' AND status='pending' RETURNING id",
      [id],
    ),
    [{ id }],
  );
  assert.deepEqual(
    await query(
      "UPDATE public.materials SET material_name='stale' WHERE id=$1 AND material_name='Law notes' AND status='pending' RETURNING id",
      [id],
    ),
    [],
  );
  assert.deepEqual(await approve(), [{ id }]);
  assert.deepEqual(await approve(), []);
  await denied(query('DELETE FROM public.materials WHERE id=$1', [id]));
  await as(3);
  assert.deepEqual(await query("SELECT id FROM public.materials WHERE status='approved'"), [{ id }]);
  await as(0);
  await query('UPDATE public.users SET is_admin=false WHERE id=$1', [uid(2)]);
  await as(2);
  assert.deepEqual(
    await query("UPDATE public.materials SET status='approved' WHERE id=$1 RETURNING id", [uid(102)]),
    [],
  );
  await as(0);
  assert.equal(await scalar('SELECT status FROM public.materials WHERE id=$1', [uid(102)]), 'pending');
  await db.exec('CREATE POLICY fixture_drift ON public.materials FOR UPDATE TO authenticated USING (true)');
  assert.equal(await scalar(status), 'STOP: REVIEW MATERIAL SCHEMA');
  console.log(
    'PASS current admin edit/approval, 0-row stale/refused writes, same-title neighbour, upload and approved reads; no browser DELETE or 011; metadata flags an additional write policy.',
  );
} finally {
  await db.close();
}
