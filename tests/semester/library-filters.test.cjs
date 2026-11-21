// Execute the actual library script with tiny DOM and read-only service doubles.
'use strict';
const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm');
const web = path.resolve(__dirname, '../../public');
const script = fs.readFileSync(path.join(web, 'scripts/pdfs.js'), 'utf8');
const ids = [
  ...fs.readFileSync(path.join(web, 'pages/pdf.html'), 'utf8').matchAll(/\bid="([\w-]+)"/g),
].map((m) => m[1]);
const turn = () => new Promise((resolve) => setImmediate(resolve));
function element() {
  const events = {},
    classes = new Set();
  return {
    value: '',
    dataset: {},
    style: {},
    attrs: {},
    innerHTML: '',
    textContent: '',
    children: [],
    disabled: false,
    classList: {
      add: (s) => classes.add(s),
      remove: (s) => classes.delete(s),
      contains: (s) => classes.has(s),
      toggle(s, on) {
        on ? classes.add(s) : classes.delete(s);
      },
    },
    setAttribute(k, v) {
      this.attrs[k] = String(v);
    },
    replaceChildren(...nodes) {
      this.children = nodes;
    },
    querySelectorAll: () => [],
    addEventListener(k, f) {
      events[k] = f;
    },
    fire(k) {
      events[k]?.call(this, { target: this, preventDefault() {} });
    },
  };
}
const records = [
  ['Reading & Writing', '200L', 'first'],
  ['Reading & Writing', '200L', 'second'],
  ['Methods', '100L', 'second'],
  ['General', 'relevant', 'all'],
].map(([course, level, semester], i) => ({
  id: String(i + 1),
  course,
  level,
  semester,
  file_name: `book-${i}.pdf`,
  material_name: `Volume ${i + 1}`,
  storage_path: `book-${i}.pdf`,
}));
function open(query, { hold = false, down = false, effective = '400L', profileError = false } = {}) {
  const nodes = new Map(ids.map((k) => [k, element()]));
  const get = (id) => {
    assert(nodes.has(id), 'Missing library element: ' + id);
    return nodes.get(id);
  };
  const document = Object.assign(element(), {
    getElementById: get,
    createElement: element,
    body: element(),
    querySelectorAll: (q) =>
      q === '.filter-chip'
        ? get('filterChips').children
        : q === '.sheet-course-item'
          ? get('mobileCourseList').children
          : [],
  });
  const loc = new URL('https://example.invalid/class/public/pages/pdf.html' + query),
    shared = [];
  const window = Object.assign(element(), { location: loc });
  let release;
  const pause = hold
    ? new Promise((r) => {
        release = r;
      })
    : Promise.resolve();
  const supabaseClient = {
    auth: {
      async getUser() {
        return { data: { user: { id: 'reader' } } };
      },
    },
    async rpc(name, args) {
      assert.equal(name, 'get_effective_level');
      assert.equal(args.p_uid, 'reader');
      await pause;
      return { data: effective, error: profileError ? { message: 'Unavailable' } : null };
    },
    from(name) {
      if (name === 'users')
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          async single() {
            return { data: { is_admin: false } };
          },
        };
      assert.equal(name, 'materials');
      return {
        select() {
          return this;
        },
        async eq(k, v) {
          assert.deepEqual([k, v], ['status', 'approved']);
          return down ? { error: { message: 'offline' }, data: null } : { data: records };
        },
      };
    },
    functions: {
      async invoke(n, { body }) {
        assert.equal(n, 'r2-presign');
        assert.equal(body.action, 'download');
        return { data: { downloadUrl: 'https://files.example.invalid/' + body.key } };
      },
    },
  };
  vm.runInNewContext(script, {
    window,
    document,
    supabaseClient,
    URL,
    URLSearchParams,
    pdfjsLib: { GlobalWorkerOptions: {} },
    navigator: { share: async (x) => shared.push(x.url) },
    console: { log() {}, warn() {} },
    setTimeout,
    clearTimeout,
  });
  return {
    get,
    release: () => release(),
    share: (id) => window.shareMaterial(id, 'Fixture volume'),
    shared,
  };
}
test('Explicit desk/course keeps only its approved matches; approved all-semester general readings are still eligible when All is chosen', async () => {
  const v = open('?level=200L&semester=first&course=Reading%20%26%20Writing');
  await turn();
  const { get } = v;
  assert.equal(get('levelFilter').value, '200L');
  assert.equal(get('semesterFilter').value, 'first');
  assert.equal(get('visibleCount').textContent, 1);
  assert.match(get('bookGrid').innerHTML, /Volume 1/);
  assert.doesNotMatch(get('bookGrid').innerHTML, /Volume 2/);
  for (const id of ['filterChips', 'mobileCourseList'])
    assert.deepEqual(
      get(id).children.map((n) => n.textContent),
      ['All', 'Reading & Writing', 'General'],
    );
  get('mobileCourseList').children[0].fire('click');
  assert.equal(get('visibleCount').textContent, 2);
});
test('An explicit missing course does not silently widen results; a changed scope clears unavailable choices', async () => {
  const { get } = open('?level=300L&semester=second&course=Unlisted%20reader');
  await turn();
  assert.equal(get('visibleCount').textContent, 0);
  assert.match(get('bookGrid').innerHTML, /No books found/);
  assert(
    get('mobileCourseList')
      .children.find((n) => n.dataset.filter === 'Unlisted reader')
      .classList.contains('active'),
  );
  get('levelFilter').value = 'Relevant';
  get('levelFilter').fire('change');
  assert.equal(get('semesterFilter').value, 'all');
  assert(get('semesterFilter').disabled);
  assert.equal(get('visibleCount').textContent, 1);
});
test('Manual reset while profile lookup is pending wins; no-semester, invalid semester, and explicit all remain compatible', async () => {
  const held = open('?level=200L&semester=second&course=Methods', { hold: true });
  await turn();
  assert.equal(held.get('semesterFilter').value, 'second');
  held.get('resetFilters').fire('click');
  held.release();
  await turn();
  assert.equal(held.get('levelFilter').value, 'all');
  assert.equal(held.get('semesterFilter').value, 'all');
  assert.equal(held.get('visibleCount').textContent, records.length);
  for (const [q, lv, t] of [
    ['', '400L', 'first'],
    ['?semester=all', '400L', 'all'],
    ['?level=500L', '500L', 'all'],
    ['?semester=unknown', '400L', 'all'],
    ['?level=all', 'all', 'all'],
    ['?level=Relevant&semester=first', 'Relevant', 'all'],
  ]) {
    const v = open(q);
    await turn();
    assert.equal(v.get('levelFilter').value, lv);
    assert.equal(v.get('semesterFilter').value, t);
  }
});
test('Loading and unavailable library states are not presented as zero matching books', async () => {
  const { get, release } = open('?level=500L&semester=second', { hold: true, down: true });
  await turn();
  assert.equal(get('bookGrid').children[0].textContent, 'Loading approved materials…');
  release();
  await turn();
  assert.match(get('bookGrid').children[0].textContent, /temporarily unavailable/);
  assert.equal(get('semesterFilter').value, 'second');
});
test('A shared material URL stays inside a repository mount and works for a reader with a different default level', async () => {
  const v = open('?level=200L&semester=first');
  await turn();
  await v.share('1');
  const u = new URL(v.shared[0]);
  assert.equal(u.pathname, '/class/public/pages/pdf.html');
  assert.equal(u.searchParams.get('material'), '1');
  assert.equal(u.searchParams.get('level'), 'all');
  const recipient = open(u.search);
  await turn();
  assert.equal(recipient.get('visibleCount').textContent, 1);
  assert.match(recipient.get('bookGrid').innerHTML, /Volume 1/);
});

test('Same 300L profile: unscoped Home opens first; a 500L second-semester desk, all and shared links keep their scopes', async () => {
  for (const [query, level, term] of [
    ['', '300L', 'first'],
    ['?utm_source=home', '300L', 'first'],
    ['?level=500L&semester=second', '500L', 'second'],
    ['?semester=second', '300L', 'second'],
    ['?level=all', 'all', 'all'],
    ['?course=Methods&level=100L', '100L', 'all'],
    ['?material=2', 'all', 'all'],
    ['?level=all&material=2', 'all', 'all'],
    ['?level=Relevant', 'Relevant', 'all'],
  ]) {
    const v = open(query, { effective: '300L' });
    await turn();
    assert.equal(v.get('levelFilter').value, level, query);
    assert.equal(v.get('semesterFilter').value, term, query);
    if (query.includes('material=2')) {
      assert.equal(v.get('visibleCount').textContent, 1);
      assert.match(v.get('bookGrid').innerHTML, /Volume 2/);
    }
  }
});
test('Later replies do not override choosing a semester, level, a course chip or Show all on direct entry', async () => {
  for (const [id, choice, level, term] of [
    ['semesterFilter', 'second', 'all', 'second'],
    ['levelFilter', '200L', '200L', 'all'],
    ['resetFilters', null, 'all', 'all'],
    ['filterChips', null, 'all', 'all'],
  ]) {
    const v = open('', { hold: true, effective: '300L' });
    await turn();
    const el = v.get(id);
    if (choice) {
      el.value = choice;
      el.fire('change');
    } else if (id === 'filterChips') {
      el.children[0].fire('click');
    } else {
      el.fire('click');
    }
    v.release();
    await turn();
    assert.equal(v.get('levelFilter').value, level);
    assert.equal(v.get('semesterFilter').value, term);
  }
});
test('Missing, failed or invalid profile reads never invent a level; approved items and manual filters still work', async () => {
  for (const options of [
    { effective: null },
    { effective: 'unrecognised' },
    { effective: '300L', profileError: true },
  ]) {
    const v = open('', options);
    await turn();
    assert.equal(v.get('levelFilter').value, 'all');
    assert.equal(v.get('semesterFilter').value, 'all');
    assert.equal(v.get('visibleCount').textContent, records.length);
    v.get('levelFilter').value = '200L';
    v.get('levelFilter').fire('change');
    v.get('semesterFilter').value = 'first';
    v.get('semesterFilter').fire('change');
    assert.match(v.get('bookGrid').innerHTML, /Volume 1/);
  }
});
