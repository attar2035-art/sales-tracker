// Shared, transport-agnostic report mailer.
//
// Responsibilities (Phase 1 of the automation hardening):
//   • Atomic de-duplication + reservation per (reportType, reportId, period,
//     version, recipient) via an injected `store`.
//   • Shared rate budget (Resend's 10 req/s is per-TEAM, shared across every
//     API key / SMTP / batch call) via an injected `rateLimiter`.
//   • batch-first delivery to minimise request count; a single-send fallback
//     for messages the batch API cannot carry (attachments).
//   • Retry TEMPORARY failures only (429 / 5xx / network), with bounded
//     backoff + jitter, honouring Retry-After. Never retry PERMANENT (4xx).
//   • Distinct processing vs. delivery states; an "accepted-then-disconnect"
//     outcome is recorded as `in_doubt`, never blindly resent.
//
// Everything external is injected, so this module runs fully under simulation
// with no network and no database. See tools/__tests__/mailer.sim.mjs.

const crypto = require('crypto');

const PROCESSING = Object.freeze({
  PENDING: 'pending',
  RESERVED: 'reserved',
  ACCEPTED: 'accepted',
  FAILED_TEMPORARY: 'failed_temporary',
  FAILED_PERMANENT: 'failed_permanent',
  IN_DOUBT: 'in_doubt',
  SKIPPED: 'skipped',
});

// Reuse-eligible terminal-ish states handled by the store; listed here for docs.
const TERMINAL = new Set([
  PROCESSING.ACCEPTED,
  PROCESSING.SKIPPED,
  PROCESSING.FAILED_PERMANENT,
  PROCESSING.IN_DOUBT,
]);

function normalizeRecipient(r) {
  return String(r || '').trim().toLowerCase();
}

// Stable idempotency key, hashed so Arabic report ids never exceed Resend's
// 256-char limit. The SAME (type,id,period,version,recipient) always yields the
// SAME key, so a retry reuses it and Resend returns the original send.
function idempotencyKey({ reportType, reportId, period, version, recipient }) {
  const raw = [reportType, reportId, period, version, normalizeRecipient(recipient)].join('|');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  return `rpt_${hash}`; // 68 chars, well under 256
}

// A batch reuses ONE request-level key derived from its member keys IN ORDER.
// Reconstituting the identical batch next run yields the same key (Resend
// returns the original response); any reshape yields a different key.
function batchKey({ reportType, period, version, memberKeys }) {
  const raw = [reportType, period, version, ...memberKeys].join('|');
  return `btch_${crypto.createHash('sha256').update(raw).digest('hex')}`;
}

function isPermanentStatus(status) {
  // 429 is a temporary rate error; other 4xx are permanent (bad request, etc.).
  return typeof status === 'number' && status >= 400 && status < 500 && status !== 429;
}

function backoffMs(attempt, retryAfterMs, rng) {
  const base = Math.min(1000 * 2 ** (attempt - 1), 30000); // 1s,2s,4s… capped 30s
  const floor = Math.max(base, Number(retryAfterMs) || 0); // honour Retry-After
  const jitter = Math.floor((rng ? rng() : Math.random()) * Math.min(floor, 1000));
  return floor + jitter;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function createMailer(deps) {
  const {
    transport,            // { sendOne(msg)->res, sendBatch({messages})->res }
    store,                // reservation / suppression / killswitch / record
    rateLimiter,          // { acquire(), penalize(ms) } — shared team budget
    now = () => Date.now(),
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    logger = console,
    batchSize = 100,      // Resend batch hard cap
    maxAttempts = 4,
    leaseMs = 2 * 60 * 1000,
    rng,
    // Optional: async (unit) => boolean. When a unit carries attachments it MUST
    // return true before the message is sent; otherwise the unit is recorded as
    // failed_permanent and never delivered. No attachment sender exists today;
    // this gate is mandatory for any future one.
    assertAttachmentOwnership = null,
  } = deps;

  async function record(unit, patch) {
    const ok = await store.record({ key: unit.key, leaseToken: unit.leaseToken, ...patch });
    if (!ok) {
      // Lease was taken over by another worker after it expired; we are no
      // longer the owner, so we MUST NOT write a result. Drop silently.
      logger.warn?.(`lease lost for ${unit.key}; skipping result write (${patch.status})`);
    }
    return ok;
  }

  async function deliverBatch(units, meta) {
    const memberKeys = units.map((u) => u.key);
    const reqKey = batchKey({ reportType: meta.reportType, period: meta.period, version: meta.version, memberKeys });
    for (let attempt = 1; ; attempt += 1) {
      await rateLimiter.acquire(1);
      let res;
      try {
        res = await transport.sendBatch({
          from: meta.from,
          idempotencyKey: reqKey,
          messages: units.map((u) => ({
            to: u.recipient, subject: u.subject, html: u.html, text: u.text,
          })),
        });
      } catch (err) {
        // Network/timeout: the provider MAY have accepted some or all. Never
        // auto-resend — record in_doubt for settlement/alerting.
        for (const u of units) await record(u, { status: PROCESSING.IN_DOUBT, attempts: attempt, error: String(err && err.message || err) });
        return;
      }
      if (res.ok) {
        for (let i = 0; i < units.length; i += 1) {
          await record(units[i], { status: PROCESSING.ACCEPTED, attempts: attempt, providerId: res.providerIds?.[i] || null });
        }
        return;
      }
      if (isPermanentStatus(res.status)) {
        for (const u of units) await record(u, { status: PROCESSING.FAILED_PERMANENT, attempts: attempt, error: res.error || `status ${res.status}` });
        return;
      }
      if (res.retryAfterMs) rateLimiter.penalize(res.retryAfterMs);
      if (attempt >= maxAttempts) {
        // Leave as failed_temporary so the NEXT scheduled run retries only
        // these (dedup skips the ones already accepted).
        for (const u of units) await record(u, { status: PROCESSING.FAILED_TEMPORARY, attempts: attempt, error: res.error || `status ${res.status}` });
        return;
      }
      await sleep(backoffMs(attempt, res.retryAfterMs, rng));
    }
  }

  async function deliverSingle(unit, meta) {
    // Attachment ownership gate: never sign/send an attachment we cannot verify.
    if (unit.attachments && unit.attachments.length && assertAttachmentOwnership) {
      let owned = false;
      try { owned = await assertAttachmentOwnership(unit); } catch (e) { owned = false; }
      if (!owned) { await record(unit, { status: PROCESSING.FAILED_PERMANENT, attempts: 0, error: 'attachment ownership check failed' }); return; }
    }
    for (let attempt = 1; ; attempt += 1) {
      await rateLimiter.acquire(1);
      let res;
      try {
        res = await transport.sendOne({
          from: meta.from,
          idempotencyKey: unit.key,
          to: unit.recipient, subject: unit.subject, html: unit.html, text: unit.text,
          attachments: unit.attachments,
        });
      } catch (err) {
        await record(unit, { status: PROCESSING.IN_DOUBT, attempts: attempt, error: String(err && err.message || err) });
        return;
      }
      if (res.ok) { await record(unit, { status: PROCESSING.ACCEPTED, attempts: attempt, providerId: res.providerId || null }); return; }
      if (isPermanentStatus(res.status)) { await record(unit, { status: PROCESSING.FAILED_PERMANENT, attempts: attempt, error: res.error || `status ${res.status}` }); return; }
      if (res.retryAfterMs) rateLimiter.penalize(res.retryAfterMs);
      if (attempt >= maxAttempts) { await record(unit, { status: PROCESSING.FAILED_TEMPORARY, attempts: attempt, error: res.error || `status ${res.status}` }); return; }
      await sleep(backoffMs(attempt, res.retryAfterMs, rng));
    }
  }

  // units: [{ reportId, recipient, subject, html, text, attachments? }]
  // meta:  { reportType, period, version, from }
  async function send(units, meta) {
    const summary = { total: units.length, reserved: 0, skipped: 0, accepted: 0, failed_temporary: 0, failed_permanent: 0, in_doubt: 0, suppressed: 0, disabled: 0 };
    const reserved = [];

    for (const raw of units) {
      const recipient = normalizeRecipient(raw.recipient);
      const key = idempotencyKey({ ...meta, reportId: raw.reportId, recipient });
      const u = { ...raw, recipient, key };

      if (await store.isDisabled({ reportType: meta.reportType, recipient })) {
        summary.disabled += 1; summary.skipped += 1;
        await store.reserveSkip?.({ key, status: PROCESSING.SKIPPED, reason: 'killswitch', unit: u, meta });
        continue;
      }
      if (await store.isSuppressed(recipient)) {
        summary.suppressed += 1; summary.skipped += 1;
        await store.reserveSkip?.({ key, status: PROCESSING.SKIPPED, reason: 'suppressed', unit: u, meta });
        continue;
      }
      const r = await store.reserve({ key, leaseMs, now: now(), unit: u, meta });
      if (r.outcome !== 'claimed') { summary.skipped += 1; continue; }
      summary.reserved += 1;
      reserved.push({ ...u, leaseToken: r.leaseToken });
    }

    const batchable = reserved.filter((u) => !(u.attachments && u.attachments.length));
    const singles = reserved.filter((u) => u.attachments && u.attachments.length);

    for (const group of chunk(batchable, batchSize)) await deliverBatch(group, meta);
    for (const u of singles) await deliverSingle(u, meta);

    // Final delivery outcomes from the store (authoritative for the units we
    // attempted this run). Pre-reserve counters (skipped / suppressed /
    // disabled / reserved) are kept as counted above and never clobbered.
    if (store.tally) {
      const t = await store.tally(reserved.map((u) => u.key));
      for (const k of ['accepted', 'failed_temporary', 'failed_permanent', 'in_doubt']) {
        if (k in t) summary[k] = t[k];
      }
    }
    return summary;
  }

  return { send, idempotencyKey, batchKey };
}

module.exports = { createMailer, idempotencyKey, batchKey, isPermanentStatus, backoffMs, PROCESSING, TERMINAL };
