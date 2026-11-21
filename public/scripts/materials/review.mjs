// Shared by the pending queue and the approved library. The RPC/Edge Function verifies the same review.
const verbs = {
  edit: 'Save changes',
  approve: 'Approve material',
  reject: 'Reject and delete',
  delete: 'Delete material',
};
let active = false;
const accountsMatch = async (client, actor) => {
  const v = await client.auth.getUser();
  return !!actor && !v.error && v.data?.user?.id === actor;
};
function node(tag, text, cls) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (cls) el.className = cls;
  return el;
}
function styleOnce() {
  if (document.getElementById('lh-material-review-style')) return;
  const s = node('style');
  s.id = 'lh-material-review-style';
  s.textContent = `
.lh-review{box-sizing:border-box;width:min(31rem,calc(100% - 2rem));max-height:88vh;max-height:88dvh;margin:auto;padding:1.45rem;border:1px solid #b8beb8;border-radius:.85rem;color:#192a30;background:#fffefa;font:400 .95rem/1.5 system-ui,sans-serif;overflow:auto;overflow-wrap:anywhere;box-shadow:0 1rem 4rem #12283233}.lh-review::backdrop{background:#12202db3}.lh-review h2{font:500 1.65rem/1.2 Georgia,serif;margin:.25rem 0 .7rem}.lh-review p{margin:.55rem 0}.lh-review .lh-eyebrow{font:700 .73rem/1.4 ui-monospace,monospace;letter-spacing:.08em;color:#755221}.lh-review code{display:block;padding:.55rem;background:#f2eee3;user-select:all}.lh-review input{box-sizing:border-box;width:100%;margin:.55rem 0;padding:.7rem;border:1px solid #738087;border-radius:.35rem;background:white;color:#172730;font:inherit}.lh-review .lh-actions{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:.8rem}.lh-review button{min-height:44px;border:1px solid #29474f;border-radius:.35rem;padding:.5rem .8rem;font:600 .9rem system-ui;cursor:pointer}.lh-review button:first-child{background:#fff;color:#243b42}.lh-review button:last-child{background:#23474b;color:white}.lh-review[data-danger=true] button:last-child{background:#803a36}.lh-review button:disabled{opacity:.55;cursor:not-allowed}.lh-review :focus-visible{outline:3px solid #346eb4;outline-offset:2px}`;
  document.head.append(s);
}
export async function reviewMaterial(client, { actor, item, action, values = null }) {
  if (active) return false;
  if (!Object.hasOwn(verbs, action) || !item?.id) throw Error('Choose a material to review.');
  active = true;
  let dialog, unsubscribe, finish;
  let ended = false;
  let removed = false;
  try {
    if (!(await accountsMatch(client, actor)))
      throw Error('Your account changed. Refresh before reviewing.');
    const { data: r, error } = await client.rpc('lh_material_review', { p_actor: actor, p_id: item.id });
    if (['PGRST202', '42883'].includes(error?.code))
      throw Error('Material review is not available on this server yet. Ask the site operator to finish activating the review service. Nothing was changed.');
    if (error?.code === '42501')
      throw Error('The server did not authorize this signed-in account to review the item. Nothing was changed.');
    if (error?.code === '40001') throw Error('This item changed or is no longer available. Reload the queue.');
    if (error || !r || r.id !== item.id || typeof r.title !== 'string' || !/^\d+$/.test(r.version))
      throw Error('The server could not confirm the current material. Check the connection and reload. Nothing was changed.');
    if (
      r.status !== (action === 'delete' ? 'approved' : 'pending') ||
      ['material_name', 'file_name', 'level', 'semester', 'course', 'status'].some(
        (k) => (item[k] ?? null) !== (r[k] ?? null),
      )
    )
      throw Error('This item changed since it was listed. Reload and review it again.');
    styleOnce();
    dialog = node('dialog', undefined, 'lh-review');
    dialog.dataset.danger = String(['reject', 'delete'].includes(action));
    dialog.setAttribute('aria-labelledby', 'lh-review-title');
    const h = node('h2', verbs[action]);
    h.id = 'lh-review-title';
    const phrase = `i ${action} ${r.title}`;
    const code = node('code', phrase);
    code.id = 'lh-review-phrase';
    const label = node('label', 'Type this exact phrase:');
    const input = node('input');
    label.htmlFor = input.id = 'lh-review-input';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('autocapitalize', 'none');
    input.setAttribute('aria-describedby', code.id);
    const status = node('p');
    status.setAttribute('role', 'status');
    const buttons = node('div', undefined, 'lh-actions'),
      cancel = node('button', 'Cancel'),
      save = node('button', verbs[action]);
    cancel.type = save.type = 'button';
    save.disabled = true;
    buttons.append(cancel, save);
    const scope = [r.level, r.semester, r.course].filter(Boolean).join(' / ');
    dialog.append(
      node('p', 'MATERIAL REVIEW', 'lh-eyebrow'),
      h,
      node('strong', r.title),
      node('p', `File: ${r.file_name} · ${r.status}${scope ? ' · ' + scope : ''}`),
      node('small', `Material ID: ${r.id}`),
    );
    const summary =
      action === 'edit'
        ? `Save as “${values.material_name}” · ${values.level} / ${values.semester} / ${values.course}. The PDF itself will not change.`
        : action === 'approve'
          ? 'This PDF will become visible in the Library.'
          : 'This will permanently remove the material and its PDF. This cannot be undone.';
    dialog.append(node('p', summary), label, code, input, status, buttons);
    document.body.append(dialog);
    const result = new Promise((resolve) => {
      finish = (v) => {
        if (ended) return;
        ended = true;
        resolve(v);
      };
    });
    let busy = false;
    let submitted = null;
    input.addEventListener('input', () => (save.disabled = busy || input.value !== phrase));
    cancel.addEventListener('click', () => {
      if (!busy) finish(removed);
    });
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      if (!busy) finish(removed);
    });
    const sub = client.auth.onAuthStateChange?.((event, session) => {
      if (event === 'SIGNED_OUT' || (session?.user?.id && session.user.id !== actor)) finish(false);
    });
    unsubscribe = () => sub?.data?.subscription?.unsubscribe();
    save.addEventListener('click', async () => {
      if (ended || busy || save.disabled || input.value !== phrase) return;
      busy = true;
      save.disabled = cancel.disabled = input.disabled = true;
      status.textContent = 'Checking and saving…';
      try {
        if (!(await accountsMatch(client, actor)) || ended)
          throw Error('Account changed. Close and refresh.');
        submitted ??= input.value;
        if (action === 'edit' || action === 'approve') {
          const res = await client.rpc('lh_material_change', {
            p_actor: actor,
            p_id: r.id,
            p_version: r.version,
            p_action: action,
            p_phrase: submitted,
            p_values: values,
          });
          if (res.error || res.data !== true)
            throw Error('Change not confirmed. Close, reload and review the current item.');
        } else {
          const res = await client.functions.invoke('r2-presign', {
            body: {
              action: 'remove-reviewed',
              operation: action,
              actor,
              materialId: r.id,
              version: r.version,
              confirmation: submitted,
            },
          });
          if (res.error || res.data?.removed !== true)
            throw Error('Removal not confirmed. Close and reload before reviewing again.');
          removed = true;
          if (res.data.fileRemoved !== true) {
            status.textContent =
              'Material record removed. File cleanup is pending; retry cleanup or close and tell the operator.';
            cancel.textContent = 'Close';
            save.textContent = 'Retry file cleanup';
            save.disabled = cancel.disabled = false;
            return;
          }
        }
        finish(true);
      } catch (err) {
        if (!ended) {
          status.textContent = err?.message || 'Result not confirmed. Reload to review again.';
          cancel.disabled = false;
          cancel.textContent = 'Close';
        }
      } finally {
        busy = false;
      }
    });
    dialog.showModal();
    cancel.focus();
    return await result;
  } finally {
    ended = true;
    unsubscribe?.();
    if (dialog?.open) dialog.close();
    dialog?.remove();
    active = false;
  }
}
