import { LEVELS, TERMS, selection, termTitle, deskHref, libraryHref, createSource } from './desk-data.mjs';

async function readJSON(name) {
  const url = new URL('../../data/semester-desks/' + name, import.meta.url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      credentials: 'omit',
      cache: 'no-cache',
      redirect: 'error',
    });
    if (!res.ok) throw new Error('Course data unavailable');
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

// Bind once to the enduring shell. Course/term data is never parsed as HTML.
export function mountDesk(loadDesk = createSource(readJSON)) {
  const $ = (id) => document.getElementById(id),
    frame = $('semester-desk'),
    rows = $('course-rows'),
    input = $('search');
  if (!frame || frame.dataset.mounted) return;
  frame.dataset.mounted = 'true';
  const visibleWhenListed = [...frame.querySelectorAll('[data-listed]')];
  const semesterNav = frame.querySelector('.desk-tabs');
  const tabs = [...semesterNav.querySelectorAll('a[data-term]')];
  const memory = new Map(),
    byId = new Map();
  let route = null,
    shelf = null,
    epoch = 0,
    previousSearch = null,
    toastClock;
  const clone = (id) => $(id).content.firstElementChild.cloneNode(true);
  const put = (o, sel, value) => {
    o.querySelector(sel).textContent = value;
  };
  const scrollMode = () => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth');
  function destination(a, href) {
    a.setAttribute('href', href);
    if (href.startsWith('https://')) {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    }
  }
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastClock);
    toastClock = setTimeout(() => el.classList.remove('show'), 1800);
  }
  function clearContents() {
    for (const el of visibleWhenListed) el.hidden = true;
    for (const id of ['course-rows', 'desk-routes', 'desk-index-row', 'recent-row', 'starred-row'])
      $(id).replaceChildren();
    for (const id of ['recent-panel', 'starred-panel']) $(id).hidden = true;
    frame.querySelectorAll('button.chip[data-filter]').forEach((el) => el.remove());
    input.value = '';
    $('search-meta').textContent = '';
    $('search-meta').classList.remove('active');
    $('no-results').classList.remove('active');
    $('desk-count').textContent = '—';
    $('desk-badge-count').textContent = '—';
    clearTimeout(toastClock);
    $('toast').textContent = '';
    $('toast').classList.remove('show');
    byId.clear();
    shelf = null;
  }
  function message(state, title, detail) {
    frame.dataset.state = state;
    $('desk-message').hidden = false;
    $('desk-message-title').textContent = title;
    $('desk-message-detail').textContent = detail;
    $('desk-retry').hidden = state !== 'error';
    $('desk-announcement').textContent = title;
    rows.setAttribute('aria-busy', String(state === 'loading'));
  }
  function setTabs() {
    semesterNav.hidden = !route;
    semesterNav.setAttribute(
      'aria-label',
      route ? `Semesters for ${route.level}` : 'Semesters for this level',
    );
    for (const a of tabs) {
      if (route) a.href = deskHref({ level: route.level, semester: a.dataset.term });
      else a.removeAttribute('href');
      if (route && route.semester === a.dataset.term) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
  }
  function identify() {
    const name = route ? `${route.level} ${termTitle(route.semester)}` : 'Semester study desk';
    document.title = `${name} · Legal Hub`;
    frame.querySelector('.level-intro').dataset.level = route?.level || '';
    frame.querySelector('.level-kicker').textContent = route
      ? `${route.level} / ${termTitle(route.semester).toUpperCase()}`
      : 'SEMESTER STUDY DESK';
    frame.querySelector('.level-description').textContent = route
      ? 'Courses and study resources for this semester.'
      : 'Choose your level and semester on the home page.';
    frame.querySelector('.stat-row').setAttribute('aria-label', name + ' study overview');
    $('desk-year').textContent = route ? '0' + (LEVELS.indexOf(route.level) + 1) : '—';
    setTabs();
    $('desk-self').href = route ? deskHref(route) : './semester.html';
    for (const a of frame.querySelectorAll('[data-library]'))
      a.href = route ? libraryHref(route) : './pdf.html';
    $('desk-message-link').textContent = route ? 'Browse this semester’s library' : 'Browse the library';
  }
  function resource(row) {
    const li = clone('tpl-resource');
    li.dataset.name = row.label;
    let label = li.querySelector('.res-name');
    if (row.href) {
      const a = document.createElement('a');
      a.className = 'res-name';
      destination(a, row.href);
      label.replaceWith(a);
      label = a;
    }
    label.textContent = row.label;
    const count = li.querySelector('.res-count');
    if (row.count !== undefined) {
      count.textContent = row.count;
      count.classList.toggle('live', row.live === true);
    } else count.remove();
    const copy = li.querySelector('.copy-btn');
    if (row.copy) {
      copy.dataset.url = row.href;
      copy.setAttribute('aria-label', `Copy ${row.label} link`);
    } else copy.remove();
    if (row.count === undefined && !row.copy) li.querySelector('.res-right').remove();
    return li;
  }
  function course(c) {
    const el = clone('tpl-course');
    el.dataset.name = c.name;
    el.dataset.courseId = c.id;
    const title = 'title-' + c.id,
      body = 'body-' + c.id;
    el.setAttribute('aria-labelledby', title);
    el.querySelector('.course-name').id = title;
    const toggle = el.querySelector('.course-toggle');
    toggle.textContent = c.title;
    toggle.setAttribute('aria-controls', body);
    el.querySelector('.course-body').id = body;
    el.querySelector('.swatch').style.backgroundColor = c.accent;
    if (c.code) put(el, '.course-code', c.code);
    else el.querySelector('.course-code').remove();
    const badge = el.querySelector('.pill');
    if (c.badge) {
      badge.textContent = c.badge;
      badge.classList.toggle('has-content', c.badgeActive === true);
    } else badge.remove();
    const star = el.querySelector('.star-btn');
    star.setAttribute('aria-label', 'Star ' + c.name);
    star.setAttribute('aria-pressed', String(shelf.starred.has(c.id)));
    star.classList.toggle('starred', shelf.starred.has(c.id));
    if (c.resources.length) {
      el.querySelector('.resources').append(...c.resources.map(resource));
      el.querySelector('[data-no-resources]').remove();
    } else el.querySelector('.resources').remove();
    if (c.request) {
      const req = el.querySelector('.request-btn');
      req.dataset.course = c.name;
      req.href =
        'mailto:hillarymmaka@gmail.com?subject=' +
        encodeURIComponent('Course material request — ' + c.name) +
        '&body=' +
        encodeURIComponent(
          `Hi,\n\nCould we get materials uploaded for ${c.name} (030 Legal Hub)?\n\nThanks!`,
        );
    } else el.querySelector('.empty-state').remove();
    byId.set(c.id, { c, el });
    return el;
  }
  function tile(id, star = false) {
    const { c } = byId.get(id),
      el = clone('tpl-tile');
    el.dataset.jump = c.name;
    el.dataset.jumpId = c.id;
    put(el, '.thumb-sq', c.tileCode);
    put(el, '.thumb-label', c.name);
    el.querySelector('.thumb-sq').style.backgroundColor = c.accent;
    if (star) {
      const badge = document.createElement('span');
      badge.className = 'star-badge';
      badge.setAttribute('aria-hidden', 'true');
      badge.textContent = '⭐';
      el.append(badge);
    }
    return el;
  }
  function shelves() {
    const starred = [...shelf.starred].filter((id) => byId.has(id)),
      recent = shelf.recent.filter((id) => byId.has(id));
    $('starred-row').replaceChildren(...starred.map((id) => tile(id, true)));
    $('recent-row').replaceChildren(...recent.map((id) => tile(id)));
    $('starred-panel').hidden = !starred.length;
    $('recent-panel').hidden = !recent.length;
    $('starred-sub').textContent = `${starred.length} course${starred.length === 1 ? '' : 's'} starred`;
  }
  function remember(id) {
    shelf.recent = [id, ...shelf.recent.filter((x) => x !== id)].slice(0, 5);
    shelves();
  }
  function open(el, yes) {
    el.classList.toggle('open', yes);
    el.querySelector('.course-toggle').setAttribute('aria-expanded', String(yes));
  }
  function chip(value) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'chip';
    el.dataset.filter = value;
    el.textContent = value === 'Past questions' ? 'Past Qs' : value === 'Test' ? 'Tests' : value || 'All';
    el.classList.toggle('active', !value);
    el.setAttribute('aria-pressed', String(!value));
    return el;
  }
  function render(data) {
    const key = deskHref(route);
    if (!memory.has(key)) memory.set(key, { starred: new Set(), recent: [] });
    shelf = memory.get(key);
    rows.replaceChildren(...data.courses.map(course));
    $('desk-index-row').replaceChildren(...data.order.map((id) => tile(id)));
    $('desk-routes').replaceChildren(
      ...data.routes.map((g, i) => {
        const el = clone('tpl-route');
        el.classList.add('route-' + g.tone);
        destination(el, g.href);
        put(el, '.route-number', String(i + 1).padStart(2, '0'));
        put(el, 'strong', g.title);
        put(el, 'small', g.note);
        return el;
      }),
    );
    const leading = ['Cases', 'Past questions'],
      anchor = $('library-chip');
    anchor.before(chip(''), ...leading.filter((l) => data.filters.includes(l)).map(chip));
    anchor.after(...data.filters.filter((l) => !leading.includes(l)).map(chip));
    $('desk-count').textContent = data.courses.length;
    $('desk-badge-count').textContent = data.courses.length;
    for (const el of visibleWhenListed) el.hidden = false;
    shelves();
    $('desk-message').hidden = true;
    rows.setAttribute('aria-busy', 'false');
    frame.dataset.state = 'ready';
    $('desk-announcement').textContent =
      `${route.level}, ${termTitle(route.semester)}: ${data.courses.length} courses listed.`;
  }
  function restoreFragment(ticket) {
    const tags = {
      '#courses': 'courses',
      '#courses-head': 'courses-head',
      '#contact': 'contact',
      '#search': 'search',
    };
    const key = tags[location.hash];
    if (!key) return;
    requestAnimationFrame(() => {
      if (ticket !== epoch) return;
      const target = frame.dataset.state !== 'ready' && key !== 'contact' ? $('desk-message') : $(key);
      target.scrollIntoView({ block: 'start', behavior: 'instant' });
    });
  }
  async function readAddress(force = false) {
    if (!force && location.search === previousSearch) return;
    previousSearch = location.search;
    const ticket = ++epoch;
    route = selection(location.search);
    clearContents();
    identify();
    if (!route) {
      message(
        'choose',
        'No study desk selected',
        'Use Switch level to return to the home page, where you can choose a level and semester.',
      );
      return;
    }
    message('loading', 'Loading this semester’s courses…', `${route.level} · ${termTitle(route.semester)}`);
    try {
      const result = await loadDesk(route);
      if (ticket !== epoch) return;
      frame.querySelector('.level-description').textContent = result.intro;
      if (result.published) render(result);
      else {
        $('desk-count').textContent = '0';
        message(
          'unpublished',
          'Course list not published yet',
          `Courses for ${route.level}, ${termTitle(route.semester).toLowerCase()}, have not been listed. You can still browse the semester’s library.`,
        );
      }
      restoreFragment(ticket);
    } catch {
      if (ticket !== epoch) return;
      clearContents();
      message(
        'error',
        'Couldn’t load this course list',
        'Check your connection and try again, or continue to the library.',
      );
      restoreFragment(ticket);
    }
  }
  // Levels are chosen on Home. Only the semester changes in this document.
  function switchSemester(semester) {
    if (!route || !TERMS.includes(semester) || route.semester === semester) return;
    const next = { level: route.level, semester };
    history.pushState(null, '', deskHref(next));
    void readAddress();
  }
  function highlight(el, query) {
    if (!el) return;
    const text = el.textContent;
    if (!query) {
      if (el.querySelector('mark')) el.textContent = text;
      return;
    }
    const re = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const fragment = document.createDocumentFragment();
    let end = 0;
    for (const hit of text.matchAll(re)) {
      fragment.append(text.slice(end, hit.index));
      const mark = document.createElement('mark');
      mark.textContent = hit[0];
      fragment.append(mark);
      end = hit.index + hit[0].length;
    }
    if (end) {
      fragment.append(text.slice(end));
      el.replaceChildren(fragment);
    } else if (el.querySelector('mark')) el.textContent = text;
  }
  function search() {
    const q = input.value.trim().toLowerCase();
    let hits = 0,
      resources = 0;
    for (const { c, el } of byId.values()) {
      const whole = [c.name, c.title, c.code || ''].some((s) => s.toLowerCase().includes(q));
      let rowHit = false;
      highlight(el.querySelector('.course-toggle'), q);
      highlight(el.querySelector('.course-code'), q);
      for (const li of el.querySelectorAll('.resources li')) {
        const found = !!q && li.dataset.name.toLowerCase().includes(q);
        rowHit ||= found;
        if (found) resources++;
        li.hidden = !(whole || found);
        highlight(li.querySelector('.res-name'), q);
      }
      el.hidden = !(whole || rowHit);
      if (!el.hidden) {
        hits++;
        if (q) open(el, true);
      }
    }
    for (const b of frame.querySelectorAll('button.chip[data-filter]')) {
      const on = b.dataset.filter.toLowerCase() === q;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    }
    $('search-meta').classList.toggle('active', !!q);
    $('no-results').classList.toggle('active', !!q && !hits);
    $('search-meta').textContent = !q
      ? ''
      : !hits
        ? 'No matches'
        : `${hits} course${hits === 1 ? '' : 's'}, ${resources} matching resource${resources === 1 ? '' : 's'}`;
  }
  // Delegation covers newly injected courses and shelf tiles; switching terms never adds listeners.
  frame.addEventListener('click', async (event) => {
    const t = event.target,
      tab = t.closest('.desk-tabs a');
    if (tab) {
      if (
        !tab.hasAttribute('href') ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      event.preventDefault();
      switchSemester(tab.dataset.term);
      return;
    }
    if (t.closest('#desk-retry')) {
      const focusTarget =
        semesterNav.querySelector('[aria-current="page"]') || frame.querySelector('.level-switch');
      focusTarget.focus({ preventScroll: true });
      void readAddress(true);
      return;
    }
    if (frame.dataset.state !== 'ready') return;
    const filter = t.closest('button.chip[data-filter]');
    if (filter) {
      input.value = filter.dataset.filter;
      search();
      $('courses').scrollIntoView({ block: 'start', behavior: scrollMode() });
      return;
    }
    const jump = t.closest('[data-jump-id]');
    if (jump) {
      const id = jump.dataset.jumpId,
        entry = byId.get(id);
      if (!entry) return;
      input.value = '';
      search();
      open(entry.el, true);
      remember(id);
      entry.el.querySelector('.course-toggle').focus({ preventScroll: true });
      // Align the opened card's title below the header, not the centre of a potentially tall card.
      const header = frame.querySelector('.sticky-header');
      const cover = header && getComputedStyle(header).position === 'sticky' ? header.offsetHeight : 0;
      window.scrollBy({ top: entry.el.getBoundingClientRect().top - cover - 8, behavior: scrollMode() });
      return;
    }
    const el = t.closest('.course');
    if (!el) return;
    const id = el.dataset.courseId;
    const star = t.closest('.star-btn');
    if (star) {
      const add = !shelf.starred.has(id);
      if (add) shelf.starred.add(id);
      else shelf.starred.delete(id);
      star.classList.toggle('starred', add);
      star.setAttribute('aria-pressed', String(add));
      shelves();
      toast(add ? 'Starred ' + el.dataset.name : 'Removed ' + el.dataset.name + ' from starred');
      return;
    }
    if (t.closest('.course-head-left,.chevron')) {
      const now = !el.classList.contains('open');
      open(el, now);
      if (now) remember(id);
      return;
    }
    const copy = t.closest('.copy-btn');
    if (copy) {
      const ticket = epoch;
      try {
        await navigator.clipboard.writeText(new URL(copy.dataset.url, document.baseURI).href);
        if (ticket === epoch) toast('Link copied');
      } catch {
        if (ticket === epoch) toast('Could not copy — long-press the link instead');
      }
    }
  });
  input.addEventListener('input', search);
  document.addEventListener('keydown', (e) => {
    if (frame.dataset.state !== 'ready' || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === '/' && !e.target.closest('select,input,textarea,[contenteditable="true"]')) {
      e.preventDefault();
      input.focus();
    }
    if (e.key === 'Escape' && document.activeElement === input) {
      input.value = '';
      search();
      input.blur();
    }
  });
  window.addEventListener('popstate', () => void readAddress());
  // A desk can stay open across many term changes. On account loss/switch or a
  // restored document, let the established guard recheck this exact URL.
  const client = typeof supabaseClient === 'undefined' ? null : supabaseClient;
  const auth = client?.auth;
  let account = null,
    leaving = false,
    nav = null,
    navReader = null;
  // Navigation is an enhancement: a cached old shell or a missing nav asset must
  // never block the course directory. Native links and overflow work without it.
  if ($('desk-admin-link')) {
    import('./desk-nav.mjs').then(({ mountDeskNavigation }) => {
      if (leaving) return;
      nav = mountDeskNavigation(frame, client);
      nav.session(navReader);
    }).catch(() => { /* The optional admin entry stays hidden. */ });
  }
  function recheckAccount() {
    if (leaving) return;
    leaving = true;
    navReader = null;
    nav?.session(null);
    ++epoch;
    document.documentElement.style.visibility = 'hidden';
    clearContents();
    memory.clear();
    setTimeout(() => location.reload(), 0);
  }
  auth?.onAuthStateChange?.((event, session) => {
    if (leaving) return;
    const id = session?.user?.id;
    if (event === 'SIGNED_OUT' || (event === 'INITIAL_SESSION' && !id) || (id && account && id !== account)) {
      recheckAccount();
      return;
    }
    if (id) account = id;
    navReader = id || null;
    nav?.session(navReader);
  });
  window.addEventListener('pageshow', (e) => {
    if (e.persisted && auth) recheckAccount();
  });
  void readAddress();
}

// The existing account guard owns authentication and returns the reader to this URL.
// Do not start the catalogue request while that guard is holding a signed-out visit.
function afterGuard() {
  if (!document.getElementById('auth-page-blocker')) {
    mountDesk();
    return;
  }
  const watch = new MutationObserver(() => {
    if (!document.getElementById('auth-page-blocker')) {
      watch.disconnect();
      mountDesk();
    }
  });
  watch.observe(document.head, { childList: true });
}
afterGuard();
