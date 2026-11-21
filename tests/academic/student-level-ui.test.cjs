// Execute the committed Profile controller, no project client or DOM network.
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  vm = require('node:vm'),
  path = require('node:path');
const src = fs.readFileSync(
  path.join(__dirname, '../../public/scripts/academic/profile-level.js'),
  'utf8',
);
const turn = () => new Promise((r) => setImmediate(r));
function fixture(missing) {
  const nodes = new Map(),
    calls = [];
  let account = 'student',
    level = '200L',
    authChange;
  function el(id) {
    if (!nodes.has(id))
      nodes.set(id, {
        listeners: {},
        value: '',
        disabled: false,
        hidden: false,
        textContent: '',
        focus() {},
        addEventListener(t, f) {
          this.listeners[t] = f;
        },
        fire(t) {
          return this.listeners[t]?.();
        },
      });
    return nodes.get(id);
  }
  const api = {
    auth: {
      getUser: async () => ({ data: { user: account ? { id: account } : null } }),
      onAuthStateChange(f) {
        authChange = f;
      },
    },
    rpc: async (n, p) => {
      calls.push([n, p]);
      if (n === 'get_my_level_context')
        return missing
          ? { error: { code: 'PGRST202' } }
          : { data: { account_id: account, assignment_year: 2026, level } };
      if (n === 'get_effective_level') return { data: level };
      if (n === 'set_my_academic_level') {
        if (p.p_expected_uid !== account) return { error: {} };
        level = p.p_level;
        return { data: level };
      }
      throw Error('Unexpected call');
    },
  };
  vm.runInNewContext(src, { document: { getElementById: el }, supabaseClient: api, setTimeout });
  return {
    el,
    calls,
    change: (id) => {
      account = id;
    },
    out: () => authChange('SIGNED_OUT', null),
  };
}
test('Old service is readable but never gets an unchecked write', async () => {
  const { el, calls } = fixture(true);
  await turn();
  assert.match(el('level-session-hint').textContent, /until the site enables/);
  assert.equal(el('display-level').textContent, '200L');
  assert(el('level-select').disabled);
  await el('save-level-btn').fire('click');
  await el('level-apply').fire('click');
  assert(!calls.some(([n]) => n === 'set_my_academic_level'));
});
test('Student chooses a tier for the displayed session; typed save and account recheck are required', async () => {
  const { el, calls, change, out } = fixture(false);
  await turn();
  assert(!el('level-select').disabled);
  assert.equal(el('level-session-hint').textContent, 'Choose your current level for the 2026/2027 session.');
  el('level-select').value = '400L';
  await el('level-select').fire('change');
  await el('save-level-btn').fire('click');
  el('level-confirm').value = 'yes';
  await el('level-confirm').fire('input');
  assert(el('level-apply').disabled);
  await el('level-cancel').fire('click');
  assert(el('level-review').hidden);
  await el('save-level-btn').fire('click');
  el('level-confirm').value = el('level-phrase').textContent;
  await el('level-confirm').fire('input');
  await el('level-apply').fire('click');
  assert.equal(el('display-level').textContent, '400L');
  assert.equal(calls.filter(([n]) => n === 'set_my_academic_level').length, 1);
  await el('save-level-btn').fire('click');
  el('level-confirm').value = el('level-phrase').textContent;
  await el('level-confirm').fire('input');
  change('other');
  await el('level-apply').fire('click');
  assert.equal(calls.filter(([n]) => n === 'set_my_academic_level').length, 1);
  out();
  assert(el('level-select').disabled);
  assert(el('level-review').hidden);
});
