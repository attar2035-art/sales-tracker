const { createClient } = require('@supabase/supabase-js');
const {
  MONTHS_AR,
  getMonthProgressUntil,
  getRemainingWorkingDaysAfter,
  formatNumber,
  formatCurrency,
  targetForMonth,
  percent,
  escapeHtml,
  computeRepMetrics,
  aggregateMetrics,
} = require('../src/lib/reportMetrics');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EMAIL_API_KEY = process.env.RESEND_API_KEY || process.env.EMAIL_API_KEY;
const EMAIL_API_URL = process.env.EMAIL_API_URL || 'https://api.resend.com/emails';
const FROM_EMAIL = process.env.REPORTS_FROM_EMAIL || process.env.FROM_EMAIL || 'may@hawafel.com';
const FROM_NAME = process.env.REPORTS_FROM_NAME || process.env.FROM_NAME || 'نظام متابعة المبيعات';
const APP_URL = process.env.APP_URL || 'https://sales-tracker-ijyb.onrender.com/';
const DRY_RUN = process.env.DRY_RUN === 'true';
// Optional fixed full-report recipients (comma-separated). When empty,
// recipients are auto-detected from user_roles (role='admin' or 'data_entry').
const ADMIN_REPORT_EMAILS = (process.env.ADMIN_REPORT_EMAILS || '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);
// Test mode: when set, send ONE sample of each report type (rep, full,
// supervisor) to this single address instead of the real recipients.
const TEST_RECIPIENT = (process.env.TEST_RECIPIENT || '').trim();

// Supabase client is created lazily so this file can be `require`d in tests
// (to exercise the email builders) without valid secrets or network access.
let supabase;

function validateEnvAndInit() {
  if (!SUPABASE_URL) throw new Error('Missing required secret: SUPABASE_URL');
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error('Missing required secret: SUPABASE_SERVICE_ROLE_KEY');
  if (!EMAIL_API_KEY && !DRY_RUN) throw new Error('Missing required secret: RESEND_API_KEY');
  if (!/^[\x20-\x7E]+$/.test(SUPABASE_SERVICE_ROLE_KEY) || !/^(eyJ|sb_secret_)/.test(SUPABASE_SERVICE_ROLE_KEY)) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is invalid. Paste the real Supabase service_role key, not placeholder text.');
  }
  if (!DRY_RUN && (!/^[\x20-\x7E]+$/.test(EMAIL_API_KEY) || !EMAIL_API_KEY.startsWith('re_'))) {
    throw new Error('RESEND_API_KEY is invalid. Paste the real Resend API key value that starts with re_, not placeholder text.');
  }
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function getYesterdayInRiyadh() {
  const date = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return formatDateInZone(date, 'Asia/Riyadh');
}

function formatDateInZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

const EMAIL_STYLE = `
    body{margin:0;background:#f1f5f9;font-family:Tahoma,Arial,sans-serif;color:#0f172a}
    .wrap{max-width:820px;margin:auto;padding:24px}
    .card{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:22px;margin-bottom:14px}
    h1{margin:0 0 8px;font-size:24px;color:#1d4ed8}
    h2{margin:0 0 14px;font-size:18px}
    .muted{color:#64748b;font-size:14px;line-height:1.8}
    .grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
    .stat{border:1px solid #e2e8f0;border-radius:10px;padding:12px;background:#f8fafc}
    .stat span{display:block;color:#64748b;font-size:13px;margin-bottom:6px}
    .stat strong{font-size:20px;color:#0f172a}
    .pill{display:inline-block;padding:5px 10px;border-radius:999px;background:#dbeafe;color:#1d4ed8;font-weight:700;font-size:13px}
    .danger{background:#fee2e2;color:#b91c1c}.ok{background:#dcfce7;color:#166534}.warn{background:#fef3c7;color:#92400e}
    table{width:100%;border-collapse:collapse;font-size:14px}
    td,th{padding:9px 8px;border-bottom:1px solid #e2e8f0;text-align:right;white-space:nowrap}
    thead th{background:#f8fafc;color:#334155}
    tr.total td{background:#f1f5f9;font-weight:800}
    .tablewrap{overflow-x:auto}
    a.btn{display:inline-block;background:#2563eb;color:#fff;text-decoration:none;border-radius:10px;padding:12px 18px;font-weight:700}
    @media(max-width:640px){.grid{grid-template-columns:1fr}}`;

function statusPillClass(status) {
  if (status === 'متأخر') return 'danger';
  if (status === 'متقدم') return 'ok';
  return 'warn';
}

function buildRepEmail(metrics, email, reportDate, remainingDays) {
  const { rep, yesterday, breakdown, requiredSalesDaily, requiredCollectionDaily, requiredVisitsDaily } = metrics;
  const [year, monthNum] = reportDate.split('-').map(Number);
  const fmt = (row, value) => (row.currency ? formatCurrency(value) : formatNumber(value));
  const subject = `تقرير أداء أمس - ${rep.name} - ${reportDate}`;

  const text = [
    `تقرير أداء أمس للمندوب: ${rep.name}`,
    `التاريخ: ${reportDate}`,
    `المنطقة: ${rep.regions?.name || '-'}`,
    '',
    `مبيعات أمس: ${formatCurrency(yesterday.sales)}`,
    `تحصيل أمس: ${formatCurrency(yesterday.collection)}`,
    `زيارات أمس: ${formatNumber(yesterday.visits)} (ناجحة ${formatNumber(yesterday.successfulVisits)})`,
    `عملاء جدد أمس: ${formatNumber(yesterday.newCustomers)}`,
    '',
    'موقف الشهر حتى أمس:',
    ...breakdown.map(row => row.target > 0
      ? `- ${row.label}: المحقق ${fmt(row, row.achieved)} من ${fmt(row, row.target)} (${row.percent}%) · المتبقي ${fmt(row, row.remaining)} · يوميًا ${fmt(row, row.dailyRequired)} · ${row.status}`
      : `- ${row.label}: المحقق ${fmt(row, row.achieved)} (بدون هدف)`),
    '',
    `المطلوب يوميًا: مبيعات ${formatCurrency(requiredSalesDaily)} · تحصيل ${formatCurrency(requiredCollectionDaily)} · زيارات ${formatNumber(Math.ceil(requiredVisitsDaily))}`,
    `أيام العمل المتبقية: ${formatNumber(remainingDays)}`,
    APP_URL,
  ].join('\n');

  const breakdownRows = breakdown.map(row => {
    if (row.target > 0) {
      return `
        <tr>
          <td>${escapeHtml(row.label)}</td>
          <td>${fmt(row, row.achieved)}</td>
          <td>${fmt(row, row.target)}</td>
          <td>${fmt(row, row.remaining)}</td>
          <td>${fmt(row, row.dailyRequired)}</td>
          <td>${row.percent}%</td>
          <td><span class="pill ${statusPillClass(row.status)}">${row.status}</span></td>
        </tr>`;
    }
    return `
        <tr>
          <td>${escapeHtml(row.label)}</td>
          <td>${fmt(row, row.achieved)}</td>
          <td>-</td><td>-</td><td>-</td><td>-</td>
          <td><span class="pill">بدون هدف</span></td>
        </tr>`;
  }).join('');

  const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <style>${EMAIL_STYLE}</style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1>تقرير أداء أمس</h1>
      <div class="muted">
        المندوب: <strong>${escapeHtml(rep.name)}</strong><br/>
        المنطقة: ${escapeHtml(rep.regions?.name || '-')} · المشرف: ${escapeHtml(rep.supervisors?.name || 'بدون مشرف')}<br/>
        التاريخ: ${escapeHtml(reportDate)} · الشهر: ${MONTHS_AR[monthNum - 1]} ${year}
      </div>
    </div>

    <div class="card">
      <h2>ملخص أمس</h2>
      <div class="grid">
        <div class="stat"><span>المبيعات</span><strong>${formatCurrency(yesterday.sales)}</strong></div>
        <div class="stat"><span>التحصيل</span><strong>${formatCurrency(yesterday.collection)}</strong></div>
        <div class="stat"><span>الزيارات</span><strong>${formatNumber(yesterday.visits)}</strong></div>
        <div class="stat"><span>زيارات ناجحة</span><strong>${formatNumber(yesterday.successfulVisits)}</strong></div>
        <div class="stat"><span>عملاء جدد</span><strong>${formatNumber(yesterday.newCustomers)}</strong></div>
        <div class="stat"><span>أصناف / قطع</span><strong>${formatNumber(yesterday.newProductsSkus)} / ${formatNumber(yesterday.newProductsQty)}</strong></div>
        <div class="stat"><span>كم</span><strong>${formatNumber(yesterday.km)}</strong></div>
        <div class="stat"><span>مصروفات</span><strong>${formatCurrency(yesterday.expenses)}</strong></div>
        <div class="stat"><span>تحصيل متأخرات</span><strong>${formatCurrency(yesterday.overdueCollected)}</strong></div>
      </div>
    </div>

    <div class="card">
      <h2>موقف الشهر حتى أمس — كل المؤشرات</h2>
      <div class="tablewrap">
        <table>
          <thead>
            <tr><th>البند</th><th>المحقق</th><th>الهدف</th><th>المتبقي</th><th>مطلوب يوميًا</th><th>النسبة</th><th>الحالة</th></tr>
          </thead>
          <tbody>${breakdownRows}
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <h2>المتبقي الموزّع على اليومي لباقي الشهر</h2>
      <div class="grid">
        <div class="stat"><span>مبيعات يومية</span><strong>${formatCurrency(requiredSalesDaily)}</strong></div>
        <div class="stat"><span>تحصيل يومي</span><strong>${formatCurrency(requiredCollectionDaily)}</strong></div>
        <div class="stat"><span>زيارات يومية</span><strong>${formatNumber(Math.ceil(requiredVisitsDaily))}</strong></div>
        <div class="stat"><span>أيام العمل المتبقية</span><strong>${formatNumber(remainingDays)}</strong></div>
      </div>
      <p class="muted">هذا التقرير مرسل آليًا بناءً على إدخالات الشهر في نظام متابعة المبيعات.</p>
      <a class="btn" href="${escapeHtml(APP_URL)}">فتح لوحة المندوب</a>
    </div>
  </div>
</body>
</html>`;

  return { to: email, subject, html, text };
}

// Aggregate report for admins (all reps) or a supervisor (their team only).
function buildSummaryEmail({ to, scopeName, metricsList, reportDate, remainingDays }) {
  const [year, monthNum] = reportDate.split('-').map(Number);
  const agg = aggregateMetrics(metricsList);
  const rows = [...metricsList].sort((a, b) => b.month.sales - a.month.sales);
  const subject = `التقرير اليومي المجمّع - ${scopeName} - ${reportDate}`;

  const textLines = [
    `التقرير اليومي المجمّع (${scopeName}) - ${reportDate}`,
    `عدد المناديب: ${agg.count} · أدخلوا أمس: ${agg.reported}`,
    '',
    `إجمالي مبيعات أمس: ${formatCurrency(agg.yesterday.sales)}`,
    `إجمالي تحصيل أمس: ${formatCurrency(agg.yesterday.collection)}`,
    `إجمالي مبيعات الشهر: ${formatCurrency(agg.month.sales)} من ${formatCurrency(agg.targets.sales)} (${agg.salesPercent}%)`,
    `إجمالي تحصيل الشهر: ${formatCurrency(agg.month.collection)} من ${formatCurrency(agg.targets.collection)} (${agg.collectionPercent}%)`,
    '',
    ...rows.map(m => `${m.rep.name} | مبيعات أمس ${formatCurrency(m.yesterday.sales)} | تحصيل أمس ${formatCurrency(m.yesterday.collection)} | مبيعات الشهر ${formatCurrency(m.month.sales)} (${m.salesPercent}%) | تحصيل الشهر ${formatCurrency(m.month.collection)} (${m.collectionPercent}%)`),
    '',
    APP_URL,
  ];

  const tableRows = rows.map(m => `
        <tr>
          <td>${escapeHtml(m.rep.name)}${m.hasEntryYesterday ? '' : ' <span class="pill danger">لا إدخال</span>'}</td>
          <td>${escapeHtml(m.rep.regions?.name || '-')}</td>
          <td>${formatCurrency(m.yesterday.sales)}</td>
          <td>${formatCurrency(m.yesterday.collection)}</td>
          <td>${formatNumber(m.yesterday.visits)}</td>
          <td>${formatNumber(m.yesterday.newCustomers)}</td>
          <td>${formatNumber(m.yesterday.newProductsSkus)}</td>
          <td>${formatCurrency(m.month.sales)}</td>
          <td><span class="pill ${statusPillClass(m.salesStatus)}">${m.salesPercent}%</span></td>
          <td>${formatCurrency(m.month.collection)}</td>
          <td><span class="pill ${statusPillClass(m.collectionStatus)}">${m.collectionPercent}%</span></td>
        </tr>`).join('');

  const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <style>${EMAIL_STYLE}</style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1>التقرير اليومي المجمّع</h1>
      <div class="muted">
        النطاق: <strong>${escapeHtml(scopeName)}</strong><br/>
        التاريخ: ${escapeHtml(reportDate)} · الشهر: ${MONTHS_AR[monthNum - 1]} ${year}<br/>
        عدد المناديب: <strong>${formatNumber(agg.count)}</strong> · أدخلوا أمس: <strong>${formatNumber(agg.reported)}</strong> · أيام العمل المتبقية: <strong>${formatNumber(remainingDays)}</strong>
      </div>
    </div>

    <div class="card">
      <h2>إجمالي أمس</h2>
      <div class="grid">
        <div class="stat"><span>المبيعات</span><strong>${formatCurrency(agg.yesterday.sales)}</strong></div>
        <div class="stat"><span>التحصيل</span><strong>${formatCurrency(agg.yesterday.collection)}</strong></div>
        <div class="stat"><span>الزيارات</span><strong>${formatNumber(agg.yesterday.visits)}</strong></div>
        <div class="stat"><span>زيارات ناجحة</span><strong>${formatNumber(agg.yesterday.successfulVisits)}</strong></div>
        <div class="stat"><span>عملاء جدد</span><strong>${formatNumber(agg.yesterday.newCustomers)}</strong></div>
        <div class="stat"><span>أصناف / قطع</span><strong>${formatNumber(agg.yesterday.newProductsSkus)} / ${formatNumber(agg.yesterday.newProductsQty)}</strong></div>
        <div class="stat"><span>كم</span><strong>${formatNumber(agg.yesterday.km)}</strong></div>
        <div class="stat"><span>مصروفات</span><strong>${formatCurrency(agg.yesterday.expenses)}</strong></div>
        <div class="stat"><span>تحصيل متأخرات</span><strong>${formatCurrency(agg.yesterday.overdueCollected)}</strong></div>
      </div>
    </div>

    <div class="card">
      <h2>موقف الشهر حتى أمس (إجمالي)</h2>
      <table>
        <tr><th>البند</th><th>المحقق</th><th>الهدف</th><th>النسبة</th></tr>
        <tr><td>المبيعات</td><td>${formatCurrency(agg.month.sales)}</td><td>${formatCurrency(agg.targets.sales)}</td><td>${agg.salesPercent}%</td></tr>
        <tr><td>التحصيل</td><td>${formatCurrency(agg.month.collection)}</td><td>${formatCurrency(agg.targets.collection)}</td><td>${agg.collectionPercent}%</td></tr>
      </table>
    </div>

    <div class="card">
      <h2>تفصيل المناديب</h2>
      <div class="tablewrap">
        <table>
          <thead>
            <tr>
              <th>المندوب</th><th>المنطقة</th>
              <th>مبيعات أمس</th><th>تحصيل أمس</th><th>زيارات أمس</th><th>عملاء جدد</th><th>أصناف</th>
              <th>مبيعات الشهر</th><th>%</th><th>تحصيل الشهر</th><th>%</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows}
            <tr class="total">
              <td>الإجمالي</td><td>-</td>
              <td>${formatCurrency(agg.yesterday.sales)}</td>
              <td>${formatCurrency(agg.yesterday.collection)}</td>
              <td>${formatNumber(agg.yesterday.visits)}</td>
              <td>${formatNumber(agg.yesterday.newCustomers)}</td>
              <td>${formatNumber(agg.yesterday.newProductsSkus)}</td>
              <td>${formatCurrency(agg.month.sales)}</td>
              <td>${agg.salesPercent}%</td>
              <td>${formatCurrency(agg.month.collection)}</td>
              <td>${agg.collectionPercent}%</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="muted">تقرير آلي مجمّع من إدخالات المناديب في نظام متابعة المبيعات.</p>
      <a class="btn" href="${escapeHtml(APP_URL)}">فتح لوحة المتابعة</a>
    </div>
  </div>
</body>
</html>`;

  return { to, subject, html, text: textLines.join('\n') };
}

async function sendEmail(email) {
  if (DRY_RUN) {
    console.log(`[DRY_RUN] ${email.to} | ${email.subject}`);
    return;
  }
  const response = await fetch(EMAIL_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${EMAIL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `${FROM_NAME} <${FROM_EMAIL}>`,
      to: [email.to],
      subject: email.subject,
      html: email.html,
      text: email.text,
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Email failed for ${email.to}: ${response.status} ${body}`);
  }
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
  const REPORT_DATE = process.env.REPORT_DATE || getYesterdayInRiyadh();
  const [year, month] = REPORT_DATE.split('-').map(Number);
  const monthProgress = getMonthProgressUntil(year, month, REPORT_DATE);
  const remainingDays = getRemainingWorkingDaysAfter(year, month, REPORT_DATE);

  const [
    repsResult,
    rolesResult,
    targetsResult,
    entriesResult,
    users,
  ] = await Promise.all([
    supabase.from('representatives')
      .select('id,name,is_active,supervisor_id,supervisors(id,name),regions(name)')
      .eq('is_active', true)
      .order('name'),
    supabase.from('user_roles')
      .select('user_id,rep_id,supervisor_id,role'),
    supabase.from('monthly_targets').select('*').limit(10000),
    supabase.from('daily_entries')
      .select('*')
      .eq('year', year)
      .eq('month', month)
      .lte('entry_date', REPORT_DATE)
      .limit(50000),
    listAuthUsers(),
  ]);

  if (repsResult.error) throw repsResult.error;
  if (rolesResult.error) throw rolesResult.error;
  if (targetsResult.error) throw targetsResult.error;
  if (entriesResult.error) throw entriesResult.error;

  const roles = rolesResult.data || [];
  const emailByUserId = Object.fromEntries(users.map(user => [user.id, user.email]));
  const emailByRepId = {};
  roles.filter(role => role.role === 'rep').forEach(role => {
    if (role.rep_id && emailByUserId[role.user_id]) emailByRepId[role.rep_id] = emailByUserId[role.user_id];
  });

  // Compute metrics once per rep, reused by rep + summary emails.
  const repMetrics = (repsResult.data || []).map(rep => {
    const monthRows = (entriesResult.data || []).filter(row => row.rep_id === rep.id);
    const yesterdayRows = monthRows.filter(row => row.entry_date === REPORT_DATE);
    const target = targetForMonth(targetsResult.data || [], rep.id, year, month);
    return computeRepMetrics({ rep, yesterdayRows, monthRows, target, remainingDays, monthProgress });
  });

  const outbox = [];

  // 1) Per-rep emails
  for (const metrics of repMetrics) {
    const email = emailByRepId[metrics.rep.id];
    if (!email) {
      console.log(`Skipped rep ${metrics.rep.name}: no linked email`);
      continue;
    }
    outbox.push({ ...buildRepEmail(metrics, email, REPORT_DATE, remainingDays), kind: 'rep' });
  }

  // 2) Full report (all reps) — for admins, data-entry users, AND every active
  //    manager (managers are company-wide report recipients, same as visit reports).
  const { data: managerRows } = await supabase.from('managers').select('email').eq('is_active', true);
  const managerEmails = (managerRows || []).map(m => String(m.email || '')).filter(Boolean);
  const baseFullEmails = ADMIN_REPORT_EMAILS.length
    ? ADMIN_REPORT_EMAILS
    : roles.filter(role => role.role === 'admin' || role.role === 'data_entry')
        .map(role => emailByUserId[role.user_id])
        .filter(Boolean);
  const fullReportEmails = [...new Set(
    [...baseFullEmails, ...managerEmails].map(e => String(e).trim().toLowerCase()).filter(Boolean),
  )];
  if (!repMetrics.length) {
    console.log('No active reps found — skipping full/supervisor summaries');
  } else if (!fullReportEmails.length) {
    console.log('No full-report recipients found (set ADMIN_REPORT_EMAILS or add an admin/data_entry role) — skipping full summary');
  } else {
    for (const to of fullReportEmails) {
      outbox.push({ ...buildSummaryEmail({ to, scopeName: 'كل المناديب', metricsList: repMetrics, reportDate: REPORT_DATE, remainingDays }), kind: 'full' });
    }
  }

  // 3) Per-supervisor summary (their team only)
  const supervisors = roles.filter(role => role.role === 'supervisor' && role.supervisor_id && emailByUserId[role.user_id]);
  for (const role of supervisors) {
    const teamMetrics = repMetrics.filter(m => m.rep.supervisor_id === role.supervisor_id);
    if (!teamMetrics.length) {
      console.log(`Skipped supervisor ${emailByUserId[role.user_id]}: no reps in team`);
      continue;
    }
    const scopeName = `فريق ${teamMetrics[0].rep.supervisors?.name || 'المشرف'}`;
    outbox.push({ ...buildSummaryEmail({ to: emailByUserId[role.user_id], scopeName, metricsList: teamMetrics, reportDate: REPORT_DATE, remainingDays }), kind: 'supervisor' });
  }

  // Test mode: send one sample of each report type to a single address.
  let toSend = outbox;
  if (TEST_RECIPIENT) {
    const seenKinds = new Set();
    toSend = outbox
      .filter(email => {
        if (seenKinds.has(email.kind)) return false;
        seenKinds.add(email.kind);
        return true;
      })
      .map(email => ({ ...email, to: TEST_RECIPIENT, subject: `[تجربة] ${email.subject}` }));
    console.log(`TEST mode: redirecting ${toSend.length} sample email(s) to ${TEST_RECIPIENT} (kinds: ${[...seenKinds].join(', ') || 'none'})`);
  }

  // Send everything; one failure must not block the rest.
  let sent = 0;
  let failed = 0;
  for (const email of toSend) {
    try {
      await sendEmail(email);
      sent += 1;
    } catch (error) {
      failed += 1;
      console.error(`::error title=Email failed::${(error?.message || String(error)).replace(/\r?\n/g, ' ')}`);
    }
  }

  console.log(`Daily reports complete. date=${REPORT_DATE} mode=${TEST_RECIPIENT ? 'test' : 'live'} reps=${repMetrics.length} fullReports=${fullReportEmails.length} supervisors=${supervisors.length} queued=${toSend.length} sent=${sent} failed=${failed}`);
  if (failed > 0) process.exit(1);
}

if (require.main === module) {
  validateEnvAndInit();
  main().catch(error => {
    const message = error?.message || String(error);
    console.error(`::error title=Daily report failed::${message.replace(/\r?\n/g, ' ')}`);
    console.error(error);
    process.exit(1);
  });
}

module.exports = { buildRepEmail, buildSummaryEmail };
