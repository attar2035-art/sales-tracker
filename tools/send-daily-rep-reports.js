const { createClient } = require('@supabase/supabase-js');

const MONTHS_AR = [
  'يناير', 'فبراير', 'مارس', 'إبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EMAIL_API_KEY = process.env.RESEND_API_KEY || process.env.EMAIL_API_KEY;
const EMAIL_API_URL = process.env.EMAIL_API_URL || 'https://api.resend.com/emails';
const FROM_EMAIL = process.env.REPORTS_FROM_EMAIL || process.env.FROM_EMAIL || 'may@hawafel.com';
const FROM_NAME = process.env.REPORTS_FROM_NAME || process.env.FROM_NAME || 'نظام متابعة المبيعات';
const APP_URL = process.env.APP_URL || 'https://sales-tracker-ijyb.onrender.com/';
const DRY_RUN = process.env.DRY_RUN === 'true';
const REPORT_DATE = process.env.REPORT_DATE || getYesterdayInRiyadh();

if (!SUPABASE_URL) throw new Error('Missing required secret: SUPABASE_URL');
if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error('Missing required secret: SUPABASE_SERVICE_ROLE_KEY');
if (!EMAIL_API_KEY && !DRY_RUN) throw new Error('Missing required secret: RESEND_API_KEY');

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

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

function isWorkingDay(date) {
  return new Date(date).getDay() !== 5;
}

function getWorkingDaysInMonth(year, month) {
  const days = [];
  const date = new Date(year, month - 1, 1);
  while (date.getMonth() === month - 1) {
    if (isWorkingDay(date)) days.push(new Date(date));
    date.setDate(date.getDate() + 1);
  }
  return days;
}

function getMonthProgressUntil(year, month, dateString) {
  const total = getWorkingDaysInMonth(year, month);
  const reportDate = new Date(`${dateString}T23:59:59`);
  const passed = total.filter(day => day <= reportDate).length;
  return total.length > 0 ? (passed / total.length) * 100 : 0;
}

function getRemainingWorkingDaysAfter(year, month, dateString) {
  const reportDate = new Date(`${dateString}T23:59:59`);
  return getWorkingDaysInMonth(year, month).filter(day => day > reportDate).length;
}

function formatNumber(value) {
  return new Intl.NumberFormat('ar-SA').format(Math.round(Number(value) || 0));
}

function formatCurrency(value) {
  return new Intl.NumberFormat('ar-SA').format(Math.round(Number(value) || 0));
}

function sumBy(rows, field) {
  return rows.reduce((sum, row) => sum + (parseFloat(row[field]) || 0), 0);
}

function targetForMonth(targets, repId, year, month) {
  return [...(targets || [])]
    .filter(target => target.rep_id === repId)
    .filter(target => target.year < year || (target.year === year && target.month <= month))
    .sort((a, b) => (b.year - a.year) || (b.month - a.month))[0] || {};
}

function percent(achieved, target) {
  return target > 0 ? Math.round((achieved / target) * 100) : 0;
}

function statusLabel(achieved, target, monthProgress) {
  if (!target) return 'بدون هدف';
  const rate = (achieved / target) * 100;
  if (rate >= monthProgress + 5) return 'متقدم';
  if (rate >= monthProgress - 5) return 'في المسار';
  return 'متأخر';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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

function buildEmail({ rep, email, yesterdayRows, monthRows, target, reportDate, remainingDays, monthProgress }) {
  const [year, month] = reportDate.split('-').map(Number);
  const yesterday = {
    sales: sumBy(yesterdayRows, 'daily_sales'),
    collection: sumBy(yesterdayRows, 'daily_collection'),
    visits: sumBy(yesterdayRows, 'total_visits'),
    successfulVisits: sumBy(yesterdayRows, 'successful_visits'),
    newCustomers: sumBy(yesterdayRows, 'new_customers'),
    newProductsSkus: sumBy(yesterdayRows, 'new_products_skus'),
    newProductsQty: sumBy(yesterdayRows, 'new_products_qty'),
    km: sumBy(yesterdayRows, 'km'),
    expenses: sumBy(yesterdayRows, 'daily_expenses'),
    overdueCollected: sumBy(yesterdayRows, 'overdue_collected'),
  };
  const monthTotal = {
    sales: sumBy(monthRows, 'daily_sales'),
    collection: sumBy(monthRows, 'daily_collection'),
    visits: sumBy(monthRows, 'total_visits'),
    successfulVisits: sumBy(monthRows, 'successful_visits'),
    newCustomers: sumBy(monthRows, 'new_customers'),
  };
  const salesTarget = Number(target.target_sales) || 0;
  const collectionTarget = Number(target.target_collection) || 0;
  const visitsTarget = Number(target.target_total_visits) || 0;
  const salesRemaining = Math.max(0, salesTarget - monthTotal.sales);
  const collectionRemaining = Math.max(0, collectionTarget - monthTotal.collection);
  const requiredSalesDaily = remainingDays > 0 ? salesRemaining / remainingDays : salesRemaining;
  const requiredCollectionDaily = remainingDays > 0 ? collectionRemaining / remainingDays : collectionRemaining;
  const salesStatus = statusLabel(monthTotal.sales, salesTarget, monthProgress);
  const collectionStatus = statusLabel(monthTotal.collection, collectionTarget, monthProgress);
  const subject = `تقرير أداء أمس - ${rep.name} - ${reportDate}`;
  const text = [
    `تقرير أداء أمس للمندوب: ${rep.name}`,
    `التاريخ: ${reportDate}`,
    `المنطقة: ${rep.regions?.name || '-'}`,
    '',
    `مبيعات أمس: ${formatCurrency(yesterday.sales)}`,
    `تحصيل أمس: ${formatCurrency(yesterday.collection)}`,
    `الزيارات: ${formatNumber(yesterday.visits)}`,
    `الزيارات الناجحة: ${formatNumber(yesterday.successfulVisits)}`,
    `العملاء الجدد: ${formatNumber(yesterday.newCustomers)}`,
    '',
    `مبيعات الشهر: ${formatCurrency(monthTotal.sales)} من ${formatCurrency(salesTarget)} (${percent(monthTotal.sales, salesTarget)}%) - ${salesStatus}`,
    `تحصيل الشهر: ${formatCurrency(monthTotal.collection)} من ${formatCurrency(collectionTarget)} (${percent(monthTotal.collection, collectionTarget)}%) - ${collectionStatus}`,
    `المطلوب يوميًا للمبيعات: ${formatCurrency(requiredSalesDaily)}`,
    `المطلوب يوميًا للتحصيل: ${formatCurrency(requiredCollectionDaily)}`,
    APP_URL,
  ].join('\n');

  const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <style>
    body{margin:0;background:#f1f5f9;font-family:Tahoma,Arial,sans-serif;color:#0f172a}
    .wrap{max-width:760px;margin:auto;padding:24px}
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
    table{width:100%;border-collapse:collapse}
    td,th{padding:10px;border-bottom:1px solid #e2e8f0;text-align:right}
    a.btn{display:inline-block;background:#2563eb;color:#fff;text-decoration:none;border-radius:10px;padding:12px 18px;font-weight:700}
    @media(max-width:640px){.grid{grid-template-columns:1fr}}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1>تقرير أداء أمس</h1>
      <div class="muted">
        المندوب: <strong>${escapeHtml(rep.name)}</strong><br/>
        المنطقة: ${escapeHtml(rep.regions?.name || '-')} · المشرف: ${escapeHtml(rep.supervisors?.name || 'بدون مشرف')}<br/>
        التاريخ: ${escapeHtml(reportDate)} · الشهر: ${MONTHS_AR[month - 1]} ${year}
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
      <h2>موقف الشهر حتى أمس</h2>
      <table>
        <tr><th>البند</th><th>المحقق</th><th>الهدف</th><th>النسبة</th><th>الحالة</th></tr>
        <tr><td>المبيعات</td><td>${formatCurrency(monthTotal.sales)}</td><td>${formatCurrency(salesTarget)}</td><td>${percent(monthTotal.sales, salesTarget)}%</td><td><span class="pill ${salesStatus === 'متأخر' ? 'danger' : salesStatus === 'متقدم' ? 'ok' : 'warn'}">${salesStatus}</span></td></tr>
        <tr><td>التحصيل</td><td>${formatCurrency(monthTotal.collection)}</td><td>${formatCurrency(collectionTarget)}</td><td>${percent(monthTotal.collection, collectionTarget)}%</td><td><span class="pill ${collectionStatus === 'متأخر' ? 'danger' : collectionStatus === 'متقدم' ? 'ok' : 'warn'}">${collectionStatus}</span></td></tr>
        <tr><td>الزيارات</td><td>${formatNumber(monthTotal.visits)}</td><td>${formatNumber(visitsTarget)}</td><td>${percent(monthTotal.visits, visitsTarget)}%</td><td>-</td></tr>
      </table>
    </div>

    <div class="card">
      <h2>المطلوب يوميًا لباقي الشهر</h2>
      <div class="grid">
        <div class="stat"><span>مبيعات يومية</span><strong>${formatCurrency(requiredSalesDaily)}</strong></div>
        <div class="stat"><span>تحصيل يومي</span><strong>${formatCurrency(requiredCollectionDaily)}</strong></div>
        <div class="stat"><span>أيام العمل المتبقية</span><strong>${formatNumber(remainingDays)}</strong></div>
      </div>
      <p class="muted">هذا التقرير مرسل آليًا بناءً على إدخال أمس في نظام متابعة المبيعات.</p>
      <a class="btn" href="${escapeHtml(APP_URL)}">فتح لوحة المندوب</a>
    </div>
  </div>
</body>
</html>`;

  return { to: email, subject, html, text };
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

async function main() {
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
      .select('id,name,is_active,supervisors(name),regions(name)')
      .eq('is_active', true)
      .order('name'),
    supabase.from('user_roles')
      .select('user_id,rep_id,role')
      .eq('role', 'rep'),
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

  const emailByUserId = Object.fromEntries(users.map(user => [user.id, user.email]));
  const emailByRepId = {};
  (rolesResult.data || []).forEach(role => {
    if (role.rep_id && emailByUserId[role.user_id]) emailByRepId[role.rep_id] = emailByUserId[role.user_id];
  });

  let sent = 0;
  let skipped = 0;
  for (const rep of repsResult.data || []) {
    const email = emailByRepId[rep.id];
    if (!email) {
      skipped += 1;
      console.log(`Skipped ${rep.name}: no linked email`);
      continue;
    }
    const monthRows = (entriesResult.data || []).filter(row => row.rep_id === rep.id);
    const yesterdayRows = monthRows.filter(row => row.entry_date === REPORT_DATE);
    const target = targetForMonth(targetsResult.data || [], rep.id, year, month);
    const report = buildEmail({ rep, email, yesterdayRows, monthRows, target, reportDate: REPORT_DATE, remainingDays, monthProgress });
    await sendEmail(report);
    sent += 1;
  }

  console.log(`Daily reports complete. date=${REPORT_DATE} sent=${sent} skipped=${skipped}`);
}

main().catch(error => {
  const message = error?.message || String(error);
  console.error(`::error title=Daily report failed::${message.replace(/\r?\n/g, ' ')}`);
  console.error(error);
  process.exit(1);
});
