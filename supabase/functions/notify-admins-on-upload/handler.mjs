// One origin, one INSERT event, one provider request per intended admin. Never trust recipients from the body.
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const reply = (status, body) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export async function handleUploadAlert(request, { env, rpc, send = fetch, now = Date.now }) {
  if (request.method !== 'POST') return reply(405, { error: 'POST required' });
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || ''))
    return reply(415, { error: 'JSON required' });
  try {
    const stamp = request.headers.get('X-LH-Time'),
      sig = request.headers.get('X-LH-Signature');
    if (!/^\d{10,11}$/.test(stamp || '') || !/^[a-f0-9]{64}$/.test(sig || ''))
      return reply(403, { error: 'Unverified event' });
    const age = now() / 1000 - Number(stamp);
    if (age < -60 || age > 600) return reply(403, { error: 'Unverified event' });
    if (Number(request.headers.get('Content-Length')) > 2048)
      return reply(413, { error: 'Invalid event size' });
    let payload;
    try {
      const reader = request.body?.getReader();
      if (!reader) return reply(400, { error: 'Invalid event' });
      const bytes = new Uint8Array(2048);
      let used = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (used + value.length > bytes.length) {
          await reader.cancel();
          return reply(413, { error: 'Invalid event size' });
        }
        bytes.set(value, used);
        used += value.length;
      }
      payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, used)));
    } catch {
      return reply(400, { error: 'Invalid event' });
    }
    const id = payload?.record?.id;
    if (
      payload?.type !== 'INSERT' ||
      payload.schema !== 'public' ||
      payload.table !== 'materials' ||
      typeof id !== 'string' ||
      !uuid.test(id)
    )
      return reply(400, { error: 'Expected a materials INSERT' });
    const read = async (name, args) => {
      const { data, error } = await rpc(name, args);
      if (error) throw Error('Unconfirmed database operation');
      return data;
    };
    if ((await read('lh_upload_alert_verify', { p_id: id, p_stamp: stamp, p_sig: sig })) !== true)
      return reply(403, { error: 'Unverified event' });
    const token = env('RESEND_API_KEY'),
      from = env('RESEND_FROM');
    if (!token || !from || /[\r\n]/.test(from) || /@resend\.dev(?:>|\s|$)/i.test(from))
      return reply(503, { error: 'Verified mail sender not configured' });
    const plan = () => read('lh_upload_alert_plan', { p_id: id });
    const initial = await plan();
    if (initial === null) return reply(404, { error: 'No captured upload' });
    if (!Array.isArray(initial.waiting)) throw Error();
    if (initial.total === 0) return reply(503, { error: 'No administrators at upload time' });
    let providerFailed = false,
      needsOperator = false;
    for (const admin of initial.waiting) {
      const target = await read('lh_upload_alert_claim', { p_id: id, p_admin: admin });
      if (target?.state === 'accepted' || target?.state === 'revoked' || target?.state === 'busy') continue;
      if (target?.state === 'reconcile' || target?.state === 'recipient_unavailable') {
        needsOperator = true;
        continue;
      }
      if (
        target?.state !== 'send' ||
        !uuid.test(target.lease) ||
        typeof target.address !== 'string' ||
        typeof target.title !== 'string'
      )
        throw Error();
      const title = target.title.replace(/[\r\n\t]/g, ' ').trim() || 'Material';
      try {
        const result = await send('https://api.resend.com/emails', {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(8000),
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': `lh-upload/${id}/${admin}`,
          },
          body: JSON.stringify({
            from,
            to: [target.address],
            subject: `New LegalHub upload: ${title}`,
            text: `${title}${target.course ? ' (' + target.course + ')' : ''} was uploaded to LegalHub. Sign in and open Upload Material to check its review status.`,
          }),
        });
        if (!result.ok) {
          providerFailed = true;
          continue;
        }
        const receipt = await result.json();
        if (typeof receipt.id !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(receipt.id)) {
          providerFailed = true;
          continue;
        }
        if (
          (await read('lh_upload_alert_ack', {
            p_id: id,
            p_admin: admin,
            p_lease: target.lease,
            p_provider_id: receipt.id,
          })) !== true
        )
          providerFailed = true;
      } catch {
        providerFailed = true;
      }
    }
    const final = await plan();
    if (!final || !Array.isArray(final.waiting)) throw Error();
    const counts = {
      accepted: final.accepted,
      noLongerAdmin: final.revoked,
      pending: final.waiting.length,
    };
    if (counts.pending > 0)
      return reply(needsOperator ? 409 : providerFailed ? 502 : 503, {
        ...counts,
        reason: needsOperator
          ? 'Operator review required'
          : providerFailed
            ? 'Provider acceptance not confirmed'
            : 'Another attempt may be in progress',
      });
    if (counts.accepted + counts.noLongerAdmin !== final.total) throw Error();
    return reply(200, counts);
  } catch {
    return reply(503, { error: 'Notification state could not be confirmed' });
  }
}
