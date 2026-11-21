// Resend transport: single + batch send with 429/Retry-After handling.
// - HTTP error statuses are returned (not thrown) so the mailer can classify
//   permanent vs temporary.
// - A thrown error means the request outcome is UNKNOWN (network/timeout);
//   the mailer records that unit as in_doubt and never auto-resends it.
// Note: Resend's batch endpoint does NOT support attachments — callers must
// route attachment messages through sendOne.

const SINGLE_URL = process.env.EMAIL_API_URL || 'https://api.resend.com/emails';
const BATCH_URL = process.env.EMAIL_BATCH_API_URL || 'https://api.resend.com/emails/batch';

function retryAfterMs(res) {
  const ra = res.headers.get('retry-after');
  if (ra) { const s = Number(ra); if (!Number.isNaN(s)) return Math.max(0, s * 1000); }
  const reset = res.headers.get('ratelimit-reset');
  if (reset) { const s = Number(reset); if (!Number.isNaN(s)) return Math.max(0, s * 1000); }
  return 1000;
}

function createResendTransport({ apiKey, dryRun = false, logger = console }) {
  async function post(url, body, idempotencyKey) {
    const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    // A thrown fetch error propagates to the mailer (treated as in_doubt).
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    return res;
  }

  async function sendOne({ from, to, subject, html, text, attachments, idempotencyKey }) {
    if (dryRun) { logger.log(`[DRY_RUN single] ${to} | ${subject}`); return { ok: true, providerId: `dry_${to}` }; }
    const body = { from, to: [to], subject, html, text };
    if (attachments && attachments.length) body.attachments = attachments;
    const res = await post(SINGLE_URL, body, idempotencyKey);
    if (res.ok) { const j = await res.json().catch(() => ({})); return { ok: true, providerId: j.id || null }; }
    const errText = await res.text().catch(() => '');
    return { ok: false, status: res.status, retryAfterMs: res.status === 429 ? retryAfterMs(res) : 0, error: `${res.status} ${errText}`.slice(0, 500) };
  }

  async function sendBatch({ from, messages, idempotencyKey }) {
    if (dryRun) { logger.log(`[DRY_RUN batch] ${messages.length} msg(s)`); return { ok: true, providerIds: messages.map((m) => `dry_${m.to}`) }; }
    const body = messages.map((m) => ({ from, to: [m.to], subject: m.subject, html: m.html, text: m.text }));
    const res = await post(BATCH_URL, body, idempotencyKey);
    if (res.ok) { const j = await res.json().catch(() => ({})); const data = Array.isArray(j.data) ? j.data : []; return { ok: true, providerIds: data.map((d) => d && d.id) }; }
    const errText = await res.text().catch(() => '');
    return { ok: false, status: res.status, retryAfterMs: res.status === 429 ? retryAfterMs(res) : 0, error: `${res.status} ${errText}`.slice(0, 500) };
  }

  return { sendOne, sendBatch };
}

module.exports = { createResendTransport };
