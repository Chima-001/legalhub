// Actual page scripts; local DOM and SDK doubles only. No accounts, network or packages required.
'use strict';
const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm');
const web = path.resolve(__dirname, '../../public'),
  src = (f) => fs.readFileSync(path.join(web, f), 'utf8').replace(/\r\n/g, '\n');
const term = {
  session_year: 2026,
  semester: 1,
  semester_start: '2026-11-10',
  exam_start: '2027-02-01',
  exam_end: '2027-02-15',
  revision: 1,
};
const turn = () => new Promise((r) => setImmediate(r));
function element() {
  const events = new Map();
  return {
    value: '',
    textContent: '',
    style: {},
    dataset: {},
    hidden: false,
    disabled: false,
    attr: {},
    focused: false,
    addEventListener(k, f) {
      events.set(k, f);
    },
    async fire(k) {
      return events.get(k)?.({ target: this, preventDefault() {} });
    },
    reset() {},
    focus() {
      this.focused = true;
    },
    setAttribute(k, v) {
      this.attr[k] = v;
    },
    removeAttribute(k) {
      delete this.attr[k];
    },
  };
}
function page(file, { admin = false, calendar = term, handoff = false, level = '200L' } = {}) {
  const html = src(file),
    nodes = new Map([...html.matchAll(/\bid="([\w-]+)"/g)].map((m) => [m[1], element()]));
  const doc = element();
  doc.getElementById = (id) => {
    assert(nodes.has(id), 'missing id: ' + id);
    return nodes.get(id);
  };
  doc.documentElement = { dataset: handoff ? { signupHandoff: '1' } : {} };
  doc.hidden = false;
  const w = element(),
    state = { admin, calendar, level, year: 2026, who: 'member', today: '2027-01-31' },
    calls = [];
  let callback;
  const sdk = {
    auth: {
      getUser: async () => ({ data: { user: state.who ? { id: state.who } : null } }),
      onAuthStateChange(f) {
        callback = f;
      },
    },
    async rpc(name, args) {
      calls.push([name, args]);
      if (name === 'get_academic_calendar')
        return {
          error: state.readError,
          data: { today: state.today, can_manage: state.admin, term: state.calendar },
        };
      if (name === 'save_academic_calendar') {
        if (state.saveError) return { error: state.saveError };
        state.calendar = {
          session_year: args.p_session_year,
          semester: args.p_semester,
          semester_start: args.p_semester_start,
          exam_start: args.p_exam_start,
          exam_end: args.p_exam_end,
          revision: args.p_expected_revision + 1,
        };
        return { data: state.calendar.revision };
      }
      if (name === 'get_my_level_context')
        return {
          error: state.readError,
          data: {
            account_id: state.contextUid || state.who,
            level: state.level,
            assignment_year: state.year,
          },
        };
      if (name === 'get_effective_level') return { data: state.level };
      if (name === 'set_my_academic_level') {
        if (state.saveError) return { error: state.saveError };
        assert.equal(args.p_expected_uid, state.who);
        state.level = args.p_level;
        return { data: state.level };
      }
      throw Error('Unexpected RPC ' + name);
    },
  };
  const ctx = vm.createContext({
    document: doc,
    window: w,
    supabaseClient: sdk,
    setInterval() {},
    setTimeout(f) {
      queueMicrotask(f);
    },
    URL,
    console,
  });
  const run = (f) => vm.runInContext(src('scripts/academic/' + f + '.js'), ctx, { filename: f });
  run('term');
  return { $: doc.getElementById, doc, w, state, calls, run, auth: (event, s) => callback?.(event, s) };
}
const logic = page('index.html').w.LegalHubTerm;
test('A malformed calendar is unavailable, not an unpublished schedule or verified admin editor', async () => {
  for (const [file, js] of [
    ['index.html', 'home-calendar'],
    ['pages/admin-settings.html', 'admin-calendar'],
  ]) {
    const t = page(file, { admin: true, calendar: null });
    t.state.today = 'invalid';
    t.run(js);
    await turn();
    if (file === 'index.html') {
      assert(t.$('calendar-settings-nav').hidden);
      assert.match(t.$('term-countdown').textContent, /unavailable/);
    } else {
      assert(t.$('settings-workspace').hidden);
      assert(!t.$('gate-retry').hidden);
    }
  }
});
test('Mismatched profile identity does not render or enable another account’s level correction', async () => {
  const t = page('pages/profile.html');
  t.state.contextUid = 'other';
  t.run('profile-level');
  await turn();
  assert(t.$('save-level-btn').disabled);
  assert.equal(t.$('display-level').textContent, 'Unavailable');
});
test('Session pairs are consecutive; invalid and out-of-order dates are rejected', () => {
  for (const x of ['26/27', '2026/2028', '2027/2026', 'x']) assert.equal(logic.year(x), null);
  assert.equal(logic.year('2026/2027'), 2026);
  assert(Number.isNaN(logic.day('2027-02-29')));
  assert(Number.isFinite(logic.day('2028-02-29')));
  assert(logic.problem({ ...term, exam_start: '2026-11-09' }));
  assert(logic.problem({ ...term, exam_end: '2027-01-31' }));
  assert(!logic.problem(term));
});
test('Countdown handles future, teaching, first exam, final day, completed and a single-day term', () => {
  for (const [d, text, pct] of [
    ['2026-11-09', 'Semester starts in 1 day', 0],
    ['2026-11-10', 'Exams start in 83 days', 0],
    ['2027-01-31', 'Exams start in 1 day'],
    ['2027-02-01', 'Exams start today'],
    ['2027-02-05', 'Exams in progress'],
    ['2027-02-15', 'Final exam day', 100],
    ['2027-02-16', 'Semester complete', 100],
  ]) {
    const v = logic.view(term, d);
    assert(v.message.startsWith(text), v.message);
    if (pct !== undefined) assert.equal(v.percent, pct);
  }
  assert.equal(
    logic.view(
      { ...term, exam_start: term.semester_start, exam_end: term.semester_start },
      term.semester_start
    ).percent,
    100
  );
  assert.equal(logic.view(term, 'invalid'), null);
});
test('Home shows only server-provided term and admin access; an upcoming term restarts progress', async () => {
  const t = page('index.html', { admin: true });
  t.run('home-calendar');
  await turn();
  assert(!t.$('calendar-settings-nav').hidden);
  assert.equal(t.$('term-session').textContent, '2026/2027');
  assert.match(t.$('term-countdown').textContent, /1 day$/);
  t.state.admin = false;
  t.state.calendar = {
    ...term,
    semester: 2,
    semester_start: '2027-03-01',
    exam_start: '2027-06-01',
    exam_end: '2027-06-10',
    revision: 2,
  };
  await t.doc.fire('visibilitychange');
  await turn();
  assert(t.$('calendar-settings-nav').hidden);
  assert.equal(t.$('term-label').textContent, 'Second semester');
  assert.equal(t.$('term-meter').attr['aria-valuenow'], '0');
});
test('Missing term, unavailable calendar and signup handoff do not invent dates or expose admin controls', async () => {
  const t = page('index.html', { calendar: null });
  t.run('home-calendar');
  await turn();
  assert.match(t.$('term-countdown').textContent, /not been published/);
  assert(t.$('term-meter').hidden);
  t.state.readError = { code: 'offline' };
  await t.doc.fire('visibilitychange');
  await turn();
  assert(t.$('calendar-settings-nav').hidden);
  assert.match(t.$('term-countdown').textContent, /unavailable/);
  const legacy = page('index.html', { handoff: true });
  legacy.run('home-calendar');
  await turn();
  assert.equal(legacy.calls.length, 0);
});
async function adminPage(opts) {
  const t = page('pages/admin-settings.html', opts);
  t.run('admin-calendar');
  await turn();
  return t;
}
async function change(t, id, v) {
  t.$(id).value = v;
  await t.$(id).fire('input');
}
async function fill(t) {
  for (const [key, v] of [
    ['cal-session', '2026/2027'],
    ['cal-semester', '2'],
    ['cal-start', '2027-03-01'],
    ['cal-exams', '2027-06-01'],
    ['cal-end', '2027-06-10'],
  ])
    await change(t, key, v);
}
test('Admin editor stays hidden on a direct member visit, denied read or ended session', async () => {
  const t = await adminPage({});
  assert(t.$('settings-workspace').hidden);
  await t.$('calendar-form').fire('submit');
  assert(!t.calls.some((c) => c[0] === 'save_academic_calendar'));
  const a = await adminPage({ admin: true });
  assert(!a.$('settings-workspace').hidden);
  a.auth('SIGNED_OUT');
  assert(a.$('settings-workspace').hidden);
  const b = page('pages/admin-settings.html', { admin: true });
  b.state.readError = {};
  b.run('admin-calendar');
  await turn();
  assert(b.$('settings-workspace').hidden);
  assert(!b.$('gate-retry').hidden);
});
test('Publishing or editing requires exact text, invalidates confirmation on a field edit, and sends the reviewed revision', async () => {
  for (const [current, verb] of [
    [null, 'publish'],
    [term, 'update'],
  ]) {
    const t = await adminPage({ admin: true, calendar: current });
    await fill(t);
    const phrase = `i ${verb} 2026/2027 second semester`;
    await change(t, 'cal-confirm', 'yes');
    assert(t.$('cal-save').disabled);
    await t.$('calendar-form').fire('submit');
    assert(!t.calls.some((x) => x[0] === 'save_academic_calendar'));
    await change(t, 'cal-confirm', phrase);
    assert(!t.$('cal-save').disabled);
    await change(t, 'cal-end', '2027-06-12');
    assert.equal(t.$('cal-confirm').value, '');
    assert(t.$('cal-save').disabled);
    await change(t, 'cal-confirm', phrase);
    await t.$('calendar-form').fire('submit');
    assert.equal(t.calls.filter((x) => x[0] === 'save_academic_calendar').length, 1);
    assert.equal(
      t.calls.find((x) => x[0] === 'save_academic_calendar')[1].p_expected_revision,
      current ? 1 : 0
    );
    assert.equal(t.$('published-end').textContent, '12 Jun 2027');
    assert.match(t.$('cal-status').textContent, /saved/);
  }
});
test('Conflict or an unconfirmed save locks writing until reload; revoked admin loses the editor', async () => {
  for (const error of [{ code: '40001' }, { code: '42501' }, { code: 'offline' }]) {
    const t = await adminPage({ admin: true });
    await fill(t);
    await change(t, 'cal-confirm', 'i update 2026/2027 second semester');
    t.state.saveError = error;
    await t.$('calendar-form').fire('submit');
    if (error.code === '42501') assert(t.$('settings-workspace').hidden);
    else {
      assert(t.$('calendar-fields').disabled);
      assert(!t.$('cal-reload').hidden);
      assert(!/Calendar saved/.test(t.$('cal-status').textContent));
    }
  }
});
test('Profile corrections display the assigned session and require an exact level-specific confirmation', async () => {
  const t = page('pages/profile.html');
  t.run('profile-level');
  await turn();
  assert.equal(t.$('display-level').textContent, '200L');
  assert.match(t.$('level-session-hint').textContent, /2026\/2027/);
  t.$('level-select').value = '300L';
  await t.$('level-select').fire('change');
  await t.$('save-level-btn').fire('click');
  await change(t, 'level-confirm', 'yes');
  await t.$('level-apply').fire('click');
  assert(!t.calls.some((c) => c[0] === 'set_my_academic_level'));
  await change(t, 'level-confirm', 'i update 300L for 2026/2027');
  await t.$('level-apply').fire('click');
  assert.equal(t.$('display-level').textContent, '300L');
  assert(t.$('level-review').hidden);
});
test('An older/missing level service permits read-only display, not an unchecked direct write', async () => {
  const t = page('pages/profile.html');
  t.state.readError = { code: 'missing' };
  t.run('profile-level');
  await turn();
  assert(t.$('save-level-btn').disabled);
  assert.equal(t.$('display-level').textContent, '200L');
  assert.match(t.$('level-session-hint').textContent, /unavailable/);
});
test('Library reads the effective profile level without replacing an explicitly requested level', async () => {
  const code = src('scripts/pdfs.js').match(/  async function loadUserFilters\(\) \{[\s\S]*?\n  \}/)[0];
  for (const [starting, chosen, want] of [
    ['all', false, '200L'],
    ['400L', false, '400L'],
    ['all', true, 'all'],
  ]) {
    const calls = [],
      select = {};
    const api = {
      auth: { getUser: async () => ({ data: { user: { id: 'fixture' } } }) },
      from() {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          single: async () => ({ data: { is_admin: false } }),
        };
      },
      async rpc(n, args) {
        calls.push(n);
        assert.equal(args.p_uid, 'fixture');
        return { data: '200L' };
      },
    };
    const ctx = vm.createContext({
      selectedLevel: starting,
      // The isolated reader now keeps a consent flag for defaults and the signed-in viewer.
      viewerId: null,
      selectedSemester: 'all',
      unscopedEntry: starting === 'all' && !chosen,
      acceptProfileLevel: starting === 'all' && !chosen,
      isAdmin: false,
      document: { getElementById: () => select },
      supabaseClient: api,
    });
    await vm.runInContext(code + ';loadUserFilters()', ctx);
    assert.deepEqual(calls, ['get_effective_level']);
    assert.equal(ctx.viewerId, 'fixture');
    assert.equal(ctx.selectedSemester, starting === 'all' && !chosen ? 'first' : 'all');
    assert.equal(ctx.selectedLevel, want);
    assert.equal(select.value, want);
  }
});
