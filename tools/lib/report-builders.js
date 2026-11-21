// Registry of backend equivalents for the Claude-session report triggers.
// Each builder preserves the trigger's recipients, scope, conditions and
// content. Shape: { reportType, version, precondition?(ctx), fetch(ctx),
// buildUnits(data, period) } where buildUnits is PURE (testable with mock data).

const cfg = require('./report-config');
const H = require('./hawafel-email');
const D = require('./report-data');
const { getRemainingWorkingDaysAfter } = require('../../src/lib/reportMetrics');

const stripBidi = (s) => String(s || '').replace(/[‎‏‪‫‬⁦⁧⁨⁩]/g, '').trim();
const monthProgressPct = (period) => {
  const [y, m] = period.split('-').map(Number);
  const day = Number(period.split('-')[2]);
  const dim = new Date(y, m, 0).getDate();
  return Math.round((day * 100) / dim);
};

// Build per-region stats keyed by region name from the shared debt/collection data.
function buildRegionStats({ regionsMeta, debtByRegion, collByRep, targetsByRep }) {
  const stats = new Map();
  for (const [name, agg] of debtByRegion.entries()) {
    const region = regionsMeta.regionByName.get(name);
    const rep = region ? regionsMeta.repByRegion.get(region.id) : null;
    const coll = rep ? (collByRep.get(rep.id)?.coll || 0) : 0;
    const t = rep ? targetsByRep.get(rep.id) : null;
    stats.set(name, { rep, agg, coll, targetColl: t?.target_collection || 0, targetSales: t?.target_sales || 0, salesMtd: rep ? (collByRep.get(rep.id)?.sales || 0) : 0 });
  }
  return stats;
}

async function fetchDebtCore(ctx) {
  const [regionsMeta, customers, collByRep, targetsByRep] = await Promise.all([
    D.regionsMeta(ctx.supabase), D.onBookCustomers(ctx.supabase),
    D.collectionMTD(ctx.supabase, ctx.period), D.latestTargets(ctx.supabase),
  ]);
  const debtByRegion = D.aggregateDebtByRegion(customers);
  return { regionStats: buildRegionStats({ regionsMeta, debtByRegion, collByRep, targetsByRep }), regionsMeta, collByRep, targetsByRep, period: ctx.period };
}

// ---- 1) Per-manager daily debt (walid / ahmed / ramy) ----------------------
// The three keep their OWN send times (09:05 / 09:10 / 09:15 Riyadh) via three
// scheduled jobs, each running a single-manager variant. The upload precondition
// (مي updated debt AND أميرة entered collection) is enforced per run.
async function managerDebtPrecondition(ctx) {
  const s = await D.uploadStatusToday(ctx.supabase);
  if (s.debt_may === 0 || s.coll_amira === 0) {
    const missing = [s.debt_may === 0 ? 'المديونيات من مي' : null, s.coll_amira === 0 ? 'التحصيل من أميرة' : null].filter(Boolean).join(' و');
    return { ok: false, reason: `لسه ${missing} ماترفعتش النهارده` };
  }
  return { ok: true };
}
function managerDebtUnits(data, period, list) {
  const units = [];
  for (const m of list) {
    let body = '';
    for (const regionName of m.regions) {
      const st = data.regionStats.get(regionName);
      if (!st) continue;
      const repName = st.rep?.name || regionName;
      body += H.cardOpen(`${regionName} — ${repName}`, `إجمالي الدين: <b>${H.f(st.agg.total)}</b> ر · عدد العملاء المدينين: <b>${st.agg.count}</b>`);
      body += H.agingBlock(st.agg);
      body += H.topCustomers(D.topOverdue(st.agg.customers, 5));
      body += H.collectionLine({ coll: st.coll, target: st.targetColl });
      body += H.cardClose();
    }
    units.push({ reportId: `manager:${m.short}`, recipient: m.to, subject: `تقرير المديونيات اليومي — ${m.title}`, html: H.shell('تقرير المديونيات اليومي', `${m.title} · ${period}`, body), text: `تقرير المديونيات اليومي — ${m.title} — ${period}` });
  }
  return units;
}
function makeManagerDebt(onlyShort) {
  return {
    reportType: 'manager_debt_daily', version: 'v1',
    precondition: managerDebtPrecondition,
    fetch: fetchDebtCore,
    buildUnits(data, period) {
      const list = onlyShort ? cfg.MANAGER_DEBT.filter((m) => m.short === onlyShort) : cfg.MANAGER_DEBT;
      return managerDebtUnits(data, period, list);
    },
  };
}

// ---- 2) Credit-control overdue (>60) across all regions --------------------
const creditControl = {
  reportType: 'credit_control_overdue', version: 'v1',
  async precondition(ctx) {
    const s = await D.uploadStatusToday(ctx.supabase);
    if (s.debt_may === 0) return { ok: false, reason: 'المديونيات لسه ماترفعتش النهارده' };
    return { ok: true };
  },
  fetch: fetchDebtCore,
  buildUnits(data, period) {
    const regions = [...data.regionStats.entries()]
      .map(([name, st]) => ({ name, st, regionOver60: st.agg.over60 }))
      .filter((r) => r.regionOver60 > 0)
      .sort((a, b) => b.regionOver60 - a.regionOver60);
    let body = ''; let grandAmt = 0; let grandCust = 0; let grandOver = 0;
    for (const r of regions) {
      const top = D.topOverdue(r.st.agg.customers, 10);
      const overCust = r.st.agg.customers.filter((c) => c.over60 > 0).length;
      const overLimit = r.st.agg.customers.filter((c) => c.credit_limit > 0 && c.debt_total > c.credit_limit).length;
      grandAmt += r.regionOver60; grandCust += overCust; grandOver += overLimit;
      body += H.cardOpen(`${r.name} — ${r.st.rep?.name || '—'}`, `المتأخر فوق 60: <b>${H.f(r.regionOver60)}</b> ر على <b>${overCust}</b> عميل`);
      body += H.topCustomers(top, 'أعلى 10 عملاء في المتأخر فوق 60');
      if (overLimit > 0) body += H.infoBox(`تجاوزوا الحد الائتماني: <b>${overLimit}</b> عميل`, 'red');
      body += H.cardClose();
    }
    body += H.infoBox(`الإجمالي العام للمتأخر فوق 60: <b>${H.f(grandAmt)}</b> ر على <b>${grandCust}</b> عميل · تجاوزوا الحد: <b>${grandOver}</b> عميل`, 'amber');
    return [{ reportId: 'credit-control', recipient: cfg.CREDIT_CONTROL_TO, subject: 'قائمة المتأخرات للتحصيل — كل المناطق (فوق 60 يوم)', html: H.shell('قائمة المتأخرات للتحصيل', `كل المناطق (فوق 60 يوم) · ${period}`, body), text: `قائمة المتأخرات للتحصيل — كل المناطق — ${period}` }];
  },
};

// ---- 3) Sales & collection targets (all regions, to the 5 managers) --------
const targets = {
  reportType: 'targets_daily', version: 'v1',
  fetch: fetchDebtCore,
  buildUnits(data, period) {
    const rows = [];
    let tS = 0; let aS = 0; let tC = 0; let aC = 0;
    for (const [name, st] of data.regionStats.entries()) {
      if (!st.rep) continue;
      rows.push({ region: name, rep: st.rep.name, ts: st.targetSales, as: st.salesMtd, tc: st.targetColl, ac: st.coll });
      tS += st.targetSales; aS += st.salesMtd; tC += st.targetColl; aC += st.coll;
    }
    rows.sort((a, b) => b.ts - a.ts);
    const expected = monthProgressPct(period);
    const cell = (a, b) => { const p = H.pct(a, b); return `<td style="padding:7px 8px;text-align:center">${H.f(a)}</td><td style="padding:7px 8px;text-align:center;color:${H.targetColor(p)};font-weight:700">${b > 0 ? p + '%' : '—'}</td>`; };
    let tbody = rows.map((r) => `<tr style="border-top:1px solid #eef2f7"><td style="padding:7px 10px"><b>${r.rep}</b><div style="color:#64748b;font-size:11px">${r.region}</div></td><td style="padding:7px 8px;text-align:center">${H.f(r.ts)}</td>${cell(r.as, r.ts)}<td style="padding:7px 8px;text-align:center;color:#cbd5e1">·</td><td style="padding:7px 8px;text-align:center">${H.f(r.tc)}</td>${cell(r.ac, r.tc)}</tr>`).join('');
    tbody += `<tr style="border-top:2px solid #0f172a;background:#f8fafc;font-weight:800"><td style="padding:8px 10px">الإجمالي</td><td style="padding:8px;text-align:center">${H.f(tS)}</td>${cell(aS, tS)}<td></td><td style="padding:8px;text-align:center">${H.f(tC)}</td>${cell(aC, tC)}</tr>`;
    const table = `<div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;margin-bottom:14px"><table style="width:100%;border-collapse:collapse;font-size:12px"><tr style="background:#0f172a;color:#fff"><th style="padding:8px 10px;text-align:right">المندوب</th><th style="padding:8px">هدف البيع</th><th style="padding:8px">محقق</th><th style="padding:8px">%</th><th></th><th style="padding:8px">هدف التحصيل</th><th style="padding:8px">محقق</th><th style="padding:8px">%</th></tr>${tbody}</table></div>` + H.infoBox(`المتوقع حتى اليوم ≈ ${expected}% من الشهر.`, 'amber');
    return cfg.MANAGERS.map((mgr) => ({ reportId: 'targets', recipient: mgr.email, subject: `أهداف البيع والتحصيل — كل المناطق — ${period}`, html: H.shell('أهداف البيع والتحصيل', `كل المناطق · ${period}`, table), text: `أهداف البيع والتحصيل — كل المناطق — ${period}` }));
  },
};

// ---- Route-plan helpers ----------------------------------------------------
async function fetchRoutePlan(ctx, planDate) {
  const { data, error } = await ctx.supabase
    .from('daily_route_plan')
    .select('rep_id, customer_name, city, neighborhood, phone, contact_person, sort_order, off_plan, visited, representatives!inner(name, is_active, regions!inner(name))')
    .eq('plan_date', planDate)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  const rows = (data || []).filter((r) => r.representatives && r.representatives.is_active && !cfg.EXCLUDED_REGIONS.includes(r.representatives.regions?.name));
  return rows;
}
const riyadhDateOffset = (days) => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const d = new Date(`${parts}T12:00:00+03:00`); d.setDate(d.getDate() + days);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
};

// ---- 4) Route-plan distribution (today) ------------------------------------
const routePlan = {
  reportType: 'route_plan_daily', version: 'v1',
  async fetch(ctx) { const d = riyadhDateOffset(0); return { rows: await fetchRoutePlan(ctx, d), planDate: d, period: d }; },
  buildUnits(data) {
    const planned = data.rows.filter((r) => !r.off_plan);
    if (!planned.length) return [];
    const byRep = new Map();
    for (const r of planned) {
      const key = r.representatives.name; const region = r.representatives.regions?.name || '';
      const g = byRep.get(key) || { region, items: [] };
      g.items.push({ name: r.customer_name, city: r.city, neighborhood: r.neighborhood, phone: stripBidi(r.phone), contact: r.contact_person });
      byRep.set(key, g);
    }
    function repCard(repName, g) {
      const rowsHtml = g.items.map((it, i) => `<tr style="border-top:1px solid #eef2f7"><td style="padding:6px 8px;text-align:center;color:#94a3b8">${i + 1}</td><td style="padding:6px 10px">${it.name}<div style="color:#64748b;font-size:11px">${[it.city, it.neighborhood].filter(Boolean).join(' · ')}</div></td><td style="padding:6px 10px;text-align:center;color:#334155">${it.phone || '—'}</td><td style="padding:6px 10px;text-align:center;color:#64748b">${it.contact || '—'}</td></tr>`).join('');
      return H.cardOpen(`${repName} — ${g.region} (${g.items.length})`, '') + `<table style="width:100%;border-collapse:collapse;font-size:12px"><tr style="background:#f1f5f9;color:#475569"><th style="padding:6px 8px">#</th><th style="padding:6px 10px;text-align:right">العميل</th><th style="padding:6px 10px">التليفون</th><th style="padding:6px 10px">المسؤول</th></tr>${rowsHtml}</table>` + H.cardClose();
    }
    const period = data.planDate; const units = [];
    const allBody = [...byRep.entries()].map(([rep, g]) => repCard(rep, g)).join('');
    for (const mgr of cfg.MANAGERS) units.push({ reportId: 'routeplan:all', recipient: mgr.email, subject: `خطط خط السير اليوم — كل المناطق — ${period}`, html: H.shell('خطط خط السير اليوم', `كل المناطق · ${period}`, allBody), text: `خطط خط السير اليوم — كل المناطق — ${period}` });
    for (const sup of cfg.SUPERVISORS) {
      const entries = [...byRep.entries()].filter(([, g]) => sup.regions.includes(g.region));
      if (!entries.length) continue;
      const body = entries.map(([rep, g]) => repCard(rep, g)).join('');
      units.push({ reportId: `routeplan:${sup.short}`, recipient: sup.email, subject: `خطط خط السير اليوم — ${sup.regions.join('، ')} — ${period}`, html: H.shell('خطط خط السير اليوم', `${sup.regions.join('، ')} · ${period}`, body), text: `خطط خط السير — ${sup.regions.join('، ')} — ${period}` });
    }
    return units;
  },
};

// ---- 5) Route-adherence (yesterday) ----------------------------------------
const routeAdherence = {
  reportType: 'route_adherence_daily', version: 'v1',
  async fetch(ctx) { const d = riyadhDateOffset(-1); return { rows: await fetchRoutePlan(ctx, d), planDate: d, period: d }; },
  buildUnits(data) {
    const planned = data.rows.filter((r) => !r.off_plan);
    if (!planned.length) return [];
    const byRep = new Map();
    for (const r of data.rows) {
      const key = r.representatives.name; const region = r.representatives.regions?.name || '';
      const g = byRep.get(key) || { region, planned: 0, visited: 0, notVisited: [], offplan: 0 };
      if (r.off_plan) g.offplan += 1; else { g.planned += 1; if (r.visited) g.visited += 1; else g.notVisited.push(r.customer_name); }
      byRep.set(key, g);
    }
    function repRow(rep, g) {
      const p = g.planned > 0 ? Math.round(g.visited * 100 / g.planned) : 0;
      return `<tr style="border-top:1px solid #eef2f7"><td style="padding:7px 10px"><b>${rep}</b><div style="color:#64748b;font-size:11px">${g.region}</div></td><td style="padding:7px 8px;text-align:center">${g.planned}</td><td style="padding:7px 8px;text-align:center">${g.visited}</td><td style="padding:7px 8px;text-align:center">${g.planned - g.visited}</td><td style="padding:7px 8px;text-align:center">${g.offplan}</td><td style="padding:7px 8px;text-align:center;color:${H.adherenceColor(p)};font-weight:700">${p}%</td></tr>`;
    }
    const mkTable = (entries) => `<div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;margin-bottom:14px"><table style="width:100%;border-collapse:collapse;font-size:12px"><tr style="background:#0f172a;color:#fff"><th style="padding:8px 10px;text-align:right">المندوب</th><th style="padding:8px">الخطة</th><th style="padding:8px">تمت</th><th style="padding:8px">لم تُزر</th><th style="padding:8px">خارج الخطة</th><th style="padding:8px">التنفيذ</th></tr>${entries.map(([rep, g]) => repRow(rep, g)).join('')}</table></div>`;
    const period = data.planDate; const units = [];
    const all = [...byRep.entries()].filter(([, g]) => g.planned > 0);
    units.push(...cfg.MANAGERS.map((mgr) => ({ reportId: 'adherence:all', recipient: mgr.email, subject: `تقرير الالتزام بخط السير — كل المناطق — يوم ${period}`, html: H.shell('تقرير الالتزام بخط السير', `كل المناطق · يوم ${period}`, mkTable(all)), text: `تقرير الالتزام بخط السير — كل المناطق — ${period}` })));
    for (const sup of cfg.SUPERVISORS) {
      const entries = all.filter(([, g]) => sup.regions.includes(g.region));
      if (!entries.length) continue;
      units.push({ reportId: `adherence:${sup.short}`, recipient: sup.email, subject: `تقرير الالتزام بخط السير — ${sup.regions.join('، ')} — يوم ${period}`, html: H.shell('تقرير الالتزام بخط السير', `${sup.regions.join('، ')} · يوم ${period}`, mkTable(entries)), text: `التزام خط السير — ${sup.regions.join('، ')} — ${period}` });
    }
    return units;
  },
};

// ---- 6) Aya visit-confirmation (to the owner) ------------------------------
const ayaVisitConfirm = {
  reportType: 'aya_visit_confirm', version: 'v1',
  async fetch(ctx) {
    const from = riyadhDateOffset(-6); const to = riyadhDateOffset(-1);
    const { data, error } = await ctx.supabase
      .from('daily_route_plan')
      .select('plan_date, visited, off_plan, updated_at')
      .gte('plan_date', from).lte('plan_date', to);
    if (error) throw error;
    const byDate = new Map();
    for (const r of data || []) {
      const g = byDate.get(r.plan_date) || { total: 0, visited: 0, last: null };
      g.total += 1; if (r.visited) g.visited += 1;
      if (!g.last || (r.updated_at && r.updated_at > g.last)) g.last = r.updated_at;
      byDate.set(r.plan_date, g);
    }
    return { byDate, yesterday: riyadhDateOffset(-1), today: riyadhDateOffset(0), period: riyadhDateOffset(0) };
  },
  buildUnits(data) {
    const days = [...data.byDate.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
    const y = data.byDate.get(data.yesterday);
    const firstLine = !y ? 'مفيش خطة — إجازة' : (y.visited > 0 ? `أمس (${data.yesterday}): مؤكَّد ✅ (${y.visited} من ${y.total})` : `أمس (${data.yesterday}): غير مؤكَّد ❌ (0 من ${y.total})`);
    const rowsHtml = days.map(([d, g]) => `<tr style="border-top:1px solid #eef2f7"><td style="padding:7px 10px"><b>${d}</b></td><td style="padding:7px 8px;text-align:center;color:${g.visited > 0 ? '#15803d' : '#b91c1c'};font-weight:700">${g.visited}</td><td style="padding:7px 8px;text-align:center">${g.total}</td><td style="padding:7px 8px;text-align:center;color:#64748b;font-size:11px">${g.last ? String(g.last).slice(0, 16).replace('T', ' ') : '—'}</td><td style="padding:7px 8px;text-align:center">${g.visited > 0 ? '✅' : '❌'}</td></tr>`).join('');
    const backlog = days.filter(([d, g]) => d < data.yesterday && g.total > 0 && g.visited === 0).map(([d]) => d);
    let body = H.infoBox(firstLine, !y || y.visited === 0 ? 'red' : 'green');
    body += `<div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;margin-bottom:14px"><table style="width:100%;border-collapse:collapse;font-size:12px"><tr style="background:#0f172a;color:#fff"><th style="padding:8px 10px;text-align:right">التاريخ</th><th style="padding:8px">المؤكَّدة</th><th style="padding:8px">الإجمالي</th><th style="padding:8px">آخر تحديث</th><th style="padding:8px">الحالة</th></tr>${rowsHtml}</table></div>`;
    body += backlog.length ? H.infoBox(`⚠️ أيام لسه متأخرة: ${backlog.join('، ')}`, 'red') : H.infoBox('✅ كل الأيام الأقدم مؤكَّدة (مفيش متأخر متراكم)', 'green');
    return [{ reportId: 'aya', recipient: cfg.AYA_TO, subject: `تقرير تأكيد الزيارات — آية — ${data.today}`, html: H.shell('تقرير تأكيد الزيارات (آية)', data.today, body), text: `تقرير تأكيد الزيارات — آية — ${data.today}\n${firstLine}` }];
  },
};

// ---- 7) Weekly collection plan (per rep + ceo copy), Sundays ---------------
async function listAuthUsers(supabase) {
  const users = [];
  for (let page = 1; page < 100; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    users.push(...(data.users || []));
    if (!data.users || data.users.length < 1000) break;
  }
  return users;
}
const weeklyCollection = {
  reportType: 'weekly_collection_plan', version: 'v1',
  async fetch(ctx) {
    const core = await fetchDebtCore(ctx);
    const [users, rolesRes] = await Promise.all([
      listAuthUsers(ctx.supabase),
      ctx.supabase.from('user_roles').select('user_id,rep_id,role').eq('role', 'rep'),
    ]);
    if (rolesRes.error) throw rolesRes.error;
    const emailByUser = Object.fromEntries(users.map((u) => [u.id, u.email]));
    const emailByRep = {};
    for (const r of rolesRes.data || []) if (r.rep_id && emailByUser[r.user_id]) emailByRep[r.rep_id] = emailByUser[r.user_id];
    const [y, m] = ctx.period.split('-').map(Number);
    const remainingDays = Math.max(1, getRemainingWorkingDaysAfter(y, m, ctx.period) || 1);
    const rows = [];
    for (const [region, st] of core.regionStats.entries()) {
      if (!st.rep) continue;
      const target = st.targetColl; const collected = st.coll; const remaining = Math.max(0, target - collected);
      rows.push({ repId: st.rep.id, name: st.rep.name, region, email: emailByRep[st.rep.id] || null, target, collected, remaining, over60: st.agg.over60, debtTotal: st.agg.total, daily: Math.round(remaining / remainingDays) });
    }
    return { rows, period: ctx.period, remainingDays };
  },
  // Pure: builds one email per rep (to the rep) plus a ceo copy (preserves the
  // original CC ceo@). Each is a separate per-recipient unit.
  buildUnits(data) {
    const kpi = (label, val, color) => `<div style="flex:1;min-width:120px;border:1px solid #e2e8f0;border-radius:10px;padding:12px;text-align:center"><div style="color:#64748b;font-size:12px;margin-bottom:6px">${label}</div><div style="font-size:18px;font-weight:800;color:${color || '#0f172a'}">${H.f(val)}</div></div>`;
    const units = [];
    for (const r of data.rows) {
      if (!r.email) continue;
      const p = H.pct(r.collected, r.target);
      const body = H.cardOpen(`${r.name} — ${r.region}`, `خطة التحصيل الأسبوعية · ${data.period}`)
        + `<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:12px">${kpi('هدف التحصيل', r.target)}${kpi('المحصّل', r.collected, H.targetColor(p))}${kpi('المتبقي', r.remaining, '#b45309')}</div>`
        + `<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:12px">${kpi('دين المنطقة', r.debtTotal)}${kpi('المتأخر فوق 60', r.over60, '#b91c1c')}${kpi('مطلوب يوميًا', r.daily, '#0f172a')}</div>`
        + H.infoBox(`باقٍ <b>${H.f(r.remaining)}</b> ر على <b>${data.remainingDays}</b> يوم عمل ≈ <b>${H.f(r.daily)}</b> ر يوميًا. ابدأ بالأقدم (فوق 150 ← 121-150 ← …).`, p >= 50 ? 'green' : 'amber')
        + H.cardClose();
      const html = H.shell('هدف التحصيل والمتأخرات', `${r.region} · ${data.period}`, body);
      units.push({ reportId: `weekly:${r.repId}`, recipient: r.email, subject: 'هدف التحصيل والمتأخرات', html, text: `هدف التحصيل والمتأخرات — ${r.name} — ${data.period}` });
      units.push({ reportId: `weekly-cc:${r.repId}`, recipient: 'ceo@hawafel.com', subject: `هدف التحصيل والمتأخرات — ${r.name}`, html, text: `هدف التحصيل والمتأخرات — ${r.name} — ${data.period}` });
    }
    return units;
  },
};

const REGISTRY = {
  'manager-debt': makeManagerDebt(null),
  'manager-debt-walid': makeManagerDebt('walid'),
  'manager-debt-ahmed': makeManagerDebt('ahmed'),
  'manager-debt-ramy': makeManagerDebt('ramy'),
  'credit-control': creditControl,
  targets,
  'route-plan': routePlan,
  'route-adherence': routeAdherence,
  'aya-visit-confirm': ayaVisitConfirm,
  'weekly-collection': weeklyCollection,
};

module.exports = { REGISTRY, buildRegionStats, monthProgressPct, stripBidi };
