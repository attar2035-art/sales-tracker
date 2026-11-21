/* Simulation tests for the backend report builders (tools/lib/report-builders).
 * Pure buildUnits() are exercised with mock data — no DB, no network, no email.
 * Preconditions are tested against a tiny fake Supabase. Also asserts recipient
 * scope and idempotency-key uniqueness. Run: node tools/__tests__/reports.sim.js
 */
const assert = require('assert');
const { REGISTRY } = require('../lib/report-builders');
const { idempotencyKey } = require('../lib/mailer');
const D = require('../lib/report-data');
const cfg = require('../lib/report-config');

let passed = 0;
const ok = (name, cond) => { if (!cond) { console.error(`  ✗ ${name}`); throw new Error(`FAILED: ${name}`); } passed += 1; console.log(`  ✓ ${name}`); };

const uniqueKeys = (report, units, period) => {
  const keys = units.map((u) => idempotencyKey({ reportType: report.reportType, reportId: u.reportId, period, version: report.version, recipient: u.recipient }));
  return new Set(keys).size === keys.length;
};

function cust(name, over60, total, limit, slice) {
  const c = { name, over60, debt_total: total, credit_limit: limit || 0 };
  c.debt_over_60 = slice === '61-90' ? over60 : 0;
  c.debt_over_90 = slice === '91-120' ? over60 : 0;
  c.debt_over_120 = slice === '121-150' ? over60 : 0;
  c.debt_over_150 = slice === 'فوق 150' ? over60 : 0;
  return c;
}
function regionStat(repName, { total, d4560, over60, buckets, count, customers }) {
  return { rep: { id: repName, name: repName }, agg: { total, cur: total - (d4560 + over60), d4560, over60, buckets, count, customers }, coll: 50000, targetColl: 100000, targetSales: 200000, salesMtd: 90000 };
}

function debtData(period) {
  const rs = new Map();
  const mk = (region, rep, over60) => rs.set(region, regionStat(rep, { total: over60 * 3, d4560: over60, over60, buckets: [over60, 0, 0, 0], count: 5, customers: [cust('عميل ١', over60 * 0.6, over60 * 4, over60 * 2, '61-90'), cust('عميل ٢', over60 * 0.4, over60 * 0.1, over60, 'فوق 150')] }));
  mk('جيزان وخميس مشيط', 'احمد شاهين', 100000);
  mk('المدينه', 'محمد فرغلي', 90000);
  mk('جده واحد', 'عبدالهادي', 40000);
  mk('جده اثنين', 'إبراهيم شاهين', 150000);
  mk('الرياض', 'بهاء', 94000);
  mk('الرياض ٢ و٣', 'محمد معمر', 42000);
  return { regionStats: rs, period };
}

// Tiny fake Supabase for uploadStatusToday(): .from().select().gte() -> {data}
function fakeSupabase(auditRows) {
  return { from() { return { select() { return { gte() { return Promise.resolve({ data: auditRows, error: null }); } }; } }; } };
}

(async function run() {
  console.log('report builders simulation');
  const PERIOD = '2026-11-21';

  // 1) manager-debt: 3 managers, correct recipients + scope + unique keys
  {
    const r = REGISTRY['manager-debt'];
    const units = r.buildUnits(debtData(PERIOD), PERIOD);
    ok('manager-debt: 3 units', units.length === 3);
    ok('manager-debt: recipients match config', JSON.stringify(units.map((u) => u.recipient).sort()) === JSON.stringify(cfg.MANAGER_DEBT.map((m) => m.to).sort()));
    const ramy = units.find((u) => u.recipient === 'ramyomar@hawafel.com');
    ok('manager-debt: ramy scoped to Riyadh regions', ramy.html.includes('الرياض') && ramy.html.includes('محمد معمر') && !ramy.html.includes('جده اثنين'));
    ok('manager-debt: has collection line', ramy.html.includes('التحصيل هذا الشهر'));
    ok('manager-debt: unique idempotency keys', uniqueKeys(r, units, PERIOD));
  }

  // 2) manager-debt precondition gating
  {
    const r = REGISTRY['manager-debt'];
    const none = await r.precondition({ supabase: fakeSupabase([]) });
    ok('precondition blocks when nothing uploaded', none.ok === false && /ماترفعتش/.test(none.reason));
    const both = await r.precondition({ supabase: fakeSupabase([
      { event_type: 'import', entity_type: 'customers', created_at: new Date().toISOString() },
      { event_type: 'update', entity_type: 'daily_entries', created_at: new Date().toISOString() },
    ]) });
    ok('precondition passes when both uploaded', both.ok === true);
    const onlyDebt = await r.precondition({ supabase: fakeSupabase([{ event_type: 'import', entity_type: 'customers', created_at: new Date().toISOString() }]) });
    ok('precondition blocks when collection missing', onlyDebt.ok === false && /أميرة/.test(onlyDebt.reason));
  }

  // 3) credit-control: single recipient, top-10 heading, over-limit flag, grand total
  {
    const r = REGISTRY['credit-control'];
    const units = r.buildUnits(debtData(PERIOD), PERIOD);
    ok('credit-control: 1 unit to credit-control@', units.length === 1 && units[0].recipient === cfg.CREDIT_CONTROL_TO);
    ok('credit-control: top-10 heading', units[0].html.includes('أعلى 10'));
    ok('credit-control: over-limit marker present', units[0].html.includes('⚠️'));
    ok('credit-control: grand total line', units[0].html.includes('الإجمالي العام'));
  }

  // 4) targets: 5 managers, totals row, expected %
  {
    const r = REGISTRY.targets;
    const units = r.buildUnits(debtData(PERIOD), PERIOD);
    ok('targets: 5 manager units', units.length === 5);
    ok('targets: recipients = managers', JSON.stringify(units.map((u) => u.recipient).sort()) === JSON.stringify(cfg.MANAGERS.map((m) => m.email).sort()));
    ok('targets: totals + expected present', units[0].html.includes('الإجمالي') && units[0].html.includes('المتوقع'));
    ok('targets: unique keys per recipient', uniqueKeys(r, units, PERIOD));
  }

  // 5) route-plan: managers get all, supervisor scoped, phone bidi stripped
  {
    const r = REGISTRY['route-plan'];
    const row = (rep, region, phone) => ({ representatives: { name: rep, is_active: true, regions: { name: region } }, customer_name: 'ص', city: 'مدينة', neighborhood: 'حي', phone, contact_person: 'مسؤول', sort_order: 1, off_plan: false, visited: false });
    const data = { rows: [row('بهاء', 'الرياض', '‎0501234567'), row('احمد شاهين', 'جيزان وخميس مشيط', '0557654321')], planDate: PERIOD, period: PERIOD };
    const units = r.buildUnits(data, PERIOD);
    const mgr = units.filter((u) => cfg.MANAGERS.some((m) => m.email === u.recipient));
    ok('route-plan: 5 manager emails with all plans', mgr.length === 5 && mgr[0].html.includes('بهاء') && mgr[0].html.includes('احمد شاهين'));
    const ramy = units.find((u) => u.recipient === 'ramyomar@hawafel.com');
    ok('route-plan: supervisor scoped to own region only', ramy && ramy.html.includes('بهاء') && !ramy.html.includes('احمد شاهين'));
    ok('route-plan: phone bidi marks stripped', mgr[0].html.includes('0501234567') && !mgr[0].html.includes('‎'));
  }

  // 6) route-adherence: managers + supervisor, adherence % colouring
  {
    const r = REGISTRY['route-adherence'];
    const row = (rep, region, visited, off) => ({ representatives: { name: rep, is_active: true, regions: { name: region } }, customer_name: 'ص', off_plan: off, visited });
    const data = { rows: [row('بهاء', 'الرياض', true, false), row('بهاء', 'الرياض', false, false), row('احمد شاهين', 'جيزان وخميس مشيط', true, false)], planDate: '2026-11-20', period: '2026-11-20' };
    const units = r.buildUnits(data, '2026-11-20');
    const mgr = units.filter((u) => cfg.MANAGERS.some((m) => m.email === u.recipient));
    ok('route-adherence: 5 manager emails', mgr.length === 5);
    ok('route-adherence: shows execution %', mgr[0].html.includes('%') && mgr[0].html.includes('التنفيذ'));
  }

  // 7) aya: single recipient, unconfirmed-yesterday -> red first line
  {
    const r = REGISTRY['aya-visit-confirm'];
    const byDate = new Map([
      ['2026-11-20', { total: 1, visited: 0, last: '2026-11-19T08:29:23' }],
      ['2026-11-19', { total: 45, visited: 32, last: '2026-11-20T01:36:14' }],
    ]);
    const data = { byDate, yesterday: '2026-11-20', today: '2026-11-21', period: '2026-11-21' };
    const units = r.buildUnits(data, '2026-11-21');
    ok('aya: 1 unit to owner', units.length === 1 && units[0].recipient === cfg.AYA_TO);
    ok('aya: unconfirmed yesterday flagged', units[0].html.includes('غير مؤكَّد') && units[0].text.includes('غير مؤكَّد'));
    ok('aya: no backlog (older day confirmed)', units[0].html.includes('مفيش متأخر متراكم'));
  }

  // 8) per-manager variants keep their own single recipient (own send time)
  {
    const walid = REGISTRY['manager-debt-walid'].buildUnits(debtData(PERIOD), PERIOD);
    const ahmed = REGISTRY['manager-debt-ahmed'].buildUnits(debtData(PERIOD), PERIOD);
    const ramy = REGISTRY['manager-debt-ramy'].buildUnits(debtData(PERIOD), PERIOD);
    ok('manager-debt-walid: 1 unit to ws112021@', walid.length === 1 && walid[0].recipient === 'ws112021@gmail.com');
    ok('manager-debt-ahmed: 1 unit to ahmedattar88@', ahmed.length === 1 && ahmed[0].recipient === 'ahmedattar88@gmail.com');
    ok('manager-debt-ramy: 1 unit to ramyomar@', ramy.length === 1 && ramy[0].recipient === 'ramyomar@hawafel.com');
    ok('variant scope preserved (walid = جيزان/المدينة only)', walid[0].html.includes('جيزان وخميس مشيط') && !walid[0].html.includes('الرياض'));
  }

  // 9) weekly collection: per-rep + ceo copy, skips reps with no email
  {
    const r = REGISTRY['weekly-collection'];
    const data = { period: '2026-11-21', remainingDays: 20, rows: [
      { repId: 'r1', name: 'بهاء', region: 'الرياض', email: 'bahaa@x.com', target: 200000, collected: 60000, remaining: 140000, over60: 94000, debtTotal: 489000, daily: 7000 },
      { repId: 'r2', name: 'بلا بريد', region: 'القصيم', email: null, target: 50000, collected: 10000, remaining: 40000, over60: 5000, debtTotal: 80000, daily: 2000 },
    ] };
    const units = r.buildUnits(data);
    ok('weekly: rep gets email + ceo copy (2 units for 1 emailed rep)', units.length === 2);
    ok('weekly: rep recipient + ceo recipient', units.some((u) => u.recipient === 'bahaa@x.com') && units.some((u) => u.recipient === 'ceo@hawafel.com'));
    ok('weekly: rep without email is skipped', !units.some((u) => u.html.includes('بلا بريد')));
    ok('weekly: unique idempotency keys', uniqueKeys(r, units, '2026-11-21'));
    ok('weekly: subject preserved', units[0].subject.includes('هدف التحصيل والمتأخرات'));
  }

  console.log(`\nALL PASSED (${passed} assertions)`);
})().catch((e) => { console.error('\n' + e.message); process.exit(1); });
