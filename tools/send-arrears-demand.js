// One-off, on-demand "collection demand" notice from management to each sales
// rep — firm, official tone. It ties the rep's collection-target shortfall to
// the overdue amounts available to collect (المستحق تحصيله, 61+ days) and demands
// action. Manual only (workflow_dispatch); TEST_RECIPIENT sends one sample to a
// single address for review before the real send.
const { createClient } = require('@supabase/supabase-js');
const { escapeHtml, formatCurrency } = require('../src/lib/reportMetrics');
const { buildEffectiveTargetsMap } = require('../src/lib/targets');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EMAIL_API_KEY = process.env.RESEND_API_KEY || process.env.EMAIL_API_KEY;
const EMAIL_API_URL = process.env.EMAIL_API_URL || 'https://api.resend.com/emails';
const FROM_EMAIL = process.env.REPORTS_FROM_EMAIL || 'may@hawafel.com';
const FROM_NAME = process.env.MANAGEMENT_FROM_NAME || 'إدارة شركة حوافل';
const APP_URL = process.env.APP_URL || 'https://sales-tracker-ijyb.onrender.com/';
const DRY_RUN = process.env.DRY_RUN === 'true';
const TEST_RECIPIENT = (process.env.TEST_RECIPIENT || '').trim();

let supabase;
function init() {
  if (!SUPABASE_URL) throw new Error('Missing required secret: SUPABASE_URL');
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error('Missing required secret: SUPABASE_SERVICE_ROLE_KEY');
  if (!EMAIL_API_KEY && !DRY_RUN) throw new Error('Missing required secret: RESEND_API_KEY');
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

function formatDateInZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(date).reduce((a, p) => { a[p.type] = p.value; return a; }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}
const todayInRiyadh = () => formatDateInZone(new Date(), 'Asia/Riyadh');

const DEBT_BUCKETS = [
  ['debt_1_45', '٤٥-٦٠ يوم'], ['debt_over_60', '٦١-٩٠ يوم'], ['debt_over_90', '٩١-١٢٠ يوم'],
  ['debt_over_120', '١٢١-١٥٠ يوم'], ['debt_over_150', 'فوق ١٥٠ يوم'],
];
const DUE_KEYS = ['debt_over_60', 'debt_over_90', 'debt_over_120', 'debt_over_150'];
const AGED_KEYS = ['debt_over_90', 'debt_over_120', 'debt_over_150'];
const n = (v) => Number(v) || 0;
const dueOf = (d) => DUE_KEYS.reduce((s, k) => s + n(d[k]), 0);
const agedOf = (d) => AGED_KEYS.reduce((s, k) => s + n(d[k]), 0);
const pct = (p, w) => (w > 0 ? Math.round((p / w) * 100) : 0);
// Comma-separated manager emails; when set, a single company-level "important
// notice" is sent to them instead of the per-rep demands.
const MANAGER_NOTICE_TO = (process.env.MANAGER_NOTICE_TO || '').split(',').map(s => s.trim()).filter(Boolean);

const STYLE = `
  body{margin:0;background:#f1f5f9;font-family:Tahoma,Arial,sans-serif;color:#0f172a}
  .wrap{max-width:680px;margin:auto;padding:22px}
  .head{background:#7f1d1d;color:#fff;border-radius:12px 12px 0 0;padding:18px 22px}
  .head h1{margin:0;font-size:19px}.head .sub{color:#fecaca;font-size:13px;margin-top:6px}
  .body{background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;padding:22px;line-height:1.9;font-size:15px}
  .warn{background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:14px;margin:14px 0;color:#991b1b;font-weight:700}
  .kpis{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:14px 0}
  .k{border:1px solid #e2e8f0;border-radius:10px;padding:12px;text-align:center}
  .k span{display:block;color:#64748b;font-size:12px;margin-bottom:6px}
  .k b{font-size:19px}
  .due{background:#fff7ed;border-color:#fed7aa}.due b{color:#c2410c}
  .gap{background:#fef2f2;border-color:#fecaca}.gap b{color:#b91c1c}
  table{width:100%;border-collapse:collapse;font-size:13px;margin-top:8px}
  th,td{padding:8px;border-bottom:1px solid #eef2f7;text-align:right}
  thead th{background:#f8fafc;color:#334155}
  .tw{overflow-x:auto}
  .foot{color:#334155;font-weight:700;margin-top:16px}
  .sig{color:#7f1d1d;font-weight:800;margin-top:6px}
  .note{text-align:center;color:#94a3b8;font-size:12px;padding:14px}`;

function demandEmail(to, r, date) {
  const target = r.target, collected = r.collected, gap = Math.max(0, target - collected);
  const due = dueOf(r.debt);
  const rows = DEBT_BUCKETS.map(([k, l]) =>
    `<tr><td>${l}</td><td>${formatCurrency(n(r.debt[k]))}</td></tr>`).join('');
  const cover = gap > 0 ? `المبالغ المتأخرة المتاحة لديك تغطّي ${pct(due, gap)}% من العجز على الأقل` : 'تم بلوغ الهدف — حافظ على الالتزام';
  const inner = `
    <p>الأستاذ/ <b>${escapeHtml(r.name)}</b> — منطقة ${escapeHtml(r.region || '-')}</p>
    <p>هذا <b>إشعار رسمي من الإدارة</b>. تُظهر بيانات ${escapeHtml(date)} <b>تقصيرًا في تحقيق هدف التحصيل</b> المكلَّف به، في حين تتوفّر لديك <b>مبالغ متأخرة مستحقة التحصيل</b> لدى العملاء. هذا الوضع غير مقبول ويستوجب معالجة فورية.</p>
    <div class="kpis">
      <div class="k"><span>هدف التحصيل الشهري</span><b>${formatCurrency(target)}</b></div>
      <div class="k"><span>المحصّل حتى الآن</span><b>${formatCurrency(collected)}</b></div>
      <div class="k gap"><span>العجز عن الهدف (التقصير)</span><b>${formatCurrency(gap)}</b></div>
      <div class="k due"><span>المستحق تحصيله (٦١+ يوم)</span><b>${formatCurrency(due)}</b></div>
    </div>
    <div class="warn">⚠️ ${escapeHtml(cover)} — أي أن العجز ناتج عن <u>تقصير في التحصيل</u> وليس عن عدم توفّر مبالغ.</div>
    <div class="tw"><table>
      <thead><tr><th>أعمار الدين</th><th>المبلغ</th></tr></thead>
      <tbody>${rows}
        <tr><td><b>إجمالي الدين</b></td><td><b>${formatCurrency(n(r.debt.debt_total))}</b></td></tr>
      </tbody>
    </table></div>
    <p class="foot">المطلوب منك فورًا:</p>
    <p>١) البدء بتحصيل المبالغ المتأخرة بالأولوية للأقدم (فوق ١٥٠ ← ١٢١-١٥٠ ← …).<br/>
       ٢) رفع خطة تحصيل عاجلة للإدارة توضّح المبالغ والمواعيد.<br/>
       ٣) تغطية العجز عن الهدف من هذه المتأخرات في أسرع وقت.</p>
    <p>الإدارة تتابع الموقف عن كثب، وعدم التجاوب سيستوجب اتخاذ الإجراءات اللازمة.</p>
    <p class="sig">إدارة شركة حوافل</p>`;
  return {
    to,
    subject: `⚠️ إشعار رسمي من الإدارة — تقصير في التحصيل ومتأخرات مستحقة — ${r.name}`,
    html: `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"/><style>${STYLE}</style></head>
<body><div class="wrap">
  <div class="head"><h1>إدارة شركة حوافل — إشعار تحصيل رسمي</h1><div class="sub">${escapeHtml(date)}</div></div>
  <div class="body">${inner}<p style="margin-top:14px"><a href="${escapeHtml(APP_URL)}">الدخول إلى النظام</a></p></div>
  <div class="note">رسالة رسمية من إدارة شركة حوافل</div>
</div></body></html>`,
  };
}

// Company-level "important notice" for management — the whole-company arrears
// and collection-shortfall picture, with a ranked list of the most-overdue reps.
function managementNotice(to, agg, repList, date) {
  const rows = [...repList].sort((a, b) => agedOf(b.debt) - agedOf(a.debt)).map((r, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><b>${escapeHtml(r.name)}</b><div style="color:#94a3b8;font-size:11px">${escapeHtml(r.region || '-')}</div></td>
      <td style="color:#c2410c;font-weight:700">${formatCurrency(dueOf(r.debt))}</td>
      <td>${formatCurrency(agedOf(r.debt))}</td>
      <td style="color:#b91c1c;font-weight:700">${formatCurrency(r.gap)}</td>
    </tr>`).join('');
  const inner = `
    <p>هذا <b>إشعار هام من الإدارة</b> بموقف المتأخرات والتحصيل على مستوى الشركة حتى ${escapeHtml(date)}، للاطّلاع والمتابعة العاجلة.</p>
    <div class="kpis">
      <div class="k due"><span>المستحق تحصيله (٦١+ يوم)</span><b>${formatCurrency(agg.due)}</b></div>
      <div class="k"><span>إجمالي ديون الشركة</span><b>${formatCurrency(agg.debt_total)}</b></div>
      <div class="k gap"><span>العجز عن هدف التحصيل</span><b>${formatCurrency(agg.gap)}</b></div>
      <div class="k"><span>الديون المتقادمة (٩١+)</span><b>${formatCurrency(agg.aged)}</b></div>
    </div>
    <div class="warn">⚠️ لدى الشركة <b>${formatCurrency(agg.due)}</b> مبالغ متأخرة مستحقة التحصيل، بينما يوجد عجز عن هدف التحصيل بقيمة <b>${formatCurrency(agg.gap)}</b> — أي أن العجز يمكن تغطيته بالتحصيل من المتأخرات القائمة.</div>
    <p style="font-weight:700;margin-bottom:4px">أكثر المناديب تأخيرًا (الأولوية في المتابعة):</p>
    <div class="tw"><table>
      <thead><tr><th>#</th><th>المندوب</th><th>المستحق تحصيله (٦١+)</th><th>المتقادمة (٩١+)</th><th>العجز عن الهدف</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <p class="foot">المطلوب من الإدارة:</p>
    <p>١) متابعة المناديب ومحاسبتهم على تحصيل المتأخرات (تم إشعارهم رسميًا بشكل فردي).<br/>
       ٢) اعتماد خطة تحصيل للمبالغ المتقادمة بالأولوية للأقدم.<br/>
       ٣) متابعة تغطية العجز عن هدف التحصيل من المتأخرات القائمة.</p>
    <p class="sig">إدارة شركة حوافل</p>`;
  return {
    to,
    subject: `🔴 إشعار هام — موقف المتأخرات والتحصيل بالشركة — ${date}`,
    html: `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"/><style>${STYLE}</style></head>
<body><div class="wrap">
  <div class="head"><h1>إدارة شركة حوافل — إشعار هام بالمتأخرات</h1><div class="sub">${escapeHtml(date)}</div></div>
  <div class="body">${inner}<p style="margin-top:14px"><a href="${escapeHtml(APP_URL)}">فتح تحليل المتأخرات</a></p></div>
  <div class="note">رسالة رسمية من إدارة شركة حوافل</div>
</div></body></html>`,
  };
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
  const DATE = process.env.REPORT_DATE || todayInRiyadh();
  const [y, m] = DATE.split('-').map(Number);
  const [repsRes, rolesRes, targetsRes, collRes, debtRes, users] = await Promise.all([
    supabase.from('representatives').select('id,name,is_active,regions(name)').eq('is_active', true),
    supabase.from('user_roles').select('user_id,rep_id,role').eq('role', 'rep'),
    supabase.from('monthly_targets').select('*').limit(10000),
    supabase.from('daily_entries').select('rep_id, daily_collection').eq('year', y).eq('month', m).lte('entry_date', DATE).limit(50000),
    supabase.from('daily_entries')
      .select('rep_id, debt_total, debt_1_45, debt_over_60, debt_over_90, debt_over_120, debt_over_150')
      .lte('entry_date', DATE).not('field_owners->>debt_total', 'is', null)
      .order('entry_date', { ascending: false }).limit(20000),
    listAuthUsers(),
  ]);
  const reps = repsRes.data || [];
  const emailByUserId = Object.fromEntries(users.map(u => [u.id, u.email]));
  const emailByRepId = {};
  (rolesRes.data || []).forEach(r => { if (r.rep_id && emailByUserId[r.user_id]) emailByRepId[r.rep_id] = emailByUserId[r.user_id]; });
  const tMap = buildEffectiveTargetsMap(targetsRes.data || [], y, m);
  const collByRep = {};
  for (const c of (collRes.data || [])) collByRep[c.rep_id] = (collByRep[c.rep_id] || 0) + n(c.daily_collection);
  const debtByRep = {};
  for (const d of (debtRes.data || [])) if (!debtByRep[d.rep_id]) debtByRep[d.rep_id] = d;

  // Build the per-rep picture once (used by both modes).
  const candidates = [];
  for (const rep of reps) {
    const debt = debtByRep[rep.id] || {};
    const target = n(tMap[rep.id]?.target_collection);
    const collected = collByRep[rep.id] || 0;
    const gap = Math.max(0, target - collected);
    if (dueOf(debt) <= 0 && target <= 0) continue; // nothing to say
    candidates.push({ id: rep.id, name: rep.name, region: rep.regions?.name || '', email: emailByRepId[rep.id], target, collected, gap, debt });
  }

  const outbox = [];
  if (MANAGER_NOTICE_TO.length) {
    // Company-level important notice to management.
    const agg = candidates.reduce((a, c) => {
      a.debt_total += n(c.debt.debt_total); a.due += dueOf(c.debt); a.aged += agedOf(c.debt);
      a.target += c.target; a.collected += c.collected; return a;
    }, { debt_total: 0, due: 0, aged: 0, target: 0, collected: 0 });
    agg.gap = Math.max(0, agg.target - agg.collected);
    const recipients = TEST_RECIPIENT ? [TEST_RECIPIENT] : MANAGER_NOTICE_TO;
    for (const to of recipients) {
      const e = managementNotice(to, agg, candidates, DATE);
      outbox.push(TEST_RECIPIENT ? { ...e, subject: `[تجربة] ${e.subject}` } : e);
    }
    console.log(`Manager-notice mode: ${recipients.length} recipient(s)${TEST_RECIPIENT ? ' (TEST)' : ''}`);
  } else {
    // Per-rep firm demand (default).
    for (const c of candidates) {
      if (!c.email) continue;
      outbox.push(demandEmail(c.email, { name: c.name, region: c.region, target: c.target, collected: c.collected, debt: c.debt }, DATE));
    }
    if (TEST_RECIPIENT) {
      const one = outbox.slice(0, 1).map(e => ({ ...e, to: TEST_RECIPIENT, subject: `[تجربة] ${e.subject}` }));
      console.log(`TEST mode: ${one.length} sample -> ${TEST_RECIPIENT}`);
      outbox.length = 0; outbox.push(...one);
    }
  }
  const toSend = outbox;

  let sent = 0, failed = 0;
  for (const email of toSend) {
    try { await sendEmail(email); sent += 1; }
    catch (e) { failed += 1; console.error(`::error title=Demand email failed::${(e?.message || String(e)).replace(/\r?\n/g, ' ')}`); }
  }
  console.log(`Arrears notice complete. date=${DATE} mode=${MANAGER_NOTICE_TO.length ? 'managers' : 'reps'} candidates=${candidates.length} queued=${toSend.length} sent=${sent} failed=${failed}`);
  if (failed > 0) process.exit(1);
}

if (require.main === module) {
  init();
  main().catch(e => { console.error(`::error title=Arrears demand failed::${(e?.message || String(e)).replace(/\r?\n/g, ' ')}`); console.error(e); process.exit(1); });
}

module.exports = { demandEmail, managementNotice };
