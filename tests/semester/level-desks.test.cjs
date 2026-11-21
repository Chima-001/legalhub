// Exercise the same routes, manifest and lazy provider as the browser. No installs, network or SQL.
'use strict';
const { test } = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path');
const root = path.resolve(__dirname, '../..'),
  pub = path.join(root, 'public'),
  pages = path.join(pub, 'pages');
const read = (f) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
const html = read(path.join(pages, 'semester.html')),
  home = read(path.join(pub, 'index.html'));
const dir = path.join(pub, 'data/semester-desks'),
  data = (f) => JSON.parse(read(path.join(dir, f)));
const model = import('../../public/scripts/academic/desk-data.mjs');
const study = { level: '100L', semester: 'second' };

test('One real desk, four inert native component templates and no numbered semester pages', () => {
  assert.deepEqual(
    fs.readdirSync(pages).filter((n) => /^[1-5]00l-(first|second)-semester\.html$/.test(n)),
    [],
  );
  assert.equal([...html.matchAll(/<template\b/g)].length, 4);
  assert(!html.includes('Legal Method'));
  assert(!html.includes('{{'));
  assert(html.includes('id="semester-desk"'));
  const order = [
    '@supabase/supabase-js@2',
    '../scripts/auth/supabase-client.js',
    '../scripts/avatar.js',
    '../scripts/auth/auth-guard.js',
    '<body>',
    '../scripts/dashboard.js',
    '../scripts/academic/semester-desk.mjs',
  ];
  let prev = -1;
  for (const s of order) {
    const i = html.indexOf(s);
    assert(i > prev, s);
    prev = i;
  }
  assert.match(html, /body\s*\{\s*visibility:\s*hidden/);
  assert(!fs.existsSync(path.join(root, 'tools/generate-level-desks.cjs')));
});
test('Switch level is a normal Home#levels link; the desk has no level chooser', () => {
  const link = html.match(/<a\b[^>]*class="level-switch"[^>]*href="([^"]+)"[^>]*>Switch level/);
  assert(link, 'Expected the original Switch level button link');
  assert.doesNotMatch(html, /<select\b|role="combobox"|id="desk-level"/i);
  assert.match(home, /<section\b[^>]*id="levels"/);
  for (const mount of ['/', '/public/', '/school/legalhub/public/']) {
    const base = 'https://desk.example' + mount;
    const from = base + 'pages/semester.html?level=300L&semester=first';
    assert.equal(new URL(link[1], from).href, base + 'index.html#levels');
  }
});
test('Public navigation and hosting files do not point at a retired numbered desk', () => {
  const retired = /[1-5]00l-(?:first|second)-semester\b/i;
  function audit(dir) {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, f.name);
      if (f.isDirectory()) audit(file);
      else if (f.isFile() && (/\.(?:html?|[cm]?js|css|json|xml|webmanifest|toml)$/i.test(f.name) || f.name === '_redirects'))
        assert.doesNotMatch(read(file), retired, path.relative(root, file));
    }
  }
  audit(pub);
  for (const name of ['netlify.toml', '_redirects']) {
    const f = path.join(root, name);
    if (fs.existsSync(f)) assert.doesNotMatch(read(f), retired, name);
  }
});
test('Ten ordinary home links target one pathname at the site root and a subfolder mount', async () => {
  const { LEVELS, TERMS, selection, deskHref } = await model,
    links = [...home.matchAll(/<a class="desk-choice"[^>]* href="([^"]+)"/g)].map((m) =>
      m[1].replaceAll('&amp;', '&'),
    );
  assert.equal(links.length, 10);
  for (const mount of ['/', '/legalhub/public/']) {
    const urls = links.map((h) => new URL(h, 'https://local.example' + mount + 'index.html'));
    assert.deepEqual([...new Set(urls.map((u) => u.pathname))], [mount + 'pages/semester.html']);
    assert.deepEqual(
      urls.map((u) => selection(u.search)),
      LEVELS.flatMap((level) => TERMS.map((semester) => ({ level, semester }))),
    );
    for (const u of urls) assert.equal(new URL(deskHref(selection(u.search)), u.href).href, u.href);
  }
});
test('Bare, incomplete, ambiguous or unrecognised selections are not silently replaced with 100L', async () => {
  const { selection, createSource } = await model;
  for (const q of [
    '',
    '?level=300L',
    '?semester=second',
    '?level=600L&semester=first',
    '?level=100L&semester=summer',
    '?level=100L&level=300L&semester=second',
  ])
    assert.equal(selection(q), null);
  assert.deepEqual(selection('?level=100l&semester=SECOND'), study);
  let reads = 0;
  const load = createSource(() => {
    reads++;
  });
  await assert.rejects(load(null));
  assert.equal(reads, 0);
});
test('The published inventory is explicit. Only published desks have/need course files', async () => {
  const { readIndex, readTerm, LEVELS } = await model,
    index = readIndex(data('index.json')),
    expected = ['index.json'];
  for (const level of LEVELS)
    for (const semester of index[level].published) {
      const file = `${level.toLowerCase()}-${semester}.json`;
      expected.push(file);
      const desk = readTerm(data(file), { level, semester });
      assert(desk.courses.length > 0);
      assert.equal(desk.order.length, desk.courses.length);
    }
  assert.deepEqual(
    fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .sort(),
    expected.sort(),
  );
});
test('Runtime fetches only the chosen term; unlisted and concurrent choices do not fetch phantom files', async () => {
  const { createSource } = await model,
    calls = [];
  const files = { 'index.json': data('index.json'), '100l-second.json': data('100l-second.json') };
  files['index.json']['500L'].published = [];
  files['index.json']['100L'].published = ['second'];
  const load = createSource(async (f) => {
    calls.push(f);
    assert(f in files);
    return files[f];
  });
  const empty = await load({ level: '500L', semester: 'first' });
  assert.equal(empty.published, false);
  assert.deepEqual(calls, ['index.json']);
  const [a, b] = await Promise.all([load(study), load(study)]);
  assert(a.published && b.published);
  assert.deepEqual(calls, ['index.json', '100l-second.json']);
});
test('A failed or mismatched published response is an error, never “no courses”; Retry can succeed', async () => {
  const { createSource } = await model;
  let indexes = 0,
    terms = 0;
  const load = createSource(async (f) => {
    if (f === 'index.json') {
      if (++indexes === 1) throw Error('offline');
      const idx = data(f);
      idx['100L'].published = ['second'];
      return idx;
    }
    if (++terms === 1) throw Error('temporary');
    const d = data(f);
    return terms === 2 ? { ...d, level: '200L' } : d;
  });
  await assert.rejects(load(study), /offline/);
  await assert.rejects(load(study), /temporary/);
  await assert.rejects(load(study), /different desk/);
  assert((await load(study)).published);
  assert.equal(indexes, 2);
  assert.equal(terms, 3);
});
test('A new term is data, not another page: it has its own title, resource types, jump order and encoded library filter', async () => {
  const { createSource } = await model;
  const idx = data('index.json');
  idx['300L'].published = ['first'];
  const r = { level: '300L', semester: 'first' };
  const fixture = {
    ...r,
    courses: [
      { id: 'a', name: 'Reading & Writing' },
      { id: 'b', name: 'Seminar', resources: [{ label: 'Seminars', count: 2 }] },
    ],
    indexOrder: ['b', 'a'],
  };
  const calls = [];
  const load = createSource(async (f) => {
    calls.push(f);
    return f === 'index.json' ? idx : fixture;
  });
  const desk = await load(r);
  assert.deepEqual(calls, ['index.json', '300l-first.json']);
  assert.deepEqual(desk.filters, ['Seminars']);
  assert.deepEqual(desk.order, ['b', 'a']);
  assert.equal(
    desk.courses[0].resources[0].href,
    './pdf.html?level=300L&semester=first&course=Reading%20%26%20Writing',
  );
  assert.equal(desk.routes.length, 2);
});
test('Course IDs, swatches, order and resource destinations are validated before rendering', async () => {
  const { readTerm } = await model;
  const base = { ...study, courses: [{ id: 'starter', name: 'Starter' }] };
  for (const edit of [
    (d) => d.courses.push({ id: 'starter', name: 'Other' }),
    (d) => (d.indexOrder = ['unknown']),
    (d) => (d.courses[0].accent = 'blue'),
    (d) => (d.courses[0].resources = [{ label: 'Notes', count: -1 }]),
    (d) => (d.courses[0].resources = [{ label: 'Notes', href: '../incorrect.html' }]),
  ]) {
    const d = structuredClone(base);
    edit(d);
    assert.throws(() => readTerm(d, study));
  }
});
test('Every authored local asset, guide and resource resolves under the current mount', async () => {
  const { readIndex, readTerm } = await model,
    idx = readIndex(data('index.json'));
  const all = [...html.matchAll(/\b(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  for (const [level, value] of Object.entries(idx))
    for (const semester of value.published) {
      const d = readTerm(data(`${level.toLowerCase()}-${semester}.json`), { level, semester });
      all.push(
        ...d.routes.map((g) => g.href),
        ...d.courses.flatMap((c) => c.resources.map((r) => r.href).filter(Boolean)),
      );
    }
  for (const raw of all) {
    const url = new URL(raw, 'https://desk.example/unit/public/pages/semester.html');
    if (url.origin !== 'https://desk.example') continue;
    assert(url.pathname.startsWith('/unit/public/'));
    const file = path.join(pub, decodeURIComponent(url.pathname.slice('/unit/public/'.length)));
    assert(fs.statSync(file).isFile(), raw);
    if (url.hash) assert(read(file).includes(`id="${url.hash.slice(1)}"`), raw);
  }
});
