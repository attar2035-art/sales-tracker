// Daily supervisor visit digest.
//
// Every morning this emails the authorized report recipients a summary of the
// PREVIOUS day's field visits for a chosen set of supervisors (by default the
// supervisors Rami and Yehia). Recipients are the active report_recipients from
// the Permissions Center (company-wide ones, plus region-scoped ones matching a
// visited region) together with every active manager — exactly the same set the
// on-demand visit report (send-visit-report edge function) sends to.
//
// It is meant to run from GitHub Actions on a daily schedule; timezone follows
// the rest of the reporting system (Asia/Riyadh), so cron '0 5 * * *' fires at
// 08:00 Riyadh time.
const { createClient } = require('@supabase/supabase-js');
const { escapeHtml } = require('../src/lib/reportMetrics');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EMAIL_API_KEY = process.env.RESEND_API_KEY || process.env.EMAIL_API_KEY;
const EMAIL_API_URL = process.env.EMAIL_API_URL || 'https://api.resend.com/emails';
const FROM_EMAIL = process.env.REPORTS_FROM_EMAIL || process.env.FROM_EMAIL || 'may@hawafel.com';
const FROM_NAME = process.env.REPORTS_FROM_NAME || process.env.FROM_NAME || 'نظام متابعة المبيعات';
const APP_URL = process.env.APP_URL || 'https://sales-tracker-ijyb.onrender.com/';
const DRY_RUN = process.env.DRY_RUN === 'true';

// Which supervisors to include. Comma-separated name fragments (case-insensitive
// "contains" match on the supervisor name). Defaults to Rami and Yehia.
const SUPERVISOR_NAMES = (process.env.DIGEST_SUPERVISOR_NAMES || 'رامي,يحي')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);

// Optional test mode: send the digest only to this address.
const TEST_RECIPIENT = (process.env.TEST_RECIPIENT || '').trim();

let supabase;

function validateEnvAndInit() {
  if (!SUPABASE_URL) throw new Error('Missing required secret: SUPABASE_URL');
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error('Missing required secret: SUPABASE_SERVICE_ROLE_KEY');
  if (!EMAIL_API_KEY && !DRY_RUN) throw new Error('Missing required secret: RESEND_API_KEY');
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function formatDateInZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date).reduce((acc, part) => { acc[part.type] = part.value; return acc; }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function getYesterdayInRiyadh() {
  return formatDateInZone(new Date(Date.now() - 24 * 60 * 60 * 1000), 'Asia/Riyadh');
}

function fmtTime(t) {
  if (!t) return '—';
  try {
    return new Date(t).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
  } catch { return '—'; }
}

const STATUS_AR = { planned: 'مخططة', completed: 'مكتملة', cancelled: 'ملغاة' };

const EMAIL_STYLE = `
    body{margin:0;background:#f1f5f9;font-family:Tahoma,Arial,sans-serif;color:#0f172a}
    .wrap{max-width:760px;margin:auto;padding:22px}
    .head{background:#0f172a;color:#fff;border-radius:12px 12px 0 0;padding:18px 20px;font-size:18px;font-weight:bold}
    .body{background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;padding:20px}
    .sup{margin:0 0 22px}
    h2{margin:0 0 10px;font-size:16px;color:#1d4ed8}
    .stats{display:flex;gap:10px;margin:0 0 12px}
    .stat{flex:1;border-radius:8px;padding:10px;text-align:center}
    .stat span{display:block;color:#64748b;font-size:12px;margin-bottom:4px}
    .stat strong{font-size:20px}
    table{width:100%;border-collapse:collapse;font-size:13px}
    th,td{padding:8px;border-bottom:1px solid #eef2f7;text-align:right}
    thead th{background:#f8fafc;color:#334155}
    .tablewrap{overflow-x:auto}
    .muted{color:#64748b;font-size:13px}
    a.btn{display:inline-block;background:#2563eb;color:#fff;text-decoration:none;border-radius:10px;padding:11px 18px;font-weight:700;margin-top:8px}
    .foot{text-align:center;color:#94a3b8;font-size:12px;padding:14px}`;

// Build one supervisor's section (KPIs + visits table) from his visit rows.
function buildSupervisorSection(supName, visits, photoLinksByVisit) {
  const total = visits.length;
  const completed = visits.filter(v => v.visit_status === 'completed').length;
  const rows = visits.map(v => {
    const name = v.customer_name || v.customer_display || '—';
    const sub = [v.city, v.neighborhood].filter(Boolean).join(' — ');
    const rep = v.rep_name ? `<div class="muted" style="font-size:11px">مندوب: ${escapeHtml(v.rep_name)}</div>` : '';
    const rating = v.customer_rating ? `<div class="muted" style="font-size:11px">فئة العميل: ${escapeHtml(v.customer_rating)}</div>` : '';
    const links = photoLinksByVisit[v.id] || [];
    const photosCell = links.length
      ? links.map((u, i) => `<a href="${u}">📷 ${i + 1}</a>`).join(' &nbsp; ')
      : String(Array.isArray(v.photos) ? v.photos.length : 0);
    return `<tr>
        <td><b>${escapeHtml(name)}</b>${sub ? `<div class="muted" style="font-size:11px">${escapeHtml(sub)}</div>` : ''}${rep}${rating}</td>
        <td>${fmtTime(v.check_in_time)}</td>
        <td>${escapeHtml(STATUS_AR[v.visit_status] || v.visit_status || '—')}</td>
        <td>${photosCell}</td>
      </tr>`;
  }).join('');

  return `<div class="sup">
      <h2>المشرف: ${escapeHtml(supName)}</h2>
      <div class="stats">
        <div class="stat" style="background:#eff6ff"><span>إجمالي الزيارات</span><strong>${total}</strong></div>
        <div class="stat" style="background:#ecfdf5"><span>مكتملة</span><strong>${completed}</strong></div>
      </div>
      ${total ? `<div class="tablewrap"><table>
        <thead><tr><th>العميل</th><th>الوقت</th><th>الحالة</th><th>صور</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`
        : '<p class="muted">لا توجد زيارات مسجّلة أمس.</p>'}
    </div>`;
}

function buildDigestEmail(to, reportDate, sections) {
  const subject = `تقرير زيارات المشرفين — ${reportDate}`;
  const html = `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8" /><style>${EMAIL_STYLE}</style></head>
<body><div class="wrap">
  <div class="head">🏭 تقرير زيارات المشرفين — ${escapeHtml(reportDate)}</div>
  <div class="body">
    <p class="muted">ملخّص زيارات أمس للمشرفين المتابَعين.</p>
    ${sections.join('')}
    <a class="btn" href="${escapeHtml(APP_URL)}">فتح النظام</a>
  </div>
  <div class="foot">رسالة تلقائية من نظام متابعة المبيعات</div>
</div></body></html>`;
  return { to, subject, html };
}

async function sendEmail(email) {
  if (DRY_RUN) {
    console.log(`[DRY_RUN] ${email.to} | ${email.subject}`);
    return;
  }
  const response = await fetch(EMAIL_API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${EMAIL_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: `${FROM_NAME} <${FROM_EMAIL}>`, to: [email.to], subject: email.subject, html: email.html }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Email failed for ${email.to}: ${response.status} ${body}`);
  }
}

async function signPhoto(path) {
  if (!path) return null;
  const { data } = await supabase.storage.from('visit-photos').createSignedUrl(path, 60 * 60 * 24 * 7);
  return data?.signedUrl || null;
}

async function main() {
  const REPORT_DATE = process.env.REPORT_DATE || getYesterdayInRiyadh();

  // Resolve the target supervisors by name fragment.
  const { data: allSupervisors, error: supErr } = await supabase.from('supervisors').select('id, name');
  if (supErr) throw supErr;
  const targets = (allSupervisors || []).filter(s =>
    SUPERVISOR_NAMES.some(frag => String(s.name || '').toLowerCase().includes(frag.toLowerCase())));
  if (!targets.length) {
    console.log(`No supervisors matched names [${SUPERVISOR_NAMES.join(', ')}] — nothing to send.`);
    return;
  }
  const targetIds = targets.map(s => s.id);

  // Yesterday's routes for those supervisors, then their visits.
  const { data: routes, error: routeErr } = await supabase.from('supervisor_routes')
    .select('id, supervisor_id, route_date').eq('route_date', REPORT_DATE).in('supervisor_id', targetIds);
  if (routeErr) throw routeErr;
  const routeIds = (routes || []).map(r => r.id);
  const supByRoute = Object.fromEntries((routes || []).map(r => [r.id, r.supervisor_id]));

  let visits = [];
  if (routeIds.length) {
    const { data, error } = await supabase.from('supervisor_visits')
      .select('*').in('route_id', routeIds).order('created_at', { ascending: true });
    if (error) throw error;
    visits = data || [];
  }

  // Fill in customer names / regions for visits linked to a customer record.
  const custIds = [...new Set(visits.map(v => v.customer_id).filter(Boolean))];
  const custById = {};
  if (custIds.length) {
    const { data: custs } = await supabase.from('customers')
      .select('id, customer_name, region_id').in('id', custIds);
    (custs || []).forEach(c => { custById[c.id] = c; });
  }
  visits.forEach(v => {
    const c = custById[v.customer_id];
    v.customer_display = v.customer_name || c?.customer_name || null;
    v.region_id = c?.region_id || null;
    v.supervisor_id = supByRoute[v.route_id];
  });

  // Sign photos (7-day links) so recipients can open them from the email.
  const photoLinksByVisit = {};
  for (const v of visits) {
    const paths = Array.isArray(v.photos) ? v.photos : [];
    const urls = (await Promise.all(paths.map(p => signPhoto(p)))).filter(Boolean);
    if (urls.length) photoLinksByVisit[v.id] = urls;
  }

  // Recipients: active report_recipients (company-wide + those scoped to a
  // visited region) plus every active manager.
  const visitedRegions = new Set(visits.map(v => v.region_id).filter(Boolean));
  const { data: recs } = await supabase.from('report_recipients')
    .select('email, region_id, is_active').eq('is_active', true);
  const fromCenter = (recs || [])
    .filter(r => !r.region_id || visitedRegions.has(r.region_id))
    .map(r => String(r.email || '').trim().toLowerCase());
  const { data: mgrs } = await supabase.from('managers').select('email').eq('is_active', true);
  const fromManagers = (mgrs || []).map(m => String(m.email || '').trim().toLowerCase());
  let recipients = [...new Set([...fromCenter, ...fromManagers].filter(Boolean))];

  if (TEST_RECIPIENT) recipients = [TEST_RECIPIENT];
  if (!recipients.length) {
    console.log('No active report recipients found — nothing to send.');
    return;
  }

  // One section per target supervisor (kept in the requested order).
  const sections = targets.map(sup =>
    buildSupervisorSection(sup.name, visits.filter(v => v.supervisor_id === sup.id), photoLinksByVisit));

  let sent = 0, failed = 0;
  for (const to of recipients) {
    try {
      await sendEmail(buildDigestEmail(to, REPORT_DATE, sections));
      sent += 1;
    } catch (error) {
      failed += 1;
      console.error(`::error title=Digest email failed::${(error?.message || String(error)).replace(/\r?\n/g, ' ')}`);
    }
  }

  console.log(`Supervisor visit digest complete. date=${REPORT_DATE} supervisors=${targets.map(s => s.name).join('/')} visits=${visits.length} recipients=${recipients.length} sent=${sent} failed=${failed}`);
  if (failed > 0) process.exit(1);
}

if (require.main === module) {
  validateEnvAndInit();
  main().catch(error => {
    const message = error?.message || String(error);
    console.error(`::error title=Supervisor digest failed::${message.replace(/\r?\n/g, ' ')}`);
    console.error(error);
    process.exit(1);
  });
}

module.exports = { buildSupervisorSection, buildDigestEmail };
