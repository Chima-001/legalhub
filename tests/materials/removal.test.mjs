// Contract edge cases beyond the UI happy path. Never invoke a real signer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewMaterial } from '../../public/scripts/materials/review.mjs';
const item = {
  id: 'selected',
  status: 'approved',
  file_name: 'Notes.pdf',
  storage_path: 'materials/sample/notes.pdf',
  uploaded_by: 'sample',
};
function client(call) {
  let byId, table;
  const q = {
    select() {
      return this;
    },
    eq(k, v) {
      if (k === 'id') byId = v;
      return this;
    },
    maybeSingle() {
      return { data: table === 'users' ? { id: byId, is_admin: true } : item };
    },
    limit() {
      return { data: [item] };
    },
  };
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'admin' } } }) },
    from(t) {
      table = t;
      return q;
    },
    functions: { invoke: call },
  };
}
const req = { actor: 'admin', item, action: 'delete' };
test('double click cannot open two confirmations or issue two removals', async () => {
  let yes,
    count = 0;
  const c = client(async () => {
    count++;
    return { data: { deleted: true } };
  });
  const first = reviewMaterial(c, req, () => new Promise((resolve) => (yes = resolve)));
  assert.equal(await reviewMaterial(c, req, () => assert.fail()), false);
  yes(true);
  assert.equal(await first, true);
  assert.equal(count, 1);
});
for (const [name, result] of [
  ['empty success', { data: {} }],
  ['error alongside data', { data: { deleted: true }, error: { message: 'uncertain' } }],
  ['obsolete receipt', { data: { removed: true, fileRemoved: true } }],
])
  test(name + ' is not a confirmed ID/key deletion', async () => {
    let count = 0;
    const c = client(async () => {
      count++;
      return result;
    });
    await assert.rejects(
      reviewMaterial(c, req, async () => true),
      /not confirmed/,
    );
    assert.equal(count, 1);
  });
test('pending/approved actions are not interchangeable', async () => {
  for (const [action, status] of [
    ['reject', 'approved'],
    ['delete', 'pending'],
    ['approve', 'approved'],
  ])
    await assert.rejects(
      reviewMaterial(
        client(() => assert.fail()),
        { ...req, action, item: { ...item, status } },
        () => assert.fail(),
      ),
      /current material/,
    );
});
