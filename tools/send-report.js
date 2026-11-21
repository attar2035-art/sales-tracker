// Generic runner for the backend report senders. One workflow per report calls:
//   node tools/send-report.js <name>
// where <name> is a key in report-builders REGISTRY. Handles the mandatory
// upload precondition, the kill switch (via deliver/store), data fetch, unit
// building, and delivery through the shared hardened mailer.

const { createClient } = require('@supabase/supabase-js');
const { REGISTRY } = require('./lib/report-builders');
const { deliverReports } = require('./lib/deliver');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FROM_EMAIL = process.env.REPORTS_FROM_EMAIL || process.env.FROM_EMAIL || 'salesmanager@hawafel.com';
const FROM_NAME = process.env.REPORTS_FROM_NAME || process.env.FROM_NAME || 'إدارة المبيعات — حوافل';
const DRY_RUN = process.env.DRY_RUN === 'true';

const todayRiyadh = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

async function main() {
  const name = process.argv[2];
  const report = REGISTRY[name];
  if (!report) { console.error(`Unknown report '${name}'. Known: ${Object.keys(REGISTRY).join(', ')}`); process.exit(2); }
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const period = process.env.REPORT_DATE || todayRiyadh();
  const ctx = { supabase, period };

  if (report.precondition) {
    const pc = await report.precondition(ctx);
    if (!pc.ok) { console.log(`⏸️ ${name} skipped — ${pc.reason}`); return; }
  }

  const data = await report.fetch(ctx);
  const deliverPeriod = data.period || period;
  let units = report.buildUnits(data, deliverPeriod);
  if (!units.length) { console.log(`${name}: nothing to send (no qualifying rows for ${deliverPeriod}).`); return; }

  // Test mode: redirect every unit to one approved address (never the team).
  const TEST_RECIPIENT = (process.env.TEST_RECIPIENT || '').trim();
  if (TEST_RECIPIENT) {
    units = units.map((u, i) => ({ ...u, recipient: TEST_RECIPIENT, reportId: `test:${u.reportId}:${i}`, subject: `[تجربة] ${u.subject}` }));
    console.log(`TEST mode: ${units.length} unit(s) redirected to ${TEST_RECIPIENT}`);
  }

  const s = await deliverReports(units, {
    reportType: report.reportType, period: deliverPeriod, version: report.version,
    fromName: FROM_NAME, fromEmail: FROM_EMAIL, dryRun: DRY_RUN,
  });
  console.log(`${name} complete. period=${deliverPeriod} units=${units.length} ${JSON.stringify(s)}`);
  const needsAttention = (s.failed_permanent || 0) + (s.in_doubt || 0);
  if (needsAttention > 0) { console.error(`::error title=${name} needs attention::failed_permanent=${s.failed_permanent} in_doubt=${s.in_doubt}`); process.exitCode = 1; }
}

if (require.main === module) {
  main().catch((e) => { console.error(`::error title=send-report failed::${(e?.message || String(e)).replace(/\r?\n/g, ' ')}`); console.error(e); process.exit(1); });
}

module.exports = { main };
