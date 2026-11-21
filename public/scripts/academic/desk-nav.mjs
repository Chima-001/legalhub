// Visibility is a navigation hint only. The destination and the save RPC authorize independently.
export function createAdminLinkGate({ read, valid, visible, show }) {
  let owner = null,
    epoch = 0,
    timer,
    deadline,
    pending = false;
  function check(reset) {
    const ticket = ++epoch,
      account = owner;
    clearTimeout(timer);
    clearTimeout(deadline);
    pending = false;
    if (reset) show(false);
    if (!account || !visible()) return;
    pending = true;
    // Auth callbacks stay synchronous. Never call back into the SDK while it holds its auth lock.
    timer = setTimeout(async () => {
      try {
        if (ticket !== epoch || !visible()) return;
        // A hung background recheck must not keep a previously shown link on screen indefinitely.
        deadline = setTimeout(() => {
          if (ticket !== epoch) return;
          ++epoch;
          pending = false;
          show(false);
        }, 10000);
        const { data, error } = await read();
        if (ticket === epoch && owner === account && visible()) {
          show(!error && valid(data) && data.can_manage === true);
        }
      } catch {
        if (ticket === epoch) show(false);
      } finally {
        if (ticket === epoch) {
          clearTimeout(deadline);
          pending = false;
        }
      }
    }, 0);
  }
  return {
    refresh: () => check(true),
    poll() {
      // Same foreground account: do not flicker the rail or discard keyboard focus on a healthy refresh.
      if (!pending && owner && visible()) check(false);
    },
    session(id) {
      owner = typeof id === 'string' && id ? id : null;
      check(true);
    },
  };
}

function bindRail(frame) {
  const track = frame.querySelector('#desk-nav-links'),
    steps = frame.querySelector('#desk-nav-steps');
  const header = frame.querySelector('.sticky-header');
  const back = steps?.querySelector('[data-step="-1"]'),
    next = steps?.querySelector('[data-step="1"]');
  if (!track || !header || !back || !next) return () => {};
  const narrow = matchMedia('(max-width: 699px)'),
    still = matchMedia('(prefers-reduced-motion: reduce)');
  let pending = 0;
  function measure() {
    pending = 0;
    const max = Math.max(0, track.scrollWidth - track.clientWidth);
    steps.hidden = !narrow.matches || max < 2;
    // aria-disabled preserves keyboard focus when the last scroll step reaches the end.
    back.setAttribute('aria-disabled', String(track.scrollLeft <= 1));
    next.setAttribute('aria-disabled', String(track.scrollLeft >= max - 1));
    const offset =
      getComputedStyle(header).position === 'sticky' ? Math.ceil(header.getBoundingClientRect().height) + 8 : 8;
    frame.style.setProperty('--desk-header-offset', `${offset}px`);
  }
  function schedule() {
    if (!pending) pending = requestAnimationFrame(measure);
  }
  steps.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-step]');
    if (!button || button.getAttribute('aria-disabled') === 'true') return;
    track.scrollBy({
      left: Number(button.dataset.step) * track.clientWidth * 0.8,
      behavior: still.matches ? 'instant' : 'smooth',
    });
  });
  // Some browsers consider a partly clipped link visible when tabbing to it. Reveal its
  // whole label without moving the document or the user's focus.
  track.addEventListener('focusin', ({ target }) => {
    const link = target.closest('a[href]');
    if (!link) return;
    const box = track.getBoundingClientRect(),
      item = link.getBoundingClientRect();
    const left = item.left - box.left - 4,
      right = item.right - box.right + 4;
    if (left < 0 || right > 0) track.scrollBy({ left: left < 0 ? left : right, behavior: 'instant' });
  });
  track.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule, { passive: true });
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(schedule);
    for (const el of [track, header, ...track.children]) observer.observe(el);
  }
  document.fonts?.ready.then(schedule);
  schedule();
  return schedule;
}

// Called once, after the desk's existing sign-in guard reveals the document, not on term switches.
export function mountDeskNavigation(frame, client) {
  const measure = bindRail(frame),
    link = frame.querySelector('#desk-admin-link');
  const access = createAdminLinkGate({
    read: () => client.rpc('get_academic_calendar'),
    valid: (data) => window.LegalHubTerm?.validCalendar(data) === true,
    visible: () => !document.hidden,
    show(yes) {
      if (link.hidden !== !yes) {
        link.hidden = !yes;
        measure();
      }
    },
  });
  document.addEventListener('visibilitychange', access.refresh);
  // Same cadence as Home while the page remains open; no read for a hidden or signed-out tab.
  window.setInterval(access.poll, 60000);
  window.addEventListener('pagehide', () => access.session(null));
  return access;
}
