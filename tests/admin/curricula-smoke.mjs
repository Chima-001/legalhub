import assert from 'node:assert/strict';
import { catalogFixture, uid } from './catalog-fixture.mjs';
const { db, as, rpc, query, scalar, catalogSQL } = await catalogFixture(false);
const pass = (s) => console.log('PASS:', s);
const actor = uid(2);
const curr = (action, id, revision, name, phrase, description = '') =>
  rpc('lh_write_curriculum', {
    p_actor: actor,
    p_action: action,
    p_id: id,
    p_revision: revision,
    p_name: name,
    p_description: description,
    p_phrase: phrase,
  });
const draft = (curriculum, name, more = {}) => ({
  p_actor: actor,
  p_action: 'add',
  p_id: null,
  p_revision: 0,
  p_level: '300L',
  p_semester: 'first',
  p_curriculum: curriculum,
  p_curriculum_revision: 1,
  p_name: name,
  p_code: '',
  p_phrase: 'i add ' + name,
  ...more,
});
const save = (d) => rpc('lh_write_course', d);
const list = (level = '300L', sem = 'first', incl = false) =>
  rpc('lh_course_list', { p_level: level, p_semester: sem, p_include_archived: incl });
try {
  await query("INSERT INTO public.courses(name) VALUES('Unreviewed import')");
  await assert.rejects(db.exec(catalogSQL), /Keep these rows/);
  await db.exec('ROLLBACK');
  assert.equal(await scalar('SELECT name FROM public.courses'), 'Unreviewed import');
  await db.exec('DELETE FROM public.courses');
  await db.exec(catalogSQL);
  await as(2);
  assert.deepEqual(await rpc('lh_curricula', { p_actor: actor }), []);
  assert.equal((await list('100L', 'second')).length, 8);
  assert.deepEqual(await list(), []);
  pass(
    'Drift refused without data loss. Eight existing desk identities; no invented curriculum or lists.',
  );
  await as(3);
  await assert.rejects(curr('add', null, 0, 'A', 'i add A'));
  await assert.rejects(save(draft(null, 'A')));
  await assert.rejects(list(null, null, true));
  assert.equal((await list('100L', 'second')).length, 8);
  await assert.rejects(query("INSERT INTO public.courses(name) VALUES('No')"));
  await as(0, 'anon');
  await assert.rejects(list());
  await as(2);
  await assert.rejects(save(draft(null, 'Evidence')));
  await assert.rejects(curr('add', null, 0, 'Core', 'yes'));
  const a = await curr('add', null, 0, 'Core', 'i add Core', 'A programme'),
    b = await curr('add', null, 0, 'Extended', 'i add Extended');
  await assert.rejects(curr('add', null, 0, 'core', 'i add core'));
  pass(
    'Only admins can create multiple named curricula. New courses require an existing chosen curriculum.',
  );
  const x = await save(draft(a, 'Evidence')),
    y = await save(draft(a, 'Property')),
    z = await save(draft(b, 'Evidence'));
  await save(draft(a, 'Tax', { p_semester: 'second' }));
  await save(draft(a, 'Appeals', { p_level: '500L' }));
  await assert.rejects(save(draft(a, 'evidence')), /already in/);
  await as(4);
  let rr = await list();
  assert.equal(rr.length, 3);
  let one = rr.find((r) => r.id === x),
    two = rr.find((r) => r.id === z);
  assert.equal(one.curriculum_name, 'Core');
  assert.notEqual(one.key, two.key);
  assert.equal((await list('300L', 'second'))[0].name, 'Tax');
  assert.equal((await list('500L', 'first'))[0].name, 'Appeals');
  await as(2);
  let xx = draft(a, 'Evidence Law', {
    p_action: 'edit',
    p_id: x,
    p_revision: 1,
    p_phrase: 'i edit Evidence',
  });
  await assert.rejects(save({ ...xx, p_phrase: 'i edit Evidence Law' }), /confirmation/);
  await save(xx);
  await assert.rejects(save(xx), /changed/);
  assert.equal((await list()).find((r) => r.id === x).key, 'Evidence');
  await curr('edit', a, 1, 'Core Law', 'i edit Core', 'New description');
  await assert.rejects(save(draft(a, 'Criminal Law')), /curriculum/);
  await assert.rejects(curr('delete', a, 2, '', 'i delete Core Law'), /assigned courses/);
  pass(
    'Many courses in one semester and curriculum, multiple semesters/levels and two curricula in the same desk. Stable IDs/keys, typed changes, stale revisions and rename.',
  );
  const act = (id, rev, name, action) =>
    save(
      draft(b, name, { p_id: id, p_revision: rev, p_action: action, p_phrase: `i ${action} ${name}` }),
    );
  await as(3);
  await query('INSERT INTO public.materials(course,level,semester,material_name) VALUES($1,$2,$3,$4)', [
    'Evidence',
    '300L',
    'first',
    'Notes',
  ]);
  await as(0);
  assert.equal(await scalar('SELECT catalog_course_id FROM public.materials'), x);
  await query('INSERT INTO public.course_case_links(course_id) VALUES($1)', [z]);
  await as(2);
  await assert.rejects(act(x, 2, 'Evidence Law', 'delete'), /Referenced course/);
  await assert.rejects(act(z, 1, 'Evidence', 'delete'), /Referenced course/);
  await act(x, 2, 'Evidence Law', 'archive');
  assert(!(await list()).some((r) => r.id === x));
  await as(3);
  await assert.rejects(
    query("INSERT INTO public.materials(course,level,semester) VALUES('Evidence','300L','first')"),
    /archived/,
  );
  await as(2);
  await act(x, 3, 'Evidence Law', 'restore');
  await assert.rejects(
    save(
      draft(a, 'Legal Method', {
        p_id: (await list('100L', 'second'))[0].id,
        p_level: '100L',
        p_semester: 'second',
        p_action: 'delete',
        p_revision: 1,
        p_phrase: 'i delete Legal Method',
      }),
    ),
    /Referenced/,
  );
  await as(0);
  assert.equal(await scalar('SELECT count(*)::int FROM public.materials'), 1);
  assert.equal(await scalar('SELECT count(*)::int FROM public.course_case_links'), 1);
  pass(
    'Material and case references prevent hard deletion; archive/restore preserves files, links and existing authored resources.',
  );
  await as(2);
  await assert.rejects(
    save(draft(b, 'Property', { p_id: y, p_action: 'delete', p_revision: 1, p_phrase: 'yes' })),
  );
  await act(y, 1, 'Property', 'delete');
  assert(!(await list()).some((r) => r.id === y));
  await as(3);
  await assert.rejects(
    query("INSERT INTO public.materials(course,level,semester) VALUES('Property','300L','first')"),
    /removed/,
  );
  await as(2);
  const yy = await save(draft(b, 'Property'));
  assert.notEqual((await list()).find((r) => r.id === yy).key, 'Property');
  const d = await curr('add', null, 0, 'Temporary', 'i add Temporary');
  await assert.rejects(curr('delete', d, 1, '', 'i delete Other'));
  await curr('delete', d, 1, '', 'i delete Temporary');
  assert(!(await rpc('lh_curricula', { p_actor: actor })).some((r) => r.id === d));
  await as(0);
  assert.equal(await scalar('SELECT count(*)::int FROM public.courses WHERE id=$1', [y]), 0);
  assert(
    await scalar("SELECT count(*)::int FROM legalhub_console.changes WHERE action='course.delete'"),
  );
  await as(2);
  await save(
    draft(a, 'Property', {
      p_curriculum_revision: 2,
      p_id: yy,
      p_revision: 1,
      p_action: 'edit',
      p_phrase: 'i edit Property',
    }),
  );
  assert.equal((await list()).find((r) => r.id === yy).curriculum_id, a);
  pass(
    'True delete of unreferenced course/empty curriculum, no reused bookmark key, no stale upload, private audit.',
  );
} finally {
  await db.close();
}
