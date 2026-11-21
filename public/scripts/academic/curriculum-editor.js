/* Admin catalogue editing. All identity, revision, membership and phrase checks also run in the RPC. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id),
    k = 'curriculum',
    c = 'course';
  const kinds = [k, c],
    panels = { curriculum: $('panel-curricula'), course: $('panel-courses') };
  if (!panels[k] || !panels[c]) return;
  const get = (kind, field) => $(kind + '-' + field),
    value = (kind, field) => get(kind, field).value;
  const choices = (el, pairs) => el.replaceChildren(...pairs.map(([v, text]) => new Option(text, v)));
  const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
  let actor = null,
    preferredFilter = '';
  const state = Object.fromEntries(
    kinds.map((x) => [x, { seq: 0, ready: false, busy: false, cur: [], rows: [] }]),
  );
  const open = (kind) =>
    !!actor && !$('settings-workspace').hidden && !panels[kind].hidden && panels[kind].open;
  const active = (kind, t) => open(kind) && state[kind].seq === t;
  const say = (kind, text) => (get(kind, 'status').textContent = text);
  const selected = (kind) =>
    (kind === k ? state[kind].cur : state[kind].rows).find((r) => r.id === value(kind, 'pick'));
  const verbs = { add: 'Add', edit: 'Edit', archive: 'Archive', restore: 'Restore', delete: 'Delete' };
  function clear(kind, resetScope = false) {
    const s = state[kind];
    ++s.seq;
    s.ready = s.busy = false;
    s.cur = [];
    s.rows = [];
    if (resetScope) get(kind, 'form').reset();
    get(kind, 'fields').disabled = true;
    get(kind, 'save').disabled = true;
    get(kind, 'name').value = '';
    get(kind, 'confirm').value = '';
    get(kind, 'phrase').textContent = '';
    get(kind, 'review-note').textContent = '';
    choices(get(kind, 'pick'), []);
    choices(get(kind, 'action'), []);
    say(kind, '');
    if (kind === k) {
      get(k, 'description').value = '';
      get(k, 'count').textContent = '';
      get(k, 'courses').hidden = true;
    } else {
      get(c, 'code').value = '';
      choices(get(c, 'curriculum'), []);
      get(c, 'scope').disabled = false;
      if (resetScope) choices($('directory-curriculum'), [['', 'All curricula']]);
    }
  }
  document.addEventListener('lh:admin-session', (e) => {
    actor = typeof e.detail === 'string' && uuid.test(e.detail) ? e.detail : null;
    preferredFilter = '';
    for (const kind of kinds) {
      panels[kind].open = false;
      panels[kind].hidden = !actor;
      clear(kind, true);
    }
  });
  function errorText(err) {
    if (err?.code === '42501')
      return 'Administrator access or account changed. Recheck access before editing.';
    if (err?.code === '40001')
      return 'This course or curriculum changed. Reload the list and review again.';
    if (err?.code === '23505')
      return 'That name is already used in this directory. Choose a different name.';
    if (err?.code === '23503')
      return 'Nothing was deleted. Move assigned courses before deleting a curriculum; archive a course that has resources, materials or case links.';
    if (err?.code === '22023') return 'Check the selected item, details and exact confirmation phrase.';
    if (err?.code === 'offline') return 'You are offline. No change was sent.';
    return 'Could not confirm the result. Reload the list before trying again.';
  }
  async function curriculumRows(id) {
    const { data, error } = await supabaseClient.rpc('lh_curricula', { p_actor: id });
    if (error) throw error;
    if (
      !Array.isArray(data) ||
      !data.every(
        (r) =>
          r &&
          uuid.test(r.id) &&
          typeof r.name === 'string' &&
          r.name.trim() &&
          typeof r.description === 'string' &&
          Number.isSafeInteger(r.revision) &&
          r.revision > 0 &&
          Number.isSafeInteger(r.count) &&
          r.count >= 0,
      ) ||
      new Set(data.map((r) => r.id)).size !== data.length
    )
      throw Error('Bad curriculum directory');
    return data;
  }
  function listCourses(pick = '') {
    const s = state[c],
      group = $('directory-curriculum').value;
    const rows = s.rows.filter((r) => !group || r.curriculum_id === group);
    choices(get(c, 'pick'), [
      ['', '+ Add a course'],
      ...rows.map((r) => [
        r.id,
        `${r.name} · ${r.curriculum_name || 'Existing desk'}${r.archived ? ' · archived' : ''}`,
      ]),
    ]);
    get(c, 'pick').value = rows.some((r) => r.id === pick) ? pick : '';
    choose(c);
  }
  async function load(kind, pick = '', notice = '') {
    if (!open(kind)) return;
    const s = state[kind],
      id = actor,
      t = ++s.seq;
    s.ready = s.busy = false;
    get(kind, 'fields').disabled = true;
    get(kind, 'save').disabled = true;
    get(kind, 'confirm').value = '';
    get(kind, 'phrase').textContent = '';
    say(kind, 'Loading directory…');
    if (kind === c) get(c, 'scope').disabled = false;
    try {
      const [cur, rows] = await Promise.all([
        curriculumRows(id),
        kind === c
          ? import('./catalog.mjs').then((m) =>
              m.readCatalog(supabaseClient, value(c, 'level'), value(c, 'sem'), true),
            )
          : [],
      ]);
      if (!active(kind, t)) return;
      s.cur = cur;
      s.rows = rows;
      s.ready = true;
      get(kind, 'fields').disabled = false;
      if (kind === k) {
        choices(get(k, 'pick'), [['', '+ Add a curriculum'], ...cur.map((r) => [r.id, r.name])]);
        get(k, 'pick').value = cur.some((r) => r.id === pick) ? pick : '';
        choose(k);
      } else {
        choices($('directory-curriculum'), [['', 'All curricula'], ...cur.map((r) => [r.id, r.name])]);
        $('directory-curriculum').value = cur.some((r) => r.id === preferredFilter)
          ? preferredFilter
          : '';
        preferredFilter = $('directory-curriculum').value;
        listCourses(pick);
      }
      say(
        kind,
        notice ||
          (!cur.length
            ? kind === k
              ? 'No curricula yet. Create the first one here.'
              : 'No curricula yet. Use Curricula to create one before adding a course.'
            : ''),
      );
    } catch (err) {
      if (!active(kind, t)) return;
      s.ready = false;
      get(kind, 'fields').disabled = true;
      say(kind, 'Directory unavailable. ' + errorText(err));
    }
  }
  function choose(kind) {
    const row = selected(kind),
      s = state[kind];
    say(kind, '');
    get(kind, 'confirm').value = '';
    const ops = !row
      ? ['add']
      : kind === k
        ? ['edit', 'delete']
        : ['edit', row.archived ? 'restore' : 'archive', 'delete'];
    choices(
      get(kind, 'action'),
      ops.map((a) => [a, verbs[a]]),
    );
    get(kind, 'name').value = row?.name || '';
    if (kind === k) {
      get(k, 'description').value = row?.description || '';
      get(k, 'count').textContent = row
        ? `${row.count} assigned course${row.count === 1 ? '' : 's'} across all levels and semesters.`
        : '';
      get(k, 'courses').hidden = !row;
    } else {
      get(c, 'code').value = row?.code || '';
      choices(get(c, 'curriculum'), [['', 'Choose a curriculum'], ...s.cur.map((r) => [r.id, r.name])]);
      get(c, 'curriculum').value = row ? row.curriculum_id || '' : $('directory-curriculum').value;
      get(c, 'create-curriculum').hidden = !!s.cur.length;
    }
    reflect(kind, true);
  }
  function draft(kind) {
    const row = selected(kind),
      a = value(kind, 'action'),
      s = state[kind],
      name = value(kind, 'name').trim(),
      editing = a === 'add' || a === 'edit';
    let valid = !!a && (!editing || !!name);
    const phrase = a && ((a === 'add' && name) || row) ? `i ${a} ${a === 'add' ? name : row.name}` : '';
    const args = {
      p_actor: actor,
      p_action: a,
      p_id: row?.id || null,
      p_revision: row?.revision || 0,
      p_name: name,
      p_phrase: value(kind, 'confirm'),
    };
    if (kind === k) {
      args.p_description = value(k, 'description').trim();
      if (a === 'edit' && name === row?.name && args.p_description === row?.description) valid = false;
    } else {
      const group = s.cur.find((r) => r.id === value(c, 'curriculum'));
      Object.assign(args, {
        p_level: value(c, 'level'),
        p_semester: value(c, 'sem'),
        p_curriculum: group?.id || null,
        p_curriculum_revision: group?.revision || 0,
        p_code: value(c, 'code').trim(),
      });
      if (editing && !group) valid = false;
      if (
        a === 'edit' &&
        name === row?.name &&
        args.p_code === row?.code &&
        args.p_curriculum === row?.curriculum_id
      )
        valid = false;
    }
    return { a, row, args, phrase, editing, valid: !!phrase && valid };
  }
  function reflect(kind, changed = false) {
    const s = state[kind];
    if (!s.ready || s.busy) return;
    if (changed) get(kind, 'confirm').value = '';
    const { a, row, phrase, editing, valid } = draft(kind);
    get(kind, 'name').disabled = !editing;
    if (kind === k) get(k, 'description').disabled = !editing;
    else {
      get(c, 'curriculum').disabled = !editing;
      get(c, 'code').disabled = !editing;
    }
    get(kind, 'phrase').textContent = phrase || 'Enter the details first.';
    get(kind, 'review-note').textContent =
      a === 'delete'
        ? kind === k
          ? 'Only an empty curriculum can be deleted. Its courses will never be deleted with it.'
          : 'Only an unreferenced course can be deleted. Archive a course with linked resources instead.'
        : a === 'archive'
          ? 'Remove from new choices without deleting files or case links.'
          : a === 'restore'
            ? 'Return this course to the published directory.'
            : kind === c
              ? `Review the curriculum, level, semester and ${row ? 'changed' : 'new'} course details.`
              : 'This name is used across the curriculum’s semesters.';
    const btn = get(kind, 'save');
    btn.textContent = `${verbs[a] || 'Save'} ${kind}`;
    btn.dataset.danger = String(a === 'delete');
    btn.disabled = !valid || value(kind, 'confirm') !== phrase;
  }
  async function save(kind, e) {
    e.preventDefault();
    const s = state[kind];
    if (!open(kind) || !s.ready || s.busy) return;
    const d = draft(kind);
    if (!d.valid || d.args.p_phrase !== d.phrase) return;
    const t = ++s.seq;
    s.busy = true;
    get(kind, 'fields').disabled = true;
    if (kind === c) get(c, 'scope').disabled = true;
    say(kind, 'Saving reviewed change…');
    try {
      if (navigator.onLine === false) throw { code: 'offline' };
      const who = await supabaseClient.auth.getUser();
      if (!active(kind, t)) return;
      if (who.error || who.data?.user?.id !== d.args.p_actor) throw { code: '42501' };
      const { data, error } = await supabaseClient.rpc(
        kind === k ? 'lh_write_curriculum' : 'lh_write_course',
        d.args,
      );
      if (!active(kind, t)) return;
      if (error || !uuid.test(data)) throw error || Error();
      if (kind === c && d.editing && preferredFilter) preferredFilter = d.args.p_curriculum;
      const label = kind === k ? 'Curriculum' : 'Course',
        name = d.editing ? d.args.p_name : d.row.name;
      const past = {
        add: 'added',
        edit: 'updated',
        archive: 'archived',
        restore: 'restored',
        delete: 'deleted',
      }[d.a];
      await load(kind, d.a === 'delete' ? '' : data, `${label} ${past}: ${name}.`);
    } catch (err) {
      if (!active(kind, t)) return;
      s.ready = s.busy = false;
      get(kind, 'confirm').value = '';
      get(kind, 'save').disabled = true;
      if (kind === c) get(c, 'scope').disabled = false;
      say(kind, errorText(err) + ' Use Reload list.');
    }
  }
  for (const kind of kinds) {
    panels[kind].addEventListener('toggle', () => {
      if (open(kind)) void load(kind);
      else clear(kind);
    });
    get(kind, 'pick').addEventListener('change', () => choose(kind));
    get(kind, 'action').addEventListener('change', () => {
      chooseAction(kind);
    });
    get(kind, 'form').addEventListener('submit', (e) => void save(kind, e));
    get(kind, 'reload').addEventListener('click', () => {
      if (!state[kind].busy) void load(kind, value(kind, 'pick'));
    });
    get(kind, 'confirm').addEventListener('input', () => reflect(kind));
    for (const field of kind === k ? ['name', 'description'] : ['name', 'code', 'curriculum'])
      get(kind, field).addEventListener(field === 'curriculum' ? 'change' : 'input', () =>
        reflect(kind, true),
      );
  }
  function chooseAction(kind) {
    const row = selected(kind);
    if (row) {
      get(kind, 'name').value = row.name;
      if (kind === k) get(k, 'description').value = row.description;
      else {
        get(c, 'code').value = row.code;
        get(c, 'curriculum').value = row.curriculum_id || '';
      }
    }
    reflect(kind, true);
  }
  get(k, 'courses').addEventListener('click', () => {
    const row = selected(k);
    if (!row) return;
    preferredFilter = row.id;
    panels[c].open = true;
    panels[c].querySelector('summary').focus();
  });
  get(c, 'create-curriculum').addEventListener('click', () => {
    panels[k].open = true;
    panels[k].querySelector('summary').focus();
  });
  $('directory-curriculum').addEventListener('change', () => {
    preferredFilter = $('directory-curriculum').value;
    if (state[c].ready) listCourses();
  });
  for (const field of ['level', 'sem']) get(c, field).addEventListener('change', () => void load(c));
})();
