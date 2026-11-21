import test from 'node:test';
import assert from 'node:assert/strict';
import { removeReviewed } from '../../supabase/functions/r2-presign/removal.mjs';
const actor = 'a0000000-0000-4000-8000-000000000001',
  id = 'a0000000-0000-4000-8000-000000000042';
const body = {
  actor,
  action: 'remove-reviewed',
  materialId: id,
  operation: 'reject',
  version: '41',
  confirmation: 'i reject Notes',
};
function harness(fail) {
  let unlinked = false,
    done = false;
  const calls = [];
  const deps = {
    rpc: async (name, p) => {
      calls.push(name);
      if (name === 'lh_material_remove') {
        assert.deepEqual(p, {
          p_actor: actor,
          p_id: id,
          p_action: 'reject',
          p_version: '41',
          p_phrase: 'i reject Notes',
        });
        if (fail === 'denied') return { error: { code: '42501' } };
        unlinked = true;
        return { data: { key: 'fixture/storage.pdf', done } };
      }
      if (name === 'lh_material_file_done') {
        assert.equal(p.p_key, 'fixture/storage.pdf');
        if (fail === 'receipt') {
          fail = null;
          return { error: {} };
        }
        done = true;
        return { data: true };
      }
      throw Error('Unexpected call');
    },
    removeObject: async (key) => {
      assert(unlinked);
      assert.equal(key, 'fixture/storage.pdf');
      calls.push('R2');
      if (fail === 'R2') {
        fail = null;
        throw Error('fake storage unavailable');
      }
    },
  };
  return { deps, calls };
}
test('Changed account or browser key is not authority', async () => {
  const h = harness();
  for (const b of [
    { ...body, actor: 'other' },
    { ...body, key: 'anything' },
    { ...body, version: '' },
    { ...body, operation: 'approve' },
  ])
    assert((await removeReviewed(b, actor, h.deps))[0] >= 400);
  assert.equal(h.calls.length, 0);
});
test('No storage side effect without a reviewed, committed removal', async () => {
  const h = harness('denied');
  assert.equal((await removeReviewed(body, actor, h.deps))[0], 403);
  assert.deepEqual(h.calls, ['lh_material_remove']);
});
for (const failure of ['R2', 'receipt'])
  test('Unlinked item is not called fully deleted after ' + failure + ' failure', async () => {
    const h = harness(failure);
    const res = await removeReviewed(body, actor, h.deps);
    assert.equal(res[0], 202);
    assert.equal(res[1].fileRemoved, false);
    assert.equal(res[1].cleanupPending, true);
    assert.deepEqual(await removeReviewed(body, actor, h.deps), [
      200,
      { removed: true, fileRemoved: true },
    ]);
    const n = h.calls.filter((s) => s === 'R2').length;
    await removeReviewed(body, actor, h.deps);
    assert.equal(h.calls.filter((s) => s === 'R2').length, n);
  });
