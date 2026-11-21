// Materials and Library share a simple Yes/No. Authority is the existing RLS policy / JWT-verified R2 function.
const fields = ['id', 'file_name', 'material_name', 'level', 'semester', 'course', 'status', 'storage_path'];
const expected = { edit: 'pending', approve: 'pending', reject: 'pending', delete: 'approved' };
const labels = {
  edit: 'Save changes',
  approve: 'Approve material',
  reject: 'Reject material',
  delete: 'Delete from Library',
};
const el = (tag, text) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
};
let busy = false;
function yesOrNo({ action, title, details }) {
  const message = labels[action] + ': ' + title + '?';
  if (typeof HTMLDialogElement === 'undefined' || typeof HTMLDialogElement.prototype.showModal !== 'function')
    return Promise.resolve(window.confirm(message + '\n\n' + details));
  const d = el('dialog');
  d.className = 'lh-review';
  d.setAttribute('aria-labelledby', 'lh-action-title');
  d.setAttribute('aria-describedby', 'lh-action-info');
  Object.assign(d.style, {
    boxSizing: 'border-box',
    width: 'min(29rem,calc(100% - 2rem))',
    maxHeight: '85vh',
    overflow: 'auto',
    margin: 'auto',
    padding: '1.4rem',
    border: '1px solid #9aa9a5',
    borderRadius: '.75rem',
    background: '#fffefa',
    color: '#1d3238',
    font: '1rem/1.5 system-ui,sans-serif',
    overflowWrap: 'anywhere',
    boxShadow: '0 12px 48px #19323f44',
  });
  const h = el('h2', message),
    p = el('p', details),
    actions = el('div');
  h.id = 'lh-action-title';
  p.id = 'lh-action-info';
  p.style.whiteSpace = 'pre-line';
  h.style.cssText = 'font:600 1.3rem/1.3 system-ui;margin:0 0 .6rem';
  actions.style.cssText = 'display:flex;justify-content:flex-end;gap:.6rem;margin-top:1rem';
  const no = el('button', 'No'),
    yes = el('button', 'Yes');
  no.autofocus = true;
  for (const b of [no, yes]) {
    b.type = 'button';
    b.style.cssText =
      'min-height:44px;min-width:64px;padding:.4rem .9rem;border:1px solid #35515a;border-radius:.4rem;font-weight:600;cursor:pointer';
  }
  yes.style.background = ['delete', 'reject'].includes(action) ? '#833b32' : '#224c50';
  yes.style.color = 'white';
  no.style.background = '#fff';
  actions.append(no, yes);
  d.append(h, p, actions);
  document.body.append(d);
  return new Promise((resolve, reject) => {
    let ended = false;
    const done = (v) => {
      if (ended) return;
      ended = true;
      if (d.open) d.close();
      d.remove();
      resolve(v);
    };
    no.onclick = () => done(false);
    yes.onclick = () => done(true);
    d.addEventListener('cancel', (e) => {
      e.preventDefault();
      done(false);
    });
    d.addEventListener('close', () => done(false));
    try {
      d.showModal();
      no.focus();
    } catch (e) {
      d.remove();
      reject(e);
    }
  });
}
// Keep the result outside the queue/grid, which the owning page redraws after a confirmed action.
function notice(action, message) {
  if (typeof document === 'undefined') return;
  const anchor = document.getElementById(action === 'delete' ? 'bookGrid' : 'pending-list');
  if (!anchor?.parentNode) return;
  let n = document.getElementById('lh-moderation-result');
  if (!n) {
    n = el('p');
    n.id = 'lh-moderation-result';
    n.setAttribute('role', 'status');
    n.setAttribute('aria-live', 'polite');
    n.style.cssText = 'font:600 .9rem/1.45 system-ui;color:inherit;overflow-wrap:anywhere';
    anchor.before(n);
  }
  n.textContent = message;
}
async function account(client, id) {
  const r = await client.auth.getUser();
  if (r.error || !id || r.data?.user?.id !== id)
    throw Error('Your signed-in account changed. Reload before continuing.');
}
function checkValues(v) {
  if (
    !v ||
    typeof v.material_name !== 'string' ||
    !v.material_name.trim() ||
    v.material_name.trim().length > 240 ||
    /[\u0000-\u001f]/.test(v.material_name) ||
    !['100L', '200L', '300L', '400L', '500L', 'relevant'].includes(v.level) ||
    !['first', 'second', 'all'].includes(v.semester) ||
    typeof v.course !== 'string' ||
    !v.course.trim()
  )
    throw Error('Check the material title, level, semester and course.');
  return { material_name: v.material_name.trim(), level: v.level, semester: v.semester, course: v.course };
}
export async function reviewMaterial(
  client,
  { actor, item, action, values = null },
  confirmAction = yesOrNo,
) {
  if (busy) return false;
  if (!actor || !item?.id || !Object.hasOwn(expected, action) || item.status !== expected[action])
    throw Error('Refresh and choose a current material.');
  const update =
    action === 'edit' ? checkValues(values) : action === 'approve' ? { status: 'approved' } : null;
  const title = item.material_name || item.file_name || 'this material';
  const details =
    action === 'approve'
      ? 'Yes publishes this PDF in the Library.'
      : action === 'edit'
        ? `Save as “${update.material_name}” · ${update.level} / ${update.semester} / ${update.course}. The PDF stays unchanged.`
        : action === 'reject'
          ? 'Yes permanently removes this pending upload and its PDF.'
          : 'Yes permanently removes this approved material and its PDF.';
  busy = true;
  try {
    notice(action, '');
    const where = [item.file_name, item.level, item.semester, item.course].filter(Boolean).join(' · ');
    if (!(await confirmAction({ action, title, details: [where, details].filter(Boolean).join('\n\n') })))
      return false;
    await account(client, actor);
    const me = await client.from('users').select('id,is_admin').eq('id', actor).maybeSingle();
    if (me.error || me.data?.id !== actor || me.data.is_admin !== true)
      throw Error('Current administrator access could not be confirmed. Nothing was requested.');
    const current = await client
      .from('materials')
      .select([...fields, 'uploaded_by'].join(','))
      .eq('id', item.id)
      .maybeSingle();
    const row = current.data;
    if (current.error || !row || fields.some((k) => (row[k] ?? null) !== (item[k] ?? null)))
      throw Error('This item changed or is unavailable. Reload before trying again.');
    if (update) {
      // Conditions belong on the UPDATE itself, so a later edit or approval cannot be silently overwritten.
      await account(client, actor);
      let q = client.from('materials').update(update);
      for (const k of fields) q = row[k] == null ? q.is(k, null) : q.eq(k, row[k]);
      const r = await q.select('id').maybeSingle();
      if (r.error || r.data?.id !== item.id)
        throw Error('Change not confirmed. Reload and check the item before trying again.');
    } else {
      const parts = typeof row.storage_path === 'string' ? row.storage_path.split('/') : [];
      if (
        !row.uploaded_by ||
        parts.length !== 3 ||
        parts[0] !== 'materials' ||
        parts[1] !== row.uploaded_by ||
        !parts[2] ||
        ['.', '..'].includes(parts[2])
      )
        throw Error('The file path does not match this upload. No deletion requested.');
      const refs = await client.from('materials').select('id').eq('storage_path', row.storage_path).limit(2);
      if (refs.error || !Array.isArray(refs.data) || refs.data.length !== 1 || refs.data[0].id !== row.id)
        throw Error('Could not confirm a unique PDF for this item. No deletion requested.');
      await account(client, actor);
      // Exactly the deployed Materials/Library contract. Do not delete the row separately or retry on an uncertain result.
      const r = await client.functions.invoke('r2-presign', {
        body: { action: 'reject', key: row.storage_path, materialId: row.id },
      });
      if (r.error || r.data?.deleted !== true)
        throw Error(
          'Removal was not confirmed. Reload before trying again; ask the operator to check the file and record if they differ.',
        );
    }
    const completed = {
      approve: 'Approved',
      reject: 'Rejected and removed',
      edit: 'Details saved for',
      delete: 'Removed from the Library',
    };
    notice(action, `${completed[action]}: ${update?.material_name || title}.`);
    return true;
  } finally {
    busy = false;
  }
}
