// Wires the mailer to production dependencies (Supabase store + rate limiter,
// Resend transport) from environment variables, and exposes a single
// deliverReports() entry point for the sender scripts.
//
// Clients are created lazily inside deliverReports so that `require`-ing this
// module (e.g. a load/lint check) never needs credentials.

const { createClient } = require('@supabase/supabase-js');
const { createMailer } = require('./mailer');
const { createResendTransport } = require('./resend-transport');
const { createReportStore } = require('./report-store');
const { createDbRateLimiter, createLocalRateLimiter } = require('./rate-limiter');

// units: [{ reportId, recipient, subject, html, text, attachments? }]
// meta:  { reportType, period, version, fromName, fromEmail, dryRun? }
// Returns a summary: { total, reserved, skipped, accepted, failed_temporary,
//                      failed_permanent, in_doubt, suppressed, disabled }.
async function deliverReports(units, meta) {
  const dryRun = meta.dryRun === true || process.env.DRY_RUN === 'true';
  const from = `${meta.fromName} <${meta.fromEmail}>`;
  const budget = Number(process.env.RESEND_RATE_BUDGET || 8); // conservative under the 10/s team cap
  const windowMs = Number(process.env.RESEND_RATE_WINDOW_MS || 1000);

  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const RESEND_API_KEY = process.env.RESEND_API_KEY || process.env.EMAIL_API_KEY;

  const transport = createResendTransport({ apiKey: RESEND_API_KEY, dryRun });

  if (dryRun && (!SUPABASE_URL || !SERVICE_KEY)) {
    // Pure local dry-run (no DB): prove unit building + batching without creds.
    const mem = makeMemoryStore();
    const limiter = createLocalRateLimiter({ budget, windowMs });
    const mailer = createMailer({ transport, store: mem, rateLimiter: limiter });
    return mailer.send(units, { reportType: meta.reportType, period: meta.period, version: meta.version, from });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const store = await createReportStore({ supabase, resendApiKey: RESEND_API_KEY }).ready();
  const rateLimiter = createDbRateLimiter({ supabase, budget, windowMs });
  const mailer = createMailer({ transport, store, rateLimiter });
  return mailer.send(units, { reportType: meta.reportType, period: meta.period, version: meta.version, from });
}

// Minimal in-memory store for credential-free dry-runs.
function makeMemoryStore() {
  const rows = new Map();
  const block = new Set(['accepted', 'skipped', 'failed_permanent', 'in_doubt']);
  const uuid = () => (require('crypto').randomUUID());
  return {
    async isSuppressed() { return false; },
    async isDisabled() { return false; },
    async reserveSkip({ key, status }) { rows.set(key, { status, lease: null }); },
    async reserve({ key, leaseMs, now }) {
      const r = rows.get(key);
      if (!r) { const l = uuid(); rows.set(key, { status: 'reserved', reserved_until: now + leaseMs, lease: l }); return { outcome: 'claimed', leaseToken: l }; }
      if (block.has(r.status)) return { outcome: 'skip', status: r.status };
      if (r.status === 'reserved' && r.reserved_until > now) return { outcome: 'skip', status: r.status };
      const l = uuid(); r.status = 'reserved'; r.reserved_until = now + leaseMs; r.lease = l; return { outcome: 'claimed', leaseToken: l };
    },
    async record({ key, leaseToken, status }) { const r = rows.get(key); if (!r || r.lease !== leaseToken) return false; r.status = status; if (status !== 'reserved') r.lease = null; return true; },
    async tally(keys) { const t = { accepted: 0, failed_temporary: 0, failed_permanent: 0, in_doubt: 0 }; for (const k of keys) { const r = rows.get(k); if (r && r.status in t) t[r.status] += 1; } return t; },
  };
}

module.exports = { deliverReports };
