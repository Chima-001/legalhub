/* Additional admin panels. Authorization lives in the database, not in these disclosures. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const term = $('panel-term'),
    roles = $('panel-roles');
  if (!term || !roles) return;
  const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
  let actor = null,
    epoch = 0,
    capSeq = 0,
    roleSeq = 0,
    target = null,
    manageRoles = false,
    writingRole = false;
  const message = (id, text) => {
    $(id).textContent = text;
  };
  const current = (e) => actor !== null && epoch === e && !$('settings-workspace').hidden;
  function clearTarget(erase = false) {
    ++roleSeq;
    target = null;
    writingRole = false;
    $('role-review').disabled = false;
    $('role-email').disabled = false;
    $('role-apply').disabled = true;
    $('role-confirm').value = '';
    $('role-result').hidden = true;
    message('role-phrase', '');
    message('role-preview', '');
    message('role-status', '');
    if (erase) $('role-email').value = '';
  }
  function hideTools() {
    manageRoles = false;
    clearTarget(true);
    roles.open = false;
    roles.hidden = true;
  }
  async function capabilities() {
    if (!actor || document.hidden) return;
    const e = epoch,
      t = ++capSeq;
    try {
      const { data, error } = await supabaseClient.rpc('lh_admin_capabilities');
      if (t !== capSeq || !current(e)) return;
      if (error || data?.admin !== true || typeof data.roles !== 'boolean') throw Error();
      manageRoles = data.roles;
      roles.hidden = !manageRoles;
      if (!manageRoles) {
        roles.open = false;
        clearTarget(true);
      }
      message('tools-status', '');
      $('tools-retry').hidden = true;
    } catch {
      if (t !== capSeq || !current(e)) return;
      hideTools();
      message('tools-status', 'Admin access changes are unavailable. The calendar is separate.');
      $('tools-retry').hidden = false;
    }
  }
  function session(id) {
    ++epoch;
    ++capSeq;
    actor = typeof id === 'string' && id ? id : null;
    hideTools();
    term.open = false;
    $('tools-retry').hidden = true;
    message('tools-status', '');
    document.dispatchEvent(new CustomEvent('lh:admin-session', { detail: actor }));
    if (actor) void capabilities();
  }
  window.LHWorkspace = Object.freeze({ session });
  $('tools-retry').addEventListener('click', capabilities);
  window.addEventListener('pagehide', () => session(null));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void capabilities();
  });
  window.addEventListener('focus', capabilities);
  setInterval(capabilities, 60000);
  const cards = [...document.querySelectorAll('details.tool-card')];
  for (const card of cards)
    card.addEventListener('toggle', () => {
      if (!card.open) {
        if (card === roles) clearTarget(true);
        return;
      }
      if (card.hidden) {
        card.open = false;
        return;
      }
      for (const other of cards) if (other !== card && other.open) other.open = false; // Fallback for older browsers.
      if (card === roles) void capabilities();
    });
  async function identity(e) {
    if (navigator.onLine === false) throw Object.assign(Error(), { code: 'offline' });
    const who = await supabaseClient.auth.getUser();
    if (!current(e) || who.error || who.data?.user?.id !== actor)
      throw Object.assign(Error(), { code: '42501' });
  }
  function failText(err, kind) {
    if (err?.code === 'offline')
      return 'You are offline. Reconnect and review again; no change was sent.';
    if (err?.code === '42501') {
      void capabilities();
      return 'Access denied or account changed. Recheck your access.';
    }
    if (err?.code === '40001') return 'This record changed. Reload or review it again before saving.';
    if (err?.code === '23505')
      return 'This course name or its material identifier is already in use in this semester.';
    if (err?.code === '22023')
      return kind === 'role'
        ? 'Check the email and confirmation. Only a different, confirmed member can be changed; the owner and your own account cannot be changed here.'
        : 'Check the level, semester and course details.';
    return 'Could not confirm the result. Reload or review the record before trying again.';
  }
  $('role-email').addEventListener('input', () => clearTarget());
  $('role-lookup').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!actor || !manageRoles || !roles.open || writingRole) return;
    clearTarget();
    const e = epoch,
      t = roleSeq,
      email = $('role-email').value.trim().toLowerCase();
    if (!email || !$('role-email').validity.valid) return;
    $('role-review').disabled = true;
    message('role-status', 'Checking that account…');
    try {
      await identity(e);
      if (t !== roleSeq || !current(e)) return;
      const { data, error } = await supabaseClient.rpc('lh_review_admin', {
        p_actor: actor,
        p_email: email,
      });
      if (t !== roleSeq || !current(e) || !manageRoles || !roles.open) return;
      if (
        error ||
        !data ||
        data.email !== email ||
        typeof data.is_admin !== 'boolean' ||
        !uuid.test(data.id) ||
        typeof data.delegates !== 'boolean' ||
        !/^\d+\.\d+$/.test(data.version)
      )
        throw error || Error();
      target = data;
      const verb = data.is_admin ? 'revoke' : 'grant';
      message(
        'role-preview',
        `${data.email} is currently ${data.is_admin ? 'an administrator' : 'a member'}. This will ${verb} administrator access.${data.delegates ? ' Revoking also removes this account’s delegation permission.' : ' Membership is unchanged.'}`,
      );
      message('role-phrase', verb + ' ' + data.email);
      message('role-apply', data.is_admin ? 'Revoke admin access' : 'Grant admin access');
      $('role-apply').dataset.action = verb;
      $('role-result').hidden = false;
      message('role-status', 'Account reviewed. No permissions changed.');
      $('role-confirm').focus();
    } catch (err) {
      if (t === roleSeq && current(e)) message('role-status', failText(err, 'role'));
    } finally {
      if (t === roleSeq && current(e)) $('role-review').disabled = false;
    }
  });
  $('role-confirm').addEventListener('input', () => {
    $('role-apply').disabled =
      writingRole || !target || $('role-confirm').value !== $('role-phrase').textContent;
  });
  $('role-apply').addEventListener('click', async () => {
    if (!actor || !roles.open || !manageRoles || writingRole || !target || $('role-apply').disabled)
      return;
    const e = epoch,
      t = ++roleSeq,
      r = target,
      grant = !r.is_admin,
      confirm = $('role-confirm').value;
    if (confirm !== `${grant ? 'grant' : 'revoke'} ${r.email}`) return;
    writingRole = true;
    $('role-review').disabled = $('role-apply').disabled = $('role-email').disabled = true;
    message('role-status', 'Saving access change…');
    try {
      await identity(e);
      if (!current(e) || t !== roleSeq || !manageRoles || !roles.open) return;
      const { data, error } = await supabaseClient.rpc('lh_change_admin', {
        p_actor: actor,
        p_target: r.id,
        p_email: r.email,
        p_grant: grant,
        p_version: r.version,
        p_confirmation: confirm,
      });
      if (!current(e) || t !== roleSeq) return;
      if (error || data !== true) throw error || Error();
      clearTarget(true);
      message(
        'role-status',
        `Admin access ${grant ? 'granted to' : 'revoked for'} ${r.email}. The member account is unchanged.`,
      );
      $('role-email').focus();
    } catch (err) {
      if (current(e) && t === roleSeq) {
        clearTarget();
        message('role-status', failText(err, 'role'));
      }
    }
  });
})();
