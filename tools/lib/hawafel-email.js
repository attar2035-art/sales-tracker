// Shared Hawafel email building blocks (RTL / Tahoma, header #0f172a, white
// cards with #e2e8f0 borders) so every backend report renders in the same
// house style the team already receives.

const { escapeHtml, formatNumber } = require('../../src/lib/reportMetrics');

const f = (v) => formatNumber(Math.round(Number(v) || 0));
const pct = (a, b) => (b > 0 ? Math.round((Number(a) || 0) * 100 / b) : 0);

// collection / target achievement colour
const targetColor = (p) => (p >= 50 ? '#15803d' : p >= 30 ? '#b45309' : '#b91c1c');
// route-adherence colour
const adherenceColor = (p) => (p >= 90 ? '#15803d' : p >= 60 ? '#b45309' : '#b91c1c');

function shell(title, subtitle, bodyHtml) {
  return `<div style="background:#f1f5f9;padding:20px 0;font-family:Tahoma,Arial,sans-serif" dir="rtl"><div style="max-width:760px;margin:0 auto;padding:0 16px"><div style="background:#0f172a;color:#fff;padding:16px 18px;border-radius:10px 10px 0 0"><div style="font-size:18px;font-weight:700">حوافل — ${escapeHtml(title)}</div><div style="font-size:13px;color:#cbd5e1;margin-top:3px">${escapeHtml(subtitle)}</div></div><div style="background:#f8fafc;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 10px 10px;padding:16px">${bodyHtml}<div style="color:#94a3b8;font-size:11px;text-align:center;margin-top:4px">إدارة المبيعات — حوافل</div></div></div></div>`;
}

function cardOpen(title, subtitle) {
  return `<div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;margin-bottom:16px"><div style="background:#0f172a;color:#fff;padding:12px 16px"><div style="font-size:16px;font-weight:700">${escapeHtml(title)}</div>${subtitle ? `<div style="font-size:12px;color:#cbd5e1;margin-top:3px">${subtitle}</div>` : ''}</div><div style="padding:14px 16px">`;
}
const cardClose = () => '</div></div>';

// Debt-aging block: current(<45) / 45-60 / over-60 + the four over-60 buckets.
function agingBlock({ cur, d4560, over60, buckets }) {
  const b = buckets || [0, 0, 0, 0];
  return `<div style="font-size:13px;font-weight:700;color:#334155;margin-bottom:8px">عمر الدين</div><div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:14px"><table style="width:100%;border-collapse:collapse;font-size:12px"><tr style="background:#f1f5f9;color:#475569"><th style="padding:6px 8px">جاري (أقل من 45) 🟢</th><th style="padding:6px 8px">45–60 🟡</th><th style="padding:6px 8px">متأخر فوق 60 🔴</th></tr><tr><td style="padding:9px 8px;text-align:center;color:#15803d;font-weight:700;font-size:14px">${f(cur)}</td><td style="padding:9px 8px;text-align:center;color:#b45309;font-weight:700;font-size:14px">${f(d4560)}</td><td style="padding:9px 8px;text-align:center;color:#b91c1c;font-weight:700;font-size:14px">${f(over60)}</td></tr></table><table style="width:100%;border-collapse:collapse;font-size:11px;border-top:1px solid #e2e8f0"><tr style="color:#64748b;background:#fcfdfe"><td style="padding:5px 8px;text-align:center">61–90: <b style="color:#334155">${f(b[0])}</b></td><td style="padding:5px 8px;text-align:center">91–120: <b style="color:#334155">${f(b[1])}</b></td><td style="padding:5px 8px;text-align:center">121–150: <b style="color:#334155">${f(b[2])}</b></td><td style="padding:5px 8px;text-align:center">فوق 150: <b style="color:#334155">${f(b[3])}</b></td></tr></table></div>`;
}

// Top-N customers table: [{ name, amount, oldest }]
function topCustomers(rows, heading = 'أعلى 5 عملاء في المتأخر فوق 60') {
  const body = rows.map((r, i) => `<tr style="border-top:1px solid #eef2f7;background:${i % 2 === 0 ? '#fbfdff' : '#fff'}"><td style="padding:7px 8px;text-align:center;color:#94a3b8">${i + 1}</td><td style="padding:7px 10px;color:#0f172a">${escapeHtml(r.name)}</td><td style="padding:7px 10px;text-align:center;color:#b91c1c;font-weight:700">${f(r.amount)}${r.overLimit ? ' ⚠️' : ''}</td>${r.limit !== undefined ? `<td style="padding:7px 10px;text-align:center;color:${r.overLimit ? '#b91c1c' : '#64748b'}">${r.limit > 0 ? f(r.limit) : '—'}</td>` : ''}<td style="padding:7px 10px;text-align:center;color:#64748b">${escapeHtml(r.oldest || '')}</td></tr>`).join('');
  const limitHead = rows.some((r) => r.limit !== undefined) ? '<th style="padding:6px 10px">الحد الائتماني</th>' : '';
  return `<div style="font-size:13px;font-weight:700;color:#334155;margin-bottom:8px">${escapeHtml(heading)}</div><div style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:14px"><table style="width:100%;border-collapse:collapse;font-size:12px"><tr style="background:#f1f5f9;color:#475569"><th style="padding:6px 8px;width:28px">#</th><th style="padding:6px 10px;text-align:right">العميل</th><th style="padding:6px 10px">المتأخر فوق 60</th>${limitHead}<th style="padding:6px 10px">أقدم شريحة</th></tr>${body}</table></div>`;
}

function collectionLine({ coll, target }) {
  const p = pct(coll, target); const rem = (Number(target) || 0) - (Number(coll) || 0);
  return `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px;font-size:13px;color:#0f172a">التحصيل هذا الشهر: <b>${f(coll)}</b> من <b>${f(target)}</b> · <b style="color:${targetColor(p)}">${p}%</b> · المتبقي: <b>${f(rem)}</b> ر</div>`;
}

function infoBox(text, kind = 'amber') {
  const c = kind === 'red' ? ['#fef2f2', '#fecaca', '#991b1b'] : kind === 'green' ? ['#ecfdf5', '#a7f3d0', '#065f46'] : ['#fffbeb', '#fde68a', '#92400e'];
  return `<div style="background:${c[0]};border:1px solid ${c[1]};border-radius:10px;padding:12px 14px;font-size:13px;color:${c[2]};margin-bottom:14px">${text}</div>`;
}

const oldestSlice = (d) => {
  const n = (x) => Number(x) || 0;
  if (n(d.debt_over_150) > 0) return 'فوق 150';
  if (n(d.debt_over_120) > 0) return '121-150';
  if (n(d.debt_over_90) > 0) return '91-120';
  return '61-90';
};

module.exports = { f, pct, targetColor, adherenceColor, shell, cardOpen, cardClose, agingBlock, topCustomers, collectionLine, infoBox, oldestSlice };
