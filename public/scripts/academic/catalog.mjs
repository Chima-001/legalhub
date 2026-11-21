import { LEVELS, TERMS, readIndex, readTerm } from './desk-data.mjs';
const fail = () => {
  throw Error('Invalid course catalogue.');
};
const id = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const text = (s, n, min = 1) =>
  typeof s === 'string' &&
  s.length >= min &&
  s.length <= n &&
  s === s.trim() &&
  !/[\u0000-\u001f\u007f]/u.test(s);
export async function readCatalog(client, level = null, semester = null, includeArchived = false) {
  const abort = new AbortController(),
    timer = setTimeout(() => abort.abort(), 12000);
  try {
    const q = client.rpc('lh_course_list', {
      p_level: level,
      p_semester: semester,
      p_include_archived: includeArchived,
    });
    const { data, error } = await (q.abortSignal ? q.abortSignal(abort.signal) : q);
    if (error) throw error;
    if (!Array.isArray(data)) fail();
    const seen = new Set(),
      keys = new Set();
    for (const row of data) {
      if (
        !row ||
        typeof row.id !== 'string' ||
        !id.test(row.id) ||
        !LEVELS.includes(row.level) ||
        !TERMS.includes(row.semester) ||
        (level && row.level !== level) ||
        (semester && row.semester !== semester) ||
        typeof row.slug !== 'string' ||
        !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(row.slug) ||
        !text(row.name, 120) ||
        !text(row.code, 32, 0) ||
        !text(row.key, 120) ||
        !(
          (row.curriculum_id === null && row.curriculum_name === null) ||
          (typeof row.curriculum_id === 'string' &&
            id.test(row.curriculum_id) &&
            text(row.curriculum_name, 100))
        ) ||
        typeof row.archived !== 'boolean' ||
        (!includeArchived && row.archived) ||
        !Number.isSafeInteger(row.revision) ||
        row.revision < 1
      )
        fail();
      const k = [row.level, row.semester, row.key.toLowerCase()].join(':');
      if (seen.has(row.id) || keys.has(k)) fail();
      seen.add(row.id);
      keys.add(k);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}
// The database owns membership in the list. The shipped 100L JSON owns its curated resource rows and links.
// A failed live read must never substitute an old or archived list. Cache only static resource decoration.
export function managedDesk(readJSON, readRows) {
  const files = new Map();
  function file(name, check) {
    if (!files.has(name))
      files.set(
        name,
        Promise.resolve()
          .then(() => readJSON(name))
          .then((v) => {
            check(v);
            return v;
          })
          .catch((e) => {
            files.delete(name);
            throw e;
          }),
      );
    return files.get(name);
  }
  return async (route) => {
    const { level, semester } = route;
    if (!LEVELS.includes(level) || !TERMS.includes(semester)) fail();
    const [idx, rows] = await Promise.all([file('index.json', readIndex), readRows(level, semester)]);
    const entry = idx[level];
    if (!rows.length) return { intro: entry.intro, published: false };
    const base = entry.published.includes(semester)
      ? await file(`${level.toLowerCase()}-${semester}.json`, (v) => readTerm(v, route))
      : { ...route, courses: [] };
    const previous = new Map(base.courses.map((c) => [c.id, c]));
    const counts = new Map();
    for (const r of rows) counts.set(r.name.toLowerCase(), (counts.get(r.name.toLowerCase()) || 0) + 1);
    const courses = rows.map((r) => {
      const orig = previous.get(r.slug),
        c = { ...orig, id: r.slug, name: r.name };
      if (!orig || orig.name !== r.name) c.title = r.name;
      if (r.curriculum_name) {
        c.curriculumId = r.curriculum_id;
        c.curriculumName = r.curriculum_name;
      }
      if (counts.get(r.name.toLowerCase()) > 1) {
        c.listLabel = r.name + ' · ' + (r.curriculum_name || 'Existing desk');
        c.title = c.listLabel;
      }
      if (r.code) c.code = r.code;
      else delete c.code;
      if (orig && r.code !== (orig.code || '')) delete c.tileCode;
      c.resources = orig?.resources?.map((res) => (res.library ? { ...res, library: r.key } : res)) || [
        { label: 'Course materials', library: r.key },
      ];
      return c;
    });
    const active = new Set(courses.map((c) => c.id));
    const indexOrder = [
      ...new Set([...(base.indexOrder || []).filter((k) => active.has(k)), ...active]),
    ];
    return {
      intro: entry.intro,
      published: true,
      ...readTerm({ ...base, courses, indexOrder }, route, true),
    };
  };
}
