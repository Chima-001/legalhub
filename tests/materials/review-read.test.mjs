// No DOM or backend is supplied: none of these refusals may reach a confirmation dialog or a mutation.
import assert from 'node:assert/strict';
import test from 'node:test';
import { reviewMaterial } from '../../public/scripts/materials/review.mjs';
const actor = 'fixture-admin',
  item = { id: 'fixture-item' };
for (const [code, pattern] of [
  ['PGRST202', /not available on this server yet/],
  ['42883', /not available on this server yet/],
  ['42501', /did not authorize/],
  ['40001', /no longer available/],
  ['offline', /Check the connection/],
]) {
  test(
    'review preflight ' + code + ': actionable refusal, no direct update or storage operation',
    async () => {
      const calls = [];
      const client = {
        auth: { getUser: async () => ({ data: { user: { id: actor } } }) },
        rpc: async (name, args) => {
          calls.push([name, args]);
          return { error: { code } };
        },
      };
      for (const action of ['approve', 'reject'])
        await assert.rejects(reviewMaterial(client, { actor, item, action }), pattern);
      assert.deepEqual(calls, Array(2).fill(['lh_material_review', { p_actor: actor, p_id: item.id }]));
    },
  );
}
