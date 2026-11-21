// No browser-supplied object path. The service-only transaction owns validation and the unlink receipt.
export async function removeReviewed(body, verifiedUser, { rpc, removeObject }) {
  const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
  if (!verifiedUser || body.actor !== verifiedUser) return [403, { error: 'Account changed.' }];
  if (
    !uuid.test(body.materialId) ||
    !['reject', 'delete'].includes(body.operation) ||
    typeof body.version !== 'string' ||
    !/^\d+$/.test(body.version) ||
    typeof body.confirmation !== 'string' ||
    'key' in body
  )
    return [400, { error: 'Review this material again.' }];
  const { data, error } = await rpc('lh_material_remove', {
    p_actor: verifiedUser,
    p_id: body.materialId,
    p_action: body.operation,
    p_version: body.version,
    p_phrase: body.confirmation,
  });
  if (error || !data || typeof data.key !== 'string' || typeof data.done !== 'boolean') {
    const status = { 42501: 403, 40001: 409, 23503: 409, 22023: 400 }[error?.code] || 503;
    return [status, { error: 'Removal not confirmed. Reload the current item before another review.' }];
  }
  if (!data.done) {
    try {
      await removeObject(data.key);
      const receipt = await rpc('lh_material_file_done', { p_id: body.materialId, p_key: data.key });
      if (receipt.error || receipt.data !== true) throw Error();
    } catch {
      return [202, { removed: true, fileRemoved: false, cleanupPending: true }];
    }
  }
  return [200, { removed: true, fileRemoved: true }];
}
