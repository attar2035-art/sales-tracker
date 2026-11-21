// Shared rate limiter backed by the acquire_send_token SQL function, so every
// concurrent GitHub Actions job / process competes for ONE team-wide budget
// (Resend's 10 req/s is per-team, shared across all keys/SMTP/batch). Falls
// back to an in-process token bucket when no supabase client is supplied
// (dry-run / local simulation).

function createDbRateLimiter({ supabase, budget = 8, windowMs = 1000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), logger = console }) {
  return {
    async acquire() {
      for (let guard = 0; guard < 10000; guard += 1) {
        const { data, error } = await supabase.rpc('acquire_send_token', { p_budget: budget, p_window_ms: windowMs });
        if (error) { logger.warn?.(`acquire_send_token failed: ${error.message}`); await sleep(windowMs); return; }
        const waitMs = Number(data) || 0;
        if (waitMs <= 0) return;
        await sleep(Math.min(waitMs, windowMs));
      }
    },
    penalize(ms) { /* window-based limiter self-heals; honoured via retry backoff */ void ms; },
  };
}

function createLocalRateLimiter({ budget = 8, windowMs = 1000, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  let tokens = budget; let last = now();
  return {
    async acquire() {
      for (;;) {
        const t = now(); const add = ((t - last) / windowMs) * budget;
        if (add > 0) { tokens = Math.min(budget, tokens + add); last = t; }
        if (tokens >= 1) { tokens -= 1; return; }
        await sleep(Math.ceil(((1 - tokens) / budget) * windowMs));
      }
    },
    penalize() {},
  };
}

module.exports = { createDbRateLimiter, createLocalRateLimiter };
