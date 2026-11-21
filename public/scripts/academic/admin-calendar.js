(() => {
  'use strict';
  const T = window.LegalHubTerm,
    $ = (id) => document.getElementById(id);
  const form = $('calendar-form'),
    fields = $('calendar-fields'),
    gate = $('settings-gate'),
    workspace = $('settings-workspace');
  const names = ['cal-session', 'cal-semester', 'cal-start', 'cal-exams', 'cal-end'];
  let epoch = 0,
    owner = null,
    published = null,
    today = '',
    locked = true;
  function close(message, retry = false) {
    ++epoch;
    owner = null;
    published = null;
    today = '';
    locked = true;
    form.reset();
    fields.disabled = true;
    $('cal-confirm').value = '';
    $('cal-status').textContent = '';
    workspace.hidden = true;
    window.LHWorkspace?.session(null);
    gate.hidden = false;
    gate.textContent = message;
    $('gate-retry').hidden = !retry;
  }
  function draft() {
    return {
      session_year: T.year($('cal-session').value),
      semester: Number($('cal-semester').value),
      semester_start: $('cal-start').value,
      exam_start: $('cal-exams').value,
      exam_end: $('cal-end').value,
    };
  }
  function revision() {
    return published?.revision || 0;
  }
  function reflect(clear) {
    const t = draft(),
      issue = T.problem(t),
      v = T.view(t, today);
    const same = published && Object.entries(t).every(([k, val]) => val === published[k]);
    if (clear) {
      $('cal-confirm').value = '';
      $('cal-status').textContent = '';
    }
    $('cal-phrase').textContent = issue ? 'Complete the term details first.' : T.phrase(t, revision());
    $('cal-preview').textContent =
      issue ||
      (same
        ? 'These dates already match the published calendar.'
        : `Common room preview: ${v?.message || '—'}.`);
    $('cal-confirm').disabled = locked || !!issue || !!same;
    $('cal-save').disabled = $('cal-confirm').disabled || $('cal-confirm').value !== T.phrase(t, revision());
    $('cal-save').textContent = published ? 'Update calendar' : 'Publish calendar';
  }
  function render(t) {
    published = t;
    $('published-session').textContent = t ? T.session(t.session_year) : 'No active term';
    $('published-semester').textContent = t ? T.semester(t.semester) : 'No dates published yet.';
    for (const [field, k] of [
      ['start', 'semester_start'],
      ['exams', 'exam_start'],
      ['end', 'exam_end'],
    ])
      $('published-' + field).textContent = T.pretty(t?.[k]);
    $('cal-session').value = t ? T.session(t.session_year) : '';
    $('cal-semester').value = t ? String(t.semester) : '';
    $('cal-start').value = t?.semester_start || '';
    $('cal-exams').value = t?.exam_start || '';
    $('cal-end').value = t?.exam_end || '';
    fields.disabled = locked = false;
    $('cal-reload').hidden = true;
    $('cal-confirm').value = '';
    reflect(false);
    gate.hidden = true;
    $('gate-retry').hidden = true;
    workspace.hidden = false;
    window.LHWorkspace?.session(owner);
  }
  async function load(message = '') {
    close('Checking administrator access…');
    const ticket = epoch;
    try {
      const identity = await supabaseClient.auth.getUser();
      if (epoch !== ticket) return;
      const id = identity.data?.user?.id;
      if (identity.error || !id) {
        close('Sign in to continue.');
        return;
      }
      const { data, error } = await supabaseClient.rpc('get_academic_calendar');
      if (epoch !== ticket) return;
      if (error || !T.validCalendar(data)) throw Error();
      if (data.can_manage !== true) {
        close('This page is available only to LegalHub administrators.');
        return;
      }
      owner = id;
      today = data.today;
      render(data.term || null);
      $('cal-status').textContent = message;
      if (message) $('panel-term').open = true;
    } catch {
      if (epoch === ticket) close('Could not verify settings access or load the calendar.', true);
    }
  }
  for (const id of names) $(id).addEventListener('input', () => reflect(true));
  $('cal-confirm').addEventListener('input', () => reflect(false));
  $('cal-reload').addEventListener('click', () => void load());
  $('gate-retry').addEventListener('click', () => void load());
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const t = draft(),
      rev = revision(),
      confirmation = $('cal-confirm').value;
    if (
      locked ||
      !owner ||
      workspace.hidden ||
      $('cal-save').disabled ||
      T.problem(t) ||
      confirmation !== T.phrase(t, rev)
    )
      return;
    const ticket = epoch;
    fields.disabled = locked = true;
    $('cal-status').textContent = 'Saving calendar…';
    try {
      const identity = await supabaseClient.auth.getUser();
      if (epoch !== ticket) return;
      if (identity.error || identity.data?.user?.id !== owner) {
        close('Your account changed. Recheck access.', true);
        return;
      }
      const result = await supabaseClient.rpc('save_academic_calendar', {
        p_session_year: t.session_year,
        p_semester: t.semester,
        p_semester_start: t.semester_start,
        p_exam_start: t.exam_start,
        p_exam_end: t.exam_end,
        p_expected_revision: rev,
        p_confirmation: confirmation,
      });
      if (epoch !== ticket) return;
      if (result.error?.code === '42501') {
        close('Administrator access is no longer available.');
        return;
      }
      if (result.error?.code === '40001') {
        $('cal-status').textContent =
          'Another administrator changed the calendar. Reload and review the latest dates.';
      } else if (result.error || result.data !== rev + 1) {
        throw Error();
      } else {
        await load('Calendar saved. The common room now uses the published dates.');
        return;
      }
    } catch {
      if (epoch !== ticket) return;
      $('cal-status').textContent = 'Save not confirmed. Reload the published calendar before trying again.';
    }
    if (epoch === ticket) {
      $('cal-confirm').value = '';
      $('cal-reload').hidden = false;
    }
  });
  if (typeof supabaseClient === 'undefined' || !supabaseClient || !T) {
    close('Settings are temporarily unavailable.', true);
    return;
  }
  supabaseClient.auth.onAuthStateChange((event, s) => {
    if (event === 'SIGNED_OUT') close('Your session ended.');
    if (event === 'SIGNED_IN' && (!owner || s?.user?.id !== owner)) {
      close('Checking administrator access…');
      setTimeout(() => void load(), 0);
    }
  });
  let checking = false;
  async function recheck() {
    if (!owner || locked || checking || document.hidden) return;
    const ticket = epoch;
    checking = true;
    try {
      const { data, error } = await supabaseClient.rpc('get_academic_calendar');
      if (epoch !== ticket || locked) return;
      if (error || !T.validCalendar(data)) throw Error();
      if (data.can_manage !== true) {
        close('Administrator access is no longer available.');
        return;
      }
      if ((data.term?.revision || 0) !== revision()) {
        locked = fields.disabled = true;
        $('cal-confirm').value = '';
        $('cal-reload').hidden = false;
        $('cal-status').textContent = 'The published dates changed. Reload the calendar before editing.';
      } else if (data.today !== today) {
        today = data.today;
        reflect(false);
      }
    } catch {
      if (epoch === ticket && !locked) close('Could not recheck administrator access.', true);
    } finally {
      checking = false;
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void recheck();
  });
  window.addEventListener('focus', recheck);
  setInterval(recheck, 60000);
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) void load();
  });
  void load();
})();
