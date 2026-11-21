/* Simulation + dry-run tests for tools/lib/mailer.js.
 * No network, no database, no real emails. Mirrors the Postgres reservation
 * semantics (atomic claim, lease CAS, reserved-expiry) and Resend's transport
 * behaviour (429/Retry-After, permanent 4xx, accepted-then-disconnect).
 * Run: node tools/__tests__/mailer.sim.js
 */
const assert = require('assert');
const crypto = require('crypto');
const { createMailer, idempotencyKey, PROCESSING } = require('../lib/mailer');

let passed = 0;
function ok(name, cond) {
  if (!cond) { console.error(`  ✗ ${name}`); throw new Error(`FAILED: ${name}`); }
  passed += 1; console.log(`  ✓ ${name}`);
}

// ---- Virtual clock + shared token-bucket rate limiter (team budget) ---------
function makeClock() {
  const state = { t: 0 };
  return {
    now: () => state.t,
    sleep: async (ms) => { state.t += Math.max(0, ms | 0); },
    advance: (ms) => { state.t += ms; },
    state,
  };
}
function makeRateLimiter(clock, { budget = 10, windowMs = 1000 } = {}) {
  let tokens = budget; let last = clock.now(); const ticks = [];
  function refill() {
    const n = clock.now();
    const add = ((n - last) / windowMs) * budget;
    if (add > 0) { tokens = Math.min(budget, tokens + add); last = n; }
  }
  return {
    ticks,
    async acquire() {
      for (;;) {
        refill();
        if (tokens >= 1) { tokens -= 1; ticks.push(clock.now()); return; }
        const needed = (1 - tokens) / budget * windowMs;
        await clock.sleep(Math.ceil(needed));
      }
    },
    penalize() {},
    maxInAnyWindow() {
      let max = 0;
      for (const s of ticks) {
        const c = ticks.filter((x) => x >= s && x < s + windowMs).length;
        if (c > max) max = c;
      }
      return max;
    },
  };
}

// ---- In-memory store mirroring the migration's atomic semantics -------------
function makeStore({ suppressed = new Set(), disabled = new Set() } = {}) {
  const rows = new Map(); // key -> { status, reserved_until, lease, attempts, providerId }
  const REUSE_BLOCK = new Set([
    PROCESSING.ACCEPTED, PROCESSING.SKIPPED, PROCESSING.FAILED_PERMANENT, PROCESSING.IN_DOUBT,
  ]);
  const newLease = () => crypto.randomUUID();
  return {
    rows,
    async isSuppressed(r) { return suppressed.has(r); },
    async isDisabled({ recipient }) { return disabled.has(recipient); },
    async reserveSkip({ key, status }) { rows.set(key, { status, lease: null, attempts: 0 }); },
    // Atomic claim: INSERT ON CONFLICT DO NOTHING + CAS on expired reservations.
    async reserve({ key, leaseMs, now }) {
      const row = rows.get(key);
      if (!row) { const lease = newLease(); rows.set(key, { status: PROCESSING.RESERVED, reserved_until: now + leaseMs, lease, attempts: 0 }); return { outcome: 'claimed', leaseToken: lease }; }
      if (REUSE_BLOCK.has(row.status)) return { outcome: 'skip', status: row.status };
      if (row.status === PROCESSING.RESERVED && row.reserved_until > now) return { outcome: 'skip', status: row.status };
      // expired reservation OR failed_temporary -> take over with a NEW lease
      const lease = newLease(); row.status = PROCESSING.RESERVED; row.reserved_until = now + leaseMs; row.lease = lease;
      return { outcome: 'claimed', leaseToken: lease };
    },
    // CAS: only the current lease owner may write a result.
    async record({ key, leaseToken, status, providerId, attempts, error }) {
      const row = rows.get(key);
      if (!row || row.lease !== leaseToken) return false;
      row.status = status; row.providerId = providerId || null; row.attempts = attempts; row.error = error || null;
      if (status !== PROCESSING.RESERVED) row.lease = null; // release on terminal result
      return true;
    },
    async tally(keys) {
      const t = { reserved: 0, accepted: 0, failed_temporary: 0, failed_permanent: 0, in_doubt: 0, skipped: 0 };
      for (const k of keys) { const r = rows.get(k); if (r && r.status in t) t[r.status] += 1; }
      return t;
    },
  };
}

// ---- Mock transport. Behaviour scripted per recipient ----------------------
function makeTransport(script) {
  const attempts = new Map(); // recipient -> count
  const sentOnce = new Map(); // recipient -> times a 2xx was returned
  const calls = { single: 0, batch: 0 };
  function outcomeFor(recipient) {
    const b = script[recipient] || 'ok';
    const a = (attempts.get(recipient) || 0) + 1; attempts.set(recipient, a);
    if (b === 'ok') return { ok: true };
    if (b === 'perm') return { ok: false, status: 400, error: 'bad request' };
    if (b === 'drop') { const e = new Error('ECONNRESET'); e.sentMaybe = true; throw e; }
    if (b === 'temp2') return a <= 2 ? { ok: false, status: 429, retryAfterMs: 1000 } : { ok: true };
    return { ok: true };
  }
  return {
    calls, attempts, sentOnce,
    async sendOne({ to }) {
      calls.single += 1;
      const r = outcomeFor(to);
      if (r.ok) { sentOnce.set(to, (sentOnce.get(to) || 0) + 1); return { ok: true, providerId: `pid_${to}_${Date.now()}` }; }
      return r;
    },
    async sendBatch({ messages }) {
      calls.batch += 1;
      // All-or-nothing at request level (Resend batch returns one status).
      const providerIds = [];
      for (const m of messages) {
        const r = outcomeFor(m.to); // advances attempt counters
        if (!r.ok) return r;
        providerIds.push(`pid_${m.to}`);
      }
      for (const m of messages) sentOnce.set(m.to, (sentOnce.get(m.to) || 0) + 1);
      return { ok: true, providerIds };
    },
  };
}

const META = { reportType: 'debt_daily', period: '2026-11-21', version: 'v1', from: 'نظام متابعة المبيعات <may@hawafel.com>' };
const mk = (recipient, i, extra = {}) => ({ reportId: `region_${i}`, recipient, subject: 'تقرير', html: '<p>x</p>', text: 'x', ...extra });

(async function run() {
  console.log('mailer simulation');

  // 1) idempotency key: stable, <=256, same inputs -> same key
  {
    const k1 = idempotencyKey({ ...META, reportId: 'الرياض', recipient: 'A@B.com' });
    const k2 = idempotencyKey({ ...META, reportId: 'الرياض', recipient: 'a@b.com ' });
    ok('idempotency key stable & case/space-insensitive', k1 === k2);
    ok('idempotency key <= 256 chars', k1.length <= 256);
  }

  // 2) batch-first: 20 ok recipients, budget 10/s -> few batch requests, rate respected
  {
    const clock = makeClock(); const rl = makeRateLimiter(clock, { budget: 10 });
    const store = makeStore(); const tr = makeTransport({});
    const m = createMailer({ transport: tr, store, rateLimiter: rl, now: clock.now, sleep: clock.sleep, batchSize: 10, logger: { warn() {} } });
    const units = Array.from({ length: 20 }, (_, i) => mk(`ok${i}@x.com`, i));
    const s = await m.send(units, META);
    ok('batch grouping: 20 units -> 2 batch requests (not 20)', tr.calls.batch === 2 && tr.calls.single === 0);
    ok('all 20 accepted', s.accepted === 20);
    ok('every recipient received exactly once', units.every((u) => tr.sentOnce.get(u.recipient) === 1));
    ok('shared rate budget never exceeded (<=10 req/s)', rl.maxInAnyWindow() <= 10);
  }

  // 3) retry TEMPORARY only; PERMANENT not retried; per-recipient isolation; in_doubt
  //    (force single path via an attachment so each unit resolves independently)
  {
    const clock = makeClock(); const rl = makeRateLimiter(clock, { budget: 10 });
    const store = makeStore(); const tr = makeTransport({ 't@x.com': 'temp2', 'p@x.com': 'perm', 'd@x.com': 'drop' });
    const m = createMailer({ transport: tr, store, rateLimiter: rl, now: clock.now, sleep: clock.sleep, maxAttempts: 4, logger: { warn() {} }, rng: () => 0 });
    const att = [{ filename: 'a.pdf', content: 'x' }];
    const units = [mk('t@x.com', 1, { attachments: att }), mk('p@x.com', 2, { attachments: att }), mk('d@x.com', 3, { attachments: att }), mk('ok@x.com', 4, { attachments: att })];
    const s = await m.send(units, META);
    ok('temporary failure retried then accepted', store.rows.get(idempotencyKey({ ...META, reportId: 'region_1', recipient: 't@x.com' })).status === PROCESSING.ACCEPTED);
    ok('temporary retried exactly 3 attempts (2x429 + success)', tr.attempts.get('t@x.com') === 3);
    ok('permanent failure NOT retried (1 attempt)', tr.attempts.get('p@x.com') === 1);
    ok('permanent -> failed_permanent', store.rows.get(idempotencyKey({ ...META, reportId: 'region_2', recipient: 'p@x.com' })).status === PROCESSING.FAILED_PERMANENT);
    ok('disconnect -> in_doubt (not auto-resent)', store.rows.get(idempotencyKey({ ...META, reportId: 'region_3', recipient: 'd@x.com' })).status === PROCESSING.IN_DOUBT);
    ok('one failure does not block others (ok delivered)', tr.sentOnce.get('ok@x.com') === 1);
    ok('tally reflects mixed outcomes', s.accepted === 2 && s.failed_permanent === 1 && s.in_doubt === 1);
  }

  // 4) de-dup within window: re-run same units -> zero new sends
  {
    const clock = makeClock(); const rl = makeRateLimiter(clock, { budget: 10 });
    const store = makeStore(); const tr = makeTransport({});
    const m = createMailer({ transport: tr, store, rateLimiter: rl, now: clock.now, sleep: clock.sleep, batchSize: 10, logger: { warn() {} } });
    const units = Array.from({ length: 5 }, (_, i) => mk(`r${i}@x.com`, i));
    await m.send(units, META);
    const firstBatch = tr.calls.batch;
    const s2 = await m.send(units, META); // identical re-run
    ok('re-run sends zero new requests (dedup)', tr.calls.batch === firstBatch);
    ok('re-run marks all skipped', s2.skipped === 5 && s2.reserved === 0);
    ok('each recipient still received exactly once', units.every((u) => tr.sentOnce.get(u.recipient) === 1));
  }

  // 5) in_doubt NOT auto-resent on a later run (within window)
  {
    const clock = makeClock(); const rl = makeRateLimiter(clock, { budget: 10 });
    const store = makeStore(); const tr = makeTransport({ 'd@x.com': 'drop' });
    const m = createMailer({ transport: tr, store, rateLimiter: rl, now: clock.now, sleep: clock.sleep, logger: { warn() {} } });
    const units = [mk('d@x.com', 9, { attachments: [{ filename: 'a.pdf', content: 'x' }] })];
    await m.send(units, META);
    const s2 = await m.send(units, META);
    ok('in_doubt is not resent (skipped on re-run)', s2.skipped === 1 && tr.calls.single === 1);
  }

  // 6) lease recovery: expired reservation reclaimed; stale owner cannot write
  {
    const store = makeStore(); const now0 = 1000; const key = 'k_lease';
    const r1 = await store.reserve({ key, leaseMs: 100, now: now0 });
    ok('worker A claims row', r1.outcome === 'claimed');
    // time passes beyond the lease
    const r2 = await store.reserve({ key, leaseMs: 100, now: now0 + 500 });
    ok('worker B reclaims expired reservation', r2.outcome === 'claimed' && r2.leaseToken !== r1.leaseToken);
    const staleWrite = await store.record({ key, leaseToken: r1.leaseToken, status: PROCESSING.ACCEPTED, attempts: 1 });
    ok('stale worker A write rejected (CAS)', staleWrite === false);
    const freshWrite = await store.record({ key, leaseToken: r2.leaseToken, status: PROCESSING.ACCEPTED, attempts: 1 });
    ok('current owner B write accepted', freshWrite === true);
  }

  // 7) suppressed + killswitch recipients skipped without any send
  {
    const clock = makeClock(); const rl = makeRateLimiter(clock, { budget: 10 });
    const store = makeStore({ suppressed: new Set(['sup@x.com']), disabled: new Set(['off@x.com']) });
    const tr = makeTransport({});
    const m = createMailer({ transport: tr, store, rateLimiter: rl, now: clock.now, sleep: clock.sleep, batchSize: 10, logger: { warn() {} } });
    const units = [mk('sup@x.com', 1), mk('off@x.com', 2), mk('live@x.com', 3)];
    const s = await m.send(units, META);
    ok('suppressed recipient skipped, never sent', (tr.sentOnce.get('sup@x.com') || 0) === 0 && s.suppressed === 1);
    ok('killswitch recipient skipped, never sent', (tr.sentOnce.get('off@x.com') || 0) === 0 && s.disabled === 1);
    ok('live recipient still delivered', tr.sentOnce.get('live@x.com') === 1);
  }

  // 8) concurrent drains of the same queue never double-send
  {
    const clock = makeClock(); const rl = makeRateLimiter(clock, { budget: 10 });
    const store = makeStore(); const tr = makeTransport({});
    const mkM = () => createMailer({ transport: tr, store, rateLimiter: rl, now: clock.now, sleep: clock.sleep, batchSize: 5, logger: { warn() {} } });
    const units = Array.from({ length: 10 }, (_, i) => mk(`c${i}@x.com`, i));
    await Promise.all([mkM().send(units, META), mkM().send(units, META), mkM().send(units, META)]);
    ok('concurrent workers: each recipient sent exactly once', units.every((u) => tr.sentOnce.get(u.recipient) === 1));
  }

  // 9) attachment ownership gate: unverified attachment is never sent
  {
    const clock = makeClock(); const rl = makeRateLimiter(clock, { budget: 10 });
    const store = makeStore(); const tr = makeTransport({});
    const m = createMailer({ transport: tr, store, rateLimiter: rl, now: clock.now, sleep: clock.sleep, logger: { warn() {} }, assertAttachmentOwnership: async (u) => u.recipient === 'owner@x.com' });
    const att = [{ filename: 'a.pdf', content: 'x' }];
    const units = [mk('owner@x.com', 1, { attachments: att }), mk('intruder@x.com', 2, { attachments: att })];
    const s = await m.send(units, META);
    ok('owned attachment delivered', tr.sentOnce.get('owner@x.com') === 1);
    ok('unverified attachment never sent', (tr.sentOnce.get('intruder@x.com') || 0) === 0);
    ok('unverified attachment -> failed_permanent', s.failed_permanent === 1 && s.accepted === 1);
  }

  console.log(`\nALL PASSED (${passed} assertions)`);
})().catch((e) => { console.error('\n' + e.message); process.exit(1); });
