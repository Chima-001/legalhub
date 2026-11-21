(() => {
  'use strict';
  if (document.documentElement.dataset.signupHandoff === '1') return;
  const $ = (id) => document.getElementById(id);
  const link = $('calendar-settings-nav'),
    meter = $('term-meter');
  let epoch = 0,
    busy = false;
  // Never change an explicit semester URL. The current published link may also fill its level card.
  function deskTerm(term) {
    const hint = $('desk-term-hint');
    if (!hint) return; // A cached older homepage still gets its calendar strip.
    if (term === 1 || term === 2) {
      const word = term === 1 ? 'first' : 'second';
      document.documentElement.dataset.deskSemester = word;
      hint.textContent = `Select a level for the published ${word} semester, or choose either semester below.`;
    } else {
      delete document.documentElement.dataset.deskSemester;
      hint.textContent = 'Choose a semester for any level.';
    }
  }
  function empty(message) {
    deskTerm(null);
    $('term-label').textContent = 'Academic calendar';
    $('term-session').textContent = '';
    $('term-countdown').textContent = message;
    $('term-percent').textContent = '';
    meter.hidden = true;
    meter.removeAttribute('aria-valuenow');
    $('term-fill').style.width = '0%';
  }
  async function refresh() {
    if (busy || document.hidden) return;
    const current = epoch;
    busy = true;
    try {
      const { data, error } = await supabaseClient.rpc('get_academic_calendar');
      if (current !== epoch) return;
      if (error || !window.LegalHubTerm.validCalendar(data)) throw Error('unavailable');
      link.hidden = data.can_manage !== true;
      if (!data.term) {
        empty('Semester dates have not been published yet.');
        return;
      }
      const v = window.LegalHubTerm.view(data.term, data.today);
      if (!v) throw Error('unavailable');
      deskTerm(data.term.semester);
      $('term-label').textContent = v.semester;
      $('term-session').textContent = v.session;
      $('term-countdown').textContent = v.message;
      $('term-percent').textContent = `${v.percent}% through`;
      meter.hidden = false;
      meter.setAttribute('aria-valuenow', String(v.percent));
      $('term-fill').style.width = `${v.percent}%`;
    } catch {
      if (current === epoch) {
        link.hidden = true;
        empty('Calendar temporarily unavailable.');
      }
    } finally {
      if (current === epoch) busy = false;
    }
  }
  if (typeof supabaseClient === 'undefined' || !supabaseClient) {
    empty('Calendar temporarily unavailable.');
    return;
  }
  supabaseClient.auth.onAuthStateChange((event) => {
    if (event !== 'SIGNED_OUT' && event !== 'SIGNED_IN') return;
    ++epoch;
    busy = false;
    link.hidden = true;
    empty('Loading the academic calendar…');
    if (event === 'SIGNED_IN') setTimeout(refresh, 0);
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void refresh();
  });
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) {
      ++epoch;
      busy = false;
      link.hidden = true;
      empty('Loading the academic calendar…');
      void refresh();
    }
  });
  setInterval(refresh, 60000);
  void refresh();
})();
