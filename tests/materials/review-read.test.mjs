import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewMaterial } from '../../public/scripts/materials/review.mjs';
const row = {
  id: 'selected',
  status: 'pending',
  material_name: 'Notes <one>',
  file_name: 'one.pdf',
  storage_path: 'materials/u/one.pdf',
  level: '200L',
  semester: 'first',
  course: 'Law',
};
function fixture(flags = {}) {
  const state = { ...row, ...flags.start };
  const events = [];
  let n = 0;
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: flags.switch && ++n > 1 ? 'other' : 'admin' } } }) },
    functions: {
      invoke: async (name, { body }) => {
        events.push(['edge', name, body]);
        return flags.edgeFailure ? { data: null, error: {} } : { data: { deleted: true } };
      },
    },
    from(table) {
      const filters = {};
      let edit;
      return {
        select() {
          return this;
        },
        update(v) {
          edit = v;
          return this;
        },
        eq(k, v) {
          filters[k] = v;
          return this;
        },
        is(k, v) {
          filters[k] = v;
          return this;
        },
        async maybeSingle() {
          if (table === 'users') return { data: { id: 'admin', is_admin: !flags.revoked } };
          if (!edit) return { data: flags.missing ? null : { ...state, uploaded_by: 'u', ...flags.drift } };
          events.push(['update', edit, filters]);
          return { data: flags.zero ? null : { id: row.id } };
        },
        async limit() {
          return { data: flags.shared ? [row, { id: 'other' }] : [row] };
        },
      };
    },
  };
  return {
    events,
    run: (action, ok = true, values) =>
      reviewMaterial(client, { actor: 'admin', item: state, action, values }, async (o) => {
        assert(o.details);
        return ok;
      }),
  };
}
for (const [name, action, start] of [
  ['approve', 'approve', {}],
  ['pending rejection', 'reject', {}],
  ['approved Library deletion', 'delete', { status: 'approved' }],
])
  test(name + ' uses Yes/No and the existing contract', async () => {
    const f = fixture({ start });
    assert.equal(await f.run(action, false), false);
    assert.deepEqual(f.events, []);
    assert.equal(await f.run(action), true);
    if (action === 'approve') {
      assert.deepEqual(f.events[0], ['update', { status: 'approved' }, { ...row }]);
    } else
      assert.deepEqual(f.events, [
        ['edge', 'r2-presign', { action: 'reject', key: row.storage_path, materialId: row.id }],
      ]);
  });
for (const [flag, expected] of [
  [{ revoked: true }, /administrator/],
  [{ drift: { status: 'approved' } }, /changed/],
  [{ shared: true }, /unique PDF/],
  [{ drift: { uploaded_by: 'other-uploader' } }, /file path/],
  [{ switch: true }, /account changed/],
])
  test('no destructive call on ' + Object.keys(flag)[0], async () => {
    const f = fixture(flag);
    await assert.rejects(f.run('reject'), expected);
    assert.deepEqual(f.events, []);
  });
test('uncertain removal and zero-row update never report success or send a second request', async () => {
  const r = fixture({ edgeFailure: true });
  await assert.rejects(r.run('reject'), /not confirmed/);
  assert.equal(r.events.length, 1);
  const a = fixture({ zero: true });
  await assert.rejects(a.run('approve'), /not confirmed/);
  assert.equal(a.events.length, 1);
});
test('edit sends only four display fields and keeps the status pending', async () => {
  const f = fixture();
  const v = {
    material_name: 'Revised',
    level: '200L',
    semester: 'first',
    course: 'Law',
    status: 'approved',
    storage_path: 'no',
  };
  assert.equal(await f.run('edit', true, v), true);
  assert.deepEqual(f.events[0][1], {
    material_name: 'Revised',
    level: '200L',
    semester: 'first',
    course: 'Law',
  });
});
