/* Shared date-only presentation. The API supplies today's Lagos school date. No browser timezone arithmetic. */
(() => {
  'use strict';
  const dayMs = 86400000;
  const session = (y) => `${y}/${y + 1}`;
  const semester = (n) => (n === 1 ? 'First semester' : 'Second semester');
  function day(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return NaN;
    const ms = Date.parse(`${s}T00:00:00Z`);
    return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === s ? ms / dayMs : NaN;
  }
  function year(s) {
    const m = /^(\d{4})\/(\d{4})$/.exec(s);
    return m && +m[1] >= 2000 && +m[1] <= 9998 && +m[2] === +m[1] + 1 ? +m[1] : null;
  }
  function problem(t) {
    if (!t || !Number.isInteger(t.session_year) || !year(session(t.session_year)))
      return 'Use consecutive session years, for example 2026/2027.';
    if (![1, 2].includes(t.semester)) return 'Choose the first or second semester.';
    const dates = [t.semester_start, t.exam_start, t.exam_end].map(day);
    if (!dates.every(Number.isFinite) || dates[0] < day('1900-01-01')) return 'Enter all three valid dates.';
    if (dates[1] < dates[0]) return 'Exams cannot start before the semester starts.';
    if (dates[2] < dates[1]) return 'Exam end cannot be before exam start.';
    return '';
  }
  function validCalendar(data) {
    return (
      !!data &&
      typeof data.can_manage === 'boolean' &&
      Number.isFinite(day(data.today)) &&
      (data.term === null ||
        (!!data.term &&
          !problem(data.term) &&
          Number.isInteger(data.term.revision) &&
          data.term.revision > 0))
    );
  }
  const duration = (n) => `${n} ${n === 1 ? 'day' : 'days'}`;
  function view(t, today) {
    if (problem(t) || !Number.isFinite(day(today))) return null;
    const [start, exams, end, now] = [t.semester_start, t.exam_start, t.exam_end, today].map(day);
    const percent =
      now < start ? 0 : now >= end ? 100 : Math.min(99, Math.round(((now - start) * 100) / (end - start)));
    let message;
    if (now < start) message = `Semester starts in ${duration(start - now)}`;
    else if (now < exams) message = `Exams start in ${duration(exams - now)}`;
    else if (now === end) message = 'Final exam day · semester ends today';
    else if (now <= end)
      message = `${now === exams ? 'Exams start today' : 'Exams in progress'} · ${duration(end - now)} until semester end`;
    else message = 'Semester complete · exams have ended';
    return { percent, message, session: session(t.session_year), semester: semester(t.semester) };
  }
  function phrase(t, revision) {
    return `i ${revision ? 'update' : 'publish'} ${session(t.session_year)} ${semester(t.semester).toLowerCase()}`;
  }
  function pretty(s) {
    return Number.isFinite(day(s))
      ? new Intl.DateTimeFormat('en-GB', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          timeZone: 'UTC',
        }).format(day(s) * dayMs)
      : '—';
  }
  window.LegalHubTerm = Object.freeze({
    day,
    year,
    session,
    semester,
    problem,
    validCalendar,
    view,
    phrase,
    pretty,
  });
})();
