// Supabase-backed store for the mailer: atomic reservation + CAS result writes
// via SQL functions, plus suppression and kill-switch checks.
//
// Backend-only: constructed with the service-role client (bypasses RLS).

function createReportStore({ supabase, resendApiKey, logger = console }) {
  let suppressed = null;          // Set<string> lower-cased, lazily loaded
  let disabledScopes = null;      // Set<string> of disabled scopes

  async function loadSuppressions() {
    if (suppressed) return suppressed;
    suppressed = new Set();
    if (!resendApiKey) return suppressed;
    try {
      // Page through the account suppression list once per run.
      let url = 'https://api.resend.com/suppressions?limit=100';
      for (let guard = 0; guard < 50 && url; guard += 1) {
        const res = await fetch(url, { headers: { Authorization: `Bearer ${resendApiKey}` } });
        if (!res.ok) { logger.warn?.(`suppression fetch ${res.status}`); break; }
        const j = await res.json().catch(() => ({}));
        const rows = j.data || j.suppressions || [];
        for (const r of rows) if (r && r.email) suppressed.add(String(r.email).trim().toLowerCase());
        // Pagination shape varies; stop unless a clear next cursor exists.
        url = j.next ? `https://api.resend.com/suppressions?limit=100&after=${encodeURIComponent(j.next)}` : null;
      }
    } catch (e) { logger.warn?.(`suppression load failed: ${e.message}`); }
    return suppressed;
  }

  async function loadDisabled() {
    if (disabledScopes) return disabledScopes;
    disabledScopes = new Set();
    const { data, error } = await supabase.from('automation_settings').select('scope,disabled').eq('disabled', true);
    if (error) { logger.warn?.(`automation_settings read failed: ${error.message}`); return disabledScopes; }
    for (const r of data || []) disabledScopes.add(r.scope);
    return disabledScopes;
  }

  return {
    async ready() { await Promise.all([loadSuppressions(), loadDisabled()]); return this; },

    async isSuppressed(recipient) {
      const s = await loadSuppressions();
      return s.has(String(recipient).trim().toLowerCase());
    },

    async isDisabled({ reportType, recipient }) {
      const s = await loadDisabled();
      if (s.has('global')) return true;
      if (reportType && s.has(reportType)) return true;
      if (recipient && s.has(`recipient:${String(recipient).trim().toLowerCase()}`)) return true;
      return false;
    },

    async reserve({ key, leaseMs, unit, meta }) {
      const { data, error } = await supabase.rpc('reserve_report_send', {
        p_key: key, p_type: meta.reportType, p_id: unit.reportId,
        p_period: meta.period, p_version: meta.version, p_recipient: unit.recipient,
        p_lease_ms: leaseMs,
      });
      if (error) { logger.warn?.(`reserve failed ${key}: ${error.message}`); return { outcome: 'skip', status: 'error' }; }
      const row = Array.isArray(data) ? data[0] : data;
      if (row && row.outcome === 'claimed') return { outcome: 'claimed', leaseToken: row.lease };
      return { outcome: 'skip', status: row ? row.outcome : 'skip' };
    },

    async record({ key, leaseToken, status, providerId, attempts, error, batchId }) {
      const { data, error: e } = await supabase.rpc('record_report_send', {
        p_key: key, p_lease: leaseToken, p_status: status, p_provider: providerId || null,
        p_attempts: attempts, p_error: error || null, p_batch_id: batchId || null,
      });
      if (e) { logger.warn?.(`record failed ${key}: ${e.message}`); return false; }
      return data === true;
    },

    // Best-effort audit of a skipped (suppressed/killswitch) recipient. Never
    // overwrites an existing terminal row.
    async reserveSkip({ key, status, reason, unit, meta }) {
      const { error } = await supabase.from('report_send_log').insert({
        idempotency_key: key, report_type: meta.reportType, report_id: unit.reportId,
        period: meta.period, version: meta.version, recipient: unit.recipient,
        processing_status: status, attempts: 0, error: reason,
      });
      if (error && !String(error.message || '').toLowerCase().includes('duplicate')) {
        logger.warn?.(`reserveSkip ${key}: ${error.message}`);
      }
    },

    async tally(keys) {
      const t = { accepted: 0, failed_temporary: 0, failed_permanent: 0, in_doubt: 0, reserved: 0, skipped: 0 };
      if (!keys.length) return t;
      const { data, error } = await supabase.from('report_send_log').select('processing_status').in('idempotency_key', keys);
      if (error) { logger.warn?.(`tally failed: ${error.message}`); return t; }
      for (const r of data || []) if (r.processing_status in t) t[r.processing_status] += 1;
      return t;
    },
  };
}

module.exports = { createReportStore };
