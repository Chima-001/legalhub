(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const select = $('level-select'),
    begin = $('save-level-btn'),
    review = $('level-review');
  const confirmation = $('level-confirm'),
    apply = $('level-apply'),
    cancel = $('level-cancel'),
    status = $('level-status');
  let year = null,
    uid = null,
    busy = false,
    epoch = 0;
  const levels = ['100L', '200L', '300L', '400L', '500L'];
  const session = () => `${year}/${year + 1}`;
  const phrase = () => `i update ${select.value} for ${session()}`;
  function hideReview() {
    review.hidden = true;
    confirmation.value = '';
    apply.disabled = true;
  }
  async function load(message = '') {
    const current = ++epoch;
    uid = null;
    year = null;
    busy = false;
    select.disabled = begin.disabled = true;
    hideReview();
    $('display-level').textContent = 'Loading…';
    $('level-session-hint').textContent = 'Loading the academic session…';
    status.textContent = message;
    try {
      const identity = await supabaseClient.auth.getUser();
      const id = identity.data?.user?.id;
      if (!id || identity.error) throw Error('unavailable');
      const { data, error } = await supabaseClient.rpc('get_my_level_context');
      if (current !== epoch) return;
      if (error || !data || !Number.isInteger(data.assignment_year) || data.assignment_year < 2000 || data.assignment_year > 9998) {
        // Staged rollout: use the old read RPC if needed, never fall back to an unchecked write.
        const legacy = await supabaseClient.rpc('get_effective_level', { p_uid: id });
        if (current !== epoch) return;
        $('display-level').textContent = !legacy.error && levels.includes(legacy.data) ? legacy.data : 'Unavailable';
        $('level-session-hint').textContent = ['PGRST202', '42883'].includes(error?.code)
          ? 'Level editing is unavailable until the site enables or refreshes the level service. Your level has not been changed.'
          : 'Level editing is unavailable because your session could not be verified. Reconnect and reload Profile to retry.';
        return;
      }
      if (data.account_id !== id) throw Error('changed');
      uid = id;
      year = data.assignment_year;
      $('display-level').textContent = data.level || 'Not set';
      select.value = levels.includes(data.level) ? data.level : '';
      $('level-session-hint').textContent =
        `Choose your current level for the ${session()} session.`;
      select.disabled = false;
      begin.disabled = !levels.includes(select.value);
    } catch {
      if (current === epoch) {
        $('display-level').textContent = 'Unavailable';
        $('level-session-hint').textContent = 'Could not load your academic level. Reload to retry.';
      }
    }
  }
  select.addEventListener('change', () => {
    hideReview();
    begin.disabled = !year || !levels.includes(select.value);
    status.textContent = '';
  });
  begin.addEventListener('click', () => {
    if (busy || !uid || !year || !levels.includes(select.value)) return;
    confirmation.value = '';
    apply.disabled = true;
    $('level-phrase').textContent = phrase();
    review.hidden = false;
    confirmation.focus();
  });
  cancel.addEventListener('click', () => {
    hideReview();
    begin.focus();
  });
  confirmation.addEventListener('input', () => {
    apply.disabled = busy || confirmation.value !== phrase();
  });
  apply.addEventListener('click', async () => {
    if (
      busy ||
      !uid ||
      !year ||
      review.hidden ||
      confirmation.value !== phrase() ||
      !levels.includes(select.value)
    )
      return;
    const snapshot = epoch,
      expectedUid = uid;
    const args = {
      p_level: select.value,
      p_session_year: year,
      p_confirmation: confirmation.value,
      p_expected_uid: expectedUid,
    };
    busy = true;
    select.disabled = begin.disabled = apply.disabled = cancel.disabled = confirmation.disabled = true;
    status.textContent = 'Saving level…';
    try {
      const identity = await supabaseClient.auth.getUser();
      if (snapshot !== epoch) return;
      if (identity.error || identity.data?.user?.id !== expectedUid) throw Error('changed');
      const result = await supabaseClient.rpc('set_my_academic_level', args);
      if (snapshot !== epoch) return;
      if (result.error || result.data !== args.p_level) throw Error('unconfirmed');
      await load(`Saved ${args.p_level} for ${args.p_session_year}/${args.p_session_year + 1}.`);
    } catch {
      if (snapshot === epoch)
        await load('Could not confirm the change. Check your level and session before trying again.');
    } finally {
      cancel.disabled = confirmation.disabled = false;
    }
  });
  if (typeof supabaseClient !== 'undefined' && supabaseClient)
    supabaseClient.auth.onAuthStateChange((event, s) => {
      if (event === 'SIGNED_OUT' || (event === 'SIGNED_IN' && s?.user?.id !== uid)) {
        ++epoch;
        uid = year = null;
        select.disabled = begin.disabled = true;
        hideReview();
        $('display-level').textContent = event === 'SIGNED_OUT' ? 'Signed out' : 'Loading…';
        $('level-session-hint').textContent =
          event === 'SIGNED_OUT' ? 'Sign in to view your level.' : 'Loading the academic session…';
        status.textContent = '';
        if (event === 'SIGNED_IN') setTimeout(() => load(), 0);
      }
    });
  void load();
})();
