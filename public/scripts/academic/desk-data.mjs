// Data and addresses for the single runtime desk. No DOM, account writes or build step.
export const LEVELS = Object.freeze(['100L', '200L', '300L', '400L', '500L']);
export const TERMS = Object.freeze(['first', 'second']);
const tones = ['blue', 'coral', 'yellow', 'green'];
const check = (ok, message) => {
  if (!ok) throw new Error(message);
};
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v) =>
  typeof v === 'string' && v.length > 0 && v.length <= 240 && v.trim() === v && !/[\u0000-\u001f]/u.test(v);
const valid = (level, semester) => LEVELS.includes(level) && TERMS.includes(semester);
export const termTitle = (t) => (t === 'first' ? 'First Semester' : 'Second Semester');
export function selection(search) {
  const q = new URLSearchParams(search),
    ls = q.getAll('level'),
    ts = q.getAll('semester');
  if (ls.length !== 1 || ts.length !== 1) return null;
  const level = ls[0].toUpperCase(),
    semester = ts[0].toLowerCase();
  return valid(level, semester) ? { level, semester } : null;
}
export function deskHref({ level, semester }) {
  check(valid(level, semester), 'Unknown desk');
  return `./semester.html?level=${level}&semester=${semester}`;
}
export function libraryHref({ level, semester }, course) {
  check(valid(level, semester), 'Unknown desk');
  return (
    `./pdf.html?level=${level}&semester=${semester}` +
    (course ? '&course=' + encodeURIComponent(course) : '')
  );
}
export function readIndex(value) {
  check(object(value) && Object.keys(value).length === LEVELS.length, 'Incomplete desk index');
  for (const level of LEVELS) {
    const entry = value[level];
    check(object(entry) && text(entry.intro) && Array.isArray(entry.published), `Invalid index: ${level}`);
    check(
      entry.published.every((t) => TERMS.includes(t)) &&
        new Set(entry.published).size === entry.published.length,
      `Invalid published terms: ${level}`,
    );
  }
  return value;
}
function reviewedHref(s) {
  if (!text(s) || /[\s\\]/u.test(s)) return false;
  if (/^\.\/[a-z0-9][\w-]*\.html(?:[?#][^<>"']*)?$/i.test(s)) return true;
  try {
    const u = new URL(s);
    return (
      s.startsWith('https://') && u.origin === 'https://legalhub-law.web.app' && !u.username && !u.password
    );
  } catch {
    return false;
  }
}
function flag(o, k) {
  check(o[k] === undefined || typeof o[k] === 'boolean', `Invalid ${k}`);
}
export function readTerm(value, route) {
  check(
    object(value) &&
      valid(route.level, route.semester) &&
      value.level === route.level &&
      value.semester === route.semester,
    'Course file belongs to a different desk',
  );
  check(
    Array.isArray(value.courses) && value.courses.length > 0,
    'A published desk needs a confirmed list',
  );
  const ids = new Set(),
    names = new Set();
  const courses = value.courses.map((c) => {
    check(
      object(c) && text(c.id) && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(c.id) && !ids.has(c.id),
      'Invalid or repeated course ID',
    );
    check(text(c.name) && !names.has(c.name.toLowerCase()), 'Invalid or repeated course name');
    ids.add(c.id);
    names.add(c.name.toLowerCase());
    for (const k of ['code', 'tileCode', 'title', 'badge'])
      check(c[k] === undefined || text(c[k]), `Invalid course ${k}`);
    check(
      c.accent === undefined || (typeof c.accent === 'string' && /^#[a-f0-9]{6}$/i.test(c.accent)),
      'Invalid course colour',
    );
    flag(c, 'request');
    flag(c, 'badgeActive');
    check(!c.badgeActive || c.badge, 'Missing badge');
    const rows =
      c.resources === undefined ? [{ label: 'Course materials', library: c.title || c.name }] : c.resources;
    check(Array.isArray(rows), 'Invalid resource list');
    const resources = rows.map((r) => {
      check(object(r) && text(r.label), 'Resource label required');
      check(r.library === undefined || (text(r.library) && r.href === undefined), 'Invalid course filter');
      check(r.href === undefined || reviewedHref(r.href), 'Unreviewed resource destination');
      check(
        r.count === undefined || (Number.isSafeInteger(r.count) && r.count >= 0),
        'Invalid resource count',
      );
      flag(r, 'copy');
      flag(r, 'live');
      check(!r.live || r.count !== undefined, 'Missing resource count');
      const href = r.library ? libraryHref(route, r.library) : r.href;
      check(!r.copy || href, 'Missing copy destination');
      return { ...r, href };
    });
    return {
      ...c,
      title: c.title || c.name,
      tileCode: c.tileCode || c.code || 'Course',
      accent: c.accent || '#708fa2',
      resources,
    };
  });
  const order = value.indexOrder === undefined ? [...ids] : value.indexOrder;
  check(
    Array.isArray(order) &&
      order.length === ids.size &&
      new Set(order).size === ids.size &&
      order.every((id) => ids.has(id)),
    'Invalid quick index order',
  );
  const guides = value.guides === undefined ? [] : value.guides;
  check(
    Array.isArray(guides) &&
      guides.length <= 2 &&
      guides.every(
        (g) => object(g) && text(g.title) && text(g.note) && reviewedHref(g.href) && tones.includes(g.tone),
      ),
    'Invalid study guides',
  );
  const routes = [
    ...guides,
    { title: 'Open the library', note: 'Find notes and books', tone: 'yellow', href: libraryHref(route) },
    {
      title: 'Take a CBT Practice',
      note: 'Compete to beat your record',
      tone: 'green',
      href: 'https://legalhub-law.web.app',
    },
  ];
  const labels = new Set(courses.flatMap((c) => c.resources.filter((r) => !r.library).map((r) => r.label)));
  return { courses, order, routes, filters: [...labels] };
}

// Only a successful manifest can say a list is unpublished. Missing/invalid published
// files remain errors, and failed reads can be retried. Concurrent reads share a promise.
export function createSource(readJSON) {
  const cache = new Map();
  function get(name, parse) {
    if (!cache.has(name)) {
      const pending = Promise.resolve()
        .then(() => readJSON(name))
        .then(parse);
      cache.set(name, pending);
      pending.catch(() => {
        if (cache.get(name) === pending) cache.delete(name);
      });
    }
    return cache.get(name);
  }
  return async (route) => {
    check(route && valid(route.level, route.semester), 'Unknown desk');
    const entry = (await get('index.json', readIndex))[route.level];
    if (!entry.published.includes(route.semester)) return { intro: entry.intro, published: false };
    const name = `${route.level.toLowerCase()}-${route.semester}.json`;
    const term = await get(name, (value) => readTerm(value, route));
    return { intro: entry.intro, published: true, ...term };
  };
}
