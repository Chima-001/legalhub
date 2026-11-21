import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { managedDesk, readCatalog } from '../../public/scripts/academic/catalog.mjs';
import { readTerm } from '../../public/scripts/academic/desk-data.mjs';
const json = async (n) =>
  JSON.parse(await readFile(new URL('../../public/data/semester-desks/' + n, import.meta.url), 'utf8'));
const route = { level: '100L', semester: 'second' },
  base = await json('100l-second.json');
const rows = base.courses.map((c, i) => ({
  id: `a0000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
  slug: c.id,
  name: c.name,
  code: c.code,
  key: c.resources.find((r) => r.library).library,
  ...route,
  curriculum_id: null,
  curriculum_name: null,
  archived: false,
  revision: 1,
}));
test('Installed 100L rows preserve every original course, tile, study route and resource', async () => {
  const live = await managedDesk(json, async () => rows)(route);
  const { courses, order, routes, filters } = readTerm(base, route);
  assert.deepEqual(
    [live.courses, live.order, live.routes, live.filters],
    [courses, order, routes, filters],
  );
  assert.equal(live.courses.flatMap((c) => c.resources).length, 26);
});
test('Renaming a course retains its material query and drops archived entries; no data file needed in a new semester', async () => {
  const edited = [{ ...rows[0], name: 'Foundations of Law', code: 'LAW 101' }];
  const one = await managedDesk(json, async () => edited)(route);
  assert.equal(one.courses[0].name, edited[0].name);
  assert.equal(one.courses[0].title, edited[0].name);
  assert.equal(one.order.length, 1);
  assert.equal(
    one.courses[0].resources[0].href,
    './pdf.html?level=100L&semester=second&course=Legal%20Method',
  );
  const next = { level: '400L', semester: 'first' },
    files = [];
  const fresh = await managedDesk(
    async (f) => {
      files.push(f);
      return json(f);
    },
    async () => [{ ...rows[0], ...next, slug: 'course-new', name: 'Evidence', key: 'Evidence' }],
  )(next);
  assert.deepEqual(files, ['index.json']);
  assert.equal(
    fresh.courses[0].resources[0].href,
    './pdf.html?level=400L&semester=first&course=Evidence',
  );
});
test('Empty successful query is unpublished; a failed query stays an error, never the seed list', async () => {
  const empty = await managedDesk(json, async () => [])(route);
  assert.equal(empty.published, false);
  await assert.rejects(
    managedDesk(json, async () => {
      throw Error('unavailable');
    })(route),
    /unavailable/,
  );
});
test('Reject malformed, archived or wrong-scope reader rows and duplicate keys before rendering', async () => {
  const api = (data) => ({ rpc: async () => ({ data, error: null }) });
  assert.equal((await readCatalog(api(rows), '100L', 'second')).length, 8);
  for (const data of [
    null,
    {},
    [{ ...rows[0], level: '400L' }],
    [{ ...rows[0], archived: true }],
    [{ ...rows[0], revision: 0 }],
    [rows[0], rows[0]],
  ])
    await assert.rejects(readCatalog(api(data), '100L', 'second'));
});

test('Separate curricula may use the same course name in one desk without combining identities or old links', async () => {
  const scope = { level: '300L', semester: 'first' },
    ar = rows
      .slice(0, 2)
      .map((r, i) => ({
        ...r,
        ...scope,
        name: 'Evidence',
        slug: 'course-' + (i ? 'b' : 'a'),
        key: i ? 'lh-course-alt' : 'Evidence',
        curriculum_id: r.id,
        curriculum_name: i ? 'Extended' : 'Core',
      }));
  const data = await managedDesk(json, async () => ar)(scope);
  assert.deepEqual(
    data.courses.map((c) => c.title),
    ['Evidence · Core', 'Evidence · Extended'],
  );
  assert.notEqual(data.courses[0].resources[0].href, data.courses[1].resources[0].href);
  assert.deepEqual(data.order, ['course-a', 'course-b']);
});
test('A curriculum association must have both a UUID and a readable name; unassigned authored courses remain valid', async () => {
  for (const row of [
    { ...rows[0], curriculum_id: 'invalid', curriculum_name: 'A' },
    { ...rows[0], curriculum_id: rows[0].id, curriculum_name: null },
    { ...rows[0], curriculum_name: 'orphan' },
  ])
    await assert.rejects(readCatalog({ rpc: async () => ({ data: [row] }) }, '100L', 'second'));
});
