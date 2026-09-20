// Daily debt-aging (accounts-receivable) report — a dedicated, standalone email
// separate from the performance report. Each recipient gets it at their scope:
//   • rep        -> their own debt aging
//   • supervisor -> their team (all their reps/regions)
//   • manager/admin & configured report recipients -> the whole company
//
// Debt figures are a running balance, so each rep's latest snapshot (on/before
// the report date) is the current one; the previous snapshot gives the change.
// Meant to run daily from GitHub Actions (cron '0 5 * * *' = 08:00 Asia/Riyadh).
const { createClient } = require('@supabase/supabase-js');
const { escapeHtml, formatCurrency, formatNumber } = require('../src/lib/reportMetrics');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EMAIL_API_KEY = process.env.RESEND_API_KEY || process.env.EMAIL_API_KEY;
const EMAIL_API_URL = process.env.EMAIL_API_URL || 'https://api.resend.com/emails';
const FROM_EMAIL = process.env.REPORTS_FROM_EMAIL || process.env.FROM_EMAIL || 'may@hawafel.com';
const FROM_NAME = process.env.REPORTS_FROM_NAME || process.env.FROM_NAME || 'نظام متابعة المبيعات';
const APP_URL = process.env.APP_URL || 'https://sales-tracker-ijyb.onrender.com/';
const DRY_RUN = process.env.DRY_RUN === 'true';
const TEST_RECIPIENT = (process.env.TEST_RECIPIENT || '').trim();
// Optional fixed company-report recipients; otherwise admins + data_entry are used.
const ADMIN_REPORT_EMAILS = (process.env.ADMIN_REPORT_EMAILS || '')
  .split(',').map(v => v.trim()).filter(Boolean);

let supabase;
function init() {
  if (!SUPABASE_URL) throw new Error('Missing required secret: SUPABASE_URL');
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error('Missing required secret: SUPABASE_SERVICE_ROLE_KEY');
  if (!EMAIL_API_KEY && !DRY_RUN) throw new Error('Missing required secret: RESEND_API_KEY');
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function formatDateInZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(date).reduce((a, p) => { a[p.type] = p.value; return a; }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}
const todayInRiyadh = () => formatDateInZone(new Date(), 'Asia/Riyadh');

// --- debt helpers -----------------------------------------------------------
const DEBT_BUCKETS = [
  ['debt_1_45', '٤٥-٦٠ يوم'],
  ['debt_over_60', '٦١-٩٠ يوم'],
  ['debt_over_90', '٩١-١٢٠ يوم'],
  ['debt_over_120', '١٢١-١٥٠ يوم'],
  ['debt_over_150', 'فوق ١٥٠ يوم'],
];
const AGED_KEYS = ['debt_over_90', 'debt_over_120', 'debt_over_150'];
const pct = (p, w) => (w > 0 ? Math.round((p / w) * 100) : 0);
const n = (v) => Number(v) || 0;
const agedOf = (d) => AGED_KEYS.reduce((s, k) => s + n(d[k]), 0);
const emptyDebt = () => ({ debt_total: 0, debt_1_45: 0, debt_over_60: 0, debt_over_90: 0, debt_over_120: 0, debt_over_150: 0 });
const addDebt = (acc, d) => { acc.debt_total += n(d.debt_total); DEBT_BUCKETS.forEach(([k]) => { acc[k] += n(d[k]); }); return acc; };

const STYLE = `
  body{margin:0;background:#eef2f7;font-family:Tahoma,Arial,sans-serif;color:#0f172a}
  .wrap{max-width:760px;margin:auto;padding:22px}
  .head{background:linear-gradient(135deg,#0f172a,#1e3a5f);color:#fff;border-radius:14px 14px 0 0;padding:22px 24px}
  .head h1{margin:0;font-size:20px}.head .sub{color:#cbd5e1;font-size:13px;margin-top:6px}
  .body{background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 14px 14px;padding:22px}
  .total{background:#fff7ed;border:1px solid #fed7aa;border-radius:14px;padding:20px;text-align:center;margin-bottom:18px}
  .total .lbl{color:#9a3412;font-size:14px}.total .val{color:#c2410c;font-size:34px;font-weight:800;margin-top:6px}
  .grid{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:18px}
  .b{border:1px solid #e2e8f0;border-radius:12px;padding:16px 10px;text-align:center;background:#f8fafc}
  .b .l{color:#64748b;font-size:12px;display:block;margin-bottom:8px;min-height:32px}
  .b .v{font-size:19px;font-weight:800}.b .p{color:#2563eb;font-size:13px;margin-top:4px;font-weight:700}
  .aged{background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:12px;color:#991b1b;font-size:14px;margin-bottom:16px}
  h2{font-size:15px;margin:18px 0 10px;color:#1e3a5f}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th,td{padding:9px 8px;border-bottom:1px solid #eef2f7;text-align:right;white-space:nowrap}
  thead th{background:#f1f5f9;color:#334155}
  tr.tot td{background:#f8fafc;font-weight:800}
  .tw{overflow-x:auto}
  .ranks{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-top:8px}
  .rc{border:1px solid #e2e8f0;border-radius:14px;padding:16px;background:#fff}
  .rc.top{border-color:#fdba74;background:#fff7ed}
  .rc .rk{display:inline-block;background:#1e3a5f;color:#fff;border-radius:8px;padding:3px 10px;font-size:12px;font-weight:800}
  .rc.top .rk{background:#ea580c}
  .rc .nm{font-weight:800;font-size:16px;margin:10px 0 2px}
  .rc .rg{color:#64748b;font-size:12px}
  .rc .amt{font-size:28px;font-weight:800;color:#c2410c;margin:10px 0 6px}
  .rc .meta{font-size:12px;color:#475569;line-height:1.9}
  .up{color:#ef4444;font-weight:700}.dn{color:#10b981;font-weight:700}.flat{color:#94a3b8}
  .btn{display:inline-block;background:#2563eb;color:#fff;text-decoration:none;border-radius:10px;padding:11px 18px;font-weight:700;margin-top:14px}
  .foot{text-align:center;color:#94a3b8;font-size:12px;padding:14px}
  @media(max-width:560px){.grid{grid-template-columns:1fr 1fr}.ranks{grid-template-columns:1fr}}`;

const shell = (title, sub, inner) => `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8"/><style>${STYLE}</style></head>
<body><div class="wrap">
  <div class="head"><h1>🏦 ${escapeHtml(title)}</h1><div class="sub">${escapeHtml(sub)}</div></div>
  <div class="body">${inner}<a class="btn" href="${escapeHtml(APP_URL)}">فتح تحليل المتأخرات</a></div>
  <div class="foot">تقرير تلقائي من نظام متابعة المبيعات — شركة حوافل</div>
</div></body></html>`;

// Total tile + the five bucket tiles + aged summary, for an aggregate object.
function totalsBlock(agg) {
  const tiles = DEBT_BUCKETS.map(([k, l]) =>
    `<div class="b"><span class="l">${l}</span><span class="v">${formatCurrency(agg[k])}</span><div class="p">${pct(agg[k], agg.debt_total)}%</div></div>`).join('');
  return `
    <div class="total"><div class="lbl">إجمالي الدين</div><div class="val">${formatCurrency(agg.debt_total)}</div></div>
    <div class="grid">${tiles}</div>
    <div class="aged">⏳ الديون المتقادمة (٩١+ يوم): <b>${formatCurrency(agedOf(agg))}</b> — ${pct(agedOf(agg), agg.debt_total)}% من إجمالي الدين</div>`;
}

const changeCell = (change) => {
  if (change == null) return '<span class="flat">—</span>';
  if (change === 0) return '<span class="flat">ثابت</span>';
  return change > 0
    ? `<span class="up">▲ ${formatCurrency(Math.abs(change))}</span>`
    : `<span class="dn">▼ ${formatCurrency(Math.abs(change))}</span>`;
};

// Big ranked cards for the reps in a scope — most overdue (91+) first.
function rankCards(rows, scopeTotal) {
  const sorted = [...rows].sort((a, b) => agedOf(b.d) - agedOf(a.d));
  const cards = sorted.map((r, i) => `
    <div class="rc${i < 3 ? ' top' : ''}">
      <span class="rk">#${i + 1}</span>
      <div class="nm">${escapeHtml(r.name)}</div>
      <div class="rg">${escapeHtml(r.region || '-')}</div>
      <div class="amt">${formatCurrency(n(r.d.debt_total))}</div>
      <div class="meta">
        ${pct(n(r.d.debt_total), scopeTotal)}% من الإجمالي · متقادمة (٩١+) ${pct(agedOf(r.d), n(r.d.debt_total))}%<br/>
        التغيّر عن آخر إدخال: ${changeCell(r.change)}
      </div>
    </div>`).join('');
  return `<div class="ranks">${cards}</div>`;
}

// Aggregate rows by a key (region/supervisor) into a summary table.
function groupTable(rows, keyField, keyHeader, companyTotal) {
  const map = new Map();
  for (const r of rows) {
    const key = r[keyField] || '—';
    const g = map.get(key) || { name: key, reps: 0, ...emptyDebt() };
    addDebt(g, r.d); g.reps += 1; map.set(key, g);
  }
  const groups = [...map.values()].sort((a, b) => b.debt_total - a.debt_total);
  const body = groups.map(g => `
    <tr>
      <td><b>${escapeHtml(g.name)}</b></td>
      <td>${formatNumber(g.reps)}</td>
      <td>${formatCurrency(g.debt_total)}</td>
      <td>${pct(g.debt_total, companyTotal)}%</td>
      <td>${formatCurrency(agedOf(g))}</td>
      <td>${pct(agedOf(g), g.debt_total)}%</td>
    </tr>`).join('');
  return `<h2>${escapeHtml(keyHeader)}</h2><div class="tw"><table>
    <thead><tr><th>${escapeHtml(keyHeader)}</th><th>مناديب</th><th>إجمالي الدين</th><th>% من الشركة</th><th>متقادمة (٩١+)</th><th>% متقادم</th></tr></thead>
    <tbody>${body}</tbody></table></div>`;
}

// --- email builders ---------------------------------------------------------
function repDebtEmail(to, row, date) {
  const agg = addDebt(emptyDebt(), row.d);
  const inner = totalsBlock(agg)
    + (row.change != null ? `<p style="font-size:14px">التغيّر عن آخر إدخال: ${changeCell(row.change)}</p>` : '')
    + `<h2>توزيع الدين على الفترات</h2>`
    + `<div class="tw"><table><thead><tr><th>الفترة</th><th>المبلغ</th><th>% من الإجمالي</th></tr></thead><tbody>`
    + DEBT_BUCKETS.map(([k, l]) => `<tr><td>${l}</td><td>${formatCurrency(n(row.d[k]))}</td><td>${pct(n(row.d[k]), agg.debt_total)}%</td></tr>`).join('')
    + `</tbody></table></div>`;
  return { to, subject: `تقرير المتأخرات — ${row.name} — ${date}`, html: shell('تقرير المتأخرات', `${row.name}${row.region ? ' — ' + row.region : ''} · ${date}`, inner), kind: 'rep' };
}

function scopeDebtEmail(to, title, subtitle, rows, date, { byRegion = false, bySupervisor = false } = {}) {
  const agg = rows.reduce((a, r) => addDebt(a, r.d), emptyDebt());
  let inner = totalsBlock(agg);
  if (byRegion) inner += groupTable(rows, 'region', 'المنطقة', agg.debt_total);
  if (bySupervisor) inner += groupTable(rows, 'supervisor', 'المشرف', agg.debt_total);
  inner += `<h2>المناديب — الأكثر تأخيرًا أولًا (٩١+ يوم)</h2>` + rankCards(rows, agg.debt_total);
  return { to, subject: `${title} — ${date}`, html: shell(title, `${subtitle} · ${date}`, inner), kind: bySupervisor ? 'company' : 'supervisor' };
}

async function sendEmail(email) {
  if (DRY_RUN) { console.log(`[DRY_RUN] ${email.to} | ${email.subject}`); return; }
  const res = await fetch(EMAIL_API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${EMAIL_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: `${FROM_NAME} <${FROM_EMAIL}>`, to: [email.to], subject: email.subject, html: email.html }),
  });
  if (!res.ok) throw new Error(`Email failed for ${email.to}: ${res.status} ${await res.text()}`);
}

async function listAuthUsers() {
  const users = [];
  for (let page = 1; page < 100; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    users.push(...(data.users || []));
    if (!data.users || data.users.length < 1000) break;
  }
  return users;
}

async function main() {
  const REPORT_DATE = process.env.REPORT_DATE || todayInRiyadh();

  const [repsRes, rolesRes, mgrsRes, users, debtRes] = await Promise.all([
    supabase.from('representatives').select('id,name,is_active,supervisor_id,supervisors(name),regions(name)').eq('is_active', true),
    supabase.from('user_roles').select('user_id,rep_id,supervisor_id,role'),
    supabase.from('managers').select('email').eq('is_active', true),
    listAuthUsers(),
    supabase.from('daily_entries')
      .select('rep_id, entry_date, debt_total, debt_1_45, debt_over_60, debt_over_90, debt_over_120, debt_over_150')
      .lte('entry_date', REPORT_DATE)
      .not('field_owners->>debt_total', 'is', null)
      .order('entry_date', { ascending: false })
      .limit(20000),
  ]);
  if (repsRes.error) throw repsRes.error;
  if (rolesRes.error) throw rolesRes.error;

  const reps = repsRes.data || [];
  const roles = rolesRes.data || [];
  const repById = new Map(reps.map(r => [r.id, r]));
  const emailByUserId = Object.fromEntries(users.map(u => [u.id, u.email]));
  const emailByRepId = {};
  roles.filter(r => r.role === 'rep').forEach(r => { if (r.rep_id && emailByUserId[r.user_id]) emailByRepId[r.rep_id] = emailByUserId[r.user_id]; });

  // Latest debt snapshot per rep (+ previous for the change).
  const byRep = new Map();
  for (const d of (debtRes.data || [])) {
    const list = byRep.get(d.rep_id) || [];
    list.push(d); byRep.set(d.rep_id, list);
  }
  // Build enriched rows (only reps that have debt data and are still active).
  const rows = [];
  for (const [repId, list] of byRep.entries()) {
    const rep = repById.get(repId);
    if (!rep) continue;
    rows.push({
      repId,
      name: rep.name,
      region: rep.regions?.name || 'بدون منطقة',
      supervisor: rep.supervisors?.name || 'بدون مشرف',
      supervisorId: rep.supervisor_id,
      d: list[0],
      change: list[1] != null ? n(list[0].debt_total) - n(list[1].debt_total) : null,
    });
  }
  const rowByRepId = new Map(rows.map(r => [r.repId, r]));

  const outbox = [];

  // 1) Per-rep debt email
  for (const r of rows) {
    const email = emailByRepId[r.repId];
    if (email) outbox.push(repDebtEmail(email, r, REPORT_DATE));
  }

  // 2) Per-supervisor: their team's debt
  const supervisors = roles.filter(r => r.role === 'supervisor' && r.supervisor_id && emailByUserId[r.user_id]);
  for (const sup of supervisors) {
    const team = rows.filter(r => r.supervisorId === sup.supervisor_id);
    if (!team.length) continue;
    const supName = team[0].supervisor;
    outbox.push(scopeDebtEmail(emailByUserId[sup.user_id], 'تقرير متأخرات الفريق', `فريق ${supName}`, team, REPORT_DATE, { byRegion: true }));
  }

  // 3) Company-wide: admins + data_entry (or ADMIN_REPORT_EMAILS) + active managers
  const baseCompany = ADMIN_REPORT_EMAILS.length
    ? ADMIN_REPORT_EMAILS
    : roles.filter(r => r.role === 'admin' || r.role === 'data_entry').map(r => emailByUserId[r.user_id]).filter(Boolean);
  const managerEmails = (mgrsRes.data || []).map(m => m.email).filter(Boolean);
  const companyRecipients = [...new Set([...baseCompany, ...managerEmails].map(e => String(e).trim().toLowerCase()).filter(Boolean))];
  if (rows.length) {
    for (const to of companyRecipients) {
      outbox.push(scopeDebtEmail(to, 'تقرير متأخرات الشركة', 'كل المناطق', rows, REPORT_DATE, { byRegion: true, bySupervisor: true }));
    }
  }

  // Test mode: one sample of each kind to a single address.
  let toSend = outbox;
  if (TEST_RECIPIENT) {
    const seen = new Set();
    toSend = outbox.filter(e => (seen.has(e.kind) ? false : (seen.add(e.kind), true)))
      .map(e => ({ ...e, to: TEST_RECIPIENT, subject: `[تجربة] ${e.subject}` }));
    console.log(`TEST mode: ${toSend.length} sample(s) -> ${TEST_RECIPIENT} (kinds: ${[...seen].join(', ') || 'none'})`);
  }

  let sent = 0, failed = 0;
  for (const email of toSend) {
    try { await sendEmail(email); sent += 1; }
    catch (e) { failed += 1; console.error(`::error title=Debt email failed::${(e?.message || String(e)).replace(/\r?\n/g, ' ')}`); }
  }
  console.log(`Debt reports complete. date=${REPORT_DATE} reps=${rows.length} supervisors=${supervisors.length} company=${companyRecipients.length} queued=${toSend.length} sent=${sent} failed=${failed}`);
  if (rowByRepId.size === 0) console.log('No debt data found — nothing meaningful to report.');
  if (failed > 0) process.exit(1);
}

if (require.main === module) {
  init();
  main().catch(e => {
    console.error(`::error title=Debt report failed::${(e?.message || String(e)).replace(/\r?\n/g, ' ')}`);
    console.error(e);
    process.exit(1);
  });
}

module.exports = { repDebtEmail, scopeDebtEmail };
