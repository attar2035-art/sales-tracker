import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { formatCurrency, formatNumber } from '../lib/helpers';
import { buildEffectiveTargetsMap } from '../lib/targets';

// Debt-aging buckets (order matters for the table columns).
const BUCKETS = [
  { key: 'debt_1_45', label: '45-60 يوم' },
  { key: 'debt_over_60', label: '61-90 يوم' },
  { key: 'debt_over_90', label: '91-120 يوم' },
  { key: 'debt_over_120', label: '121-150 يوم' },
  { key: 'debt_over_150', label: 'فوق 150' },
];
// "Aged" (harder) debt = everything 91 days and older.
const AGED_KEYS = ['debt_over_90', 'debt_over_120', 'debt_over_150'];
// "Due to collect" = everything from 61 days and up (61-90 → 150+), excluding
// the 45-60 bucket. This is the actionable overdue amount.
const DUE_KEYS = ['debt_over_60', 'debt_over_90', 'debt_over_120', 'debt_over_150'];
const dueOf = (o) => DUE_KEYS.reduce((s, k) => s + (Number(o[k]) || 0), 0);

const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
const emptyBuckets = () => ({ debt_total: 0, debt_1_45: 0, debt_over_60: 0, debt_over_90: 0, debt_over_120: 0, debt_over_150: 0 });
const addInto = (acc, row) => {
  acc.debt_total += Number(row.debt_total) || 0;
  BUCKETS.forEach(b => { acc[b.key] += Number(row[b.key]) || 0; });
  return acc;
};
const agedOf = (o) => AGED_KEYS.reduce((s, k) => s + (Number(o[k]) || 0), 0);

const fmtDate = (d) => {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt)) return '—';
  const pad2 = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}/${pad2(dt.getMonth() + 1)}/${pad2(dt.getDate())}`;
};

export default function DebtAging() {
  const today = new Date();
  const pad2 = (n) => String(n).padStart(2, '0');
  const todayStr = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`;
  // Per-region debt aggregates (from the per-customer debt snapshot that data
  // entry refreshes daily via «تحديث ديون العملاء»). One row per region/rep.
  const [regionRows, setRegionRows] = useState([]);
  const [targets, setTargets] = useState([]);
  const [collections, setCollections] = useState([]); // {rep_id, daily_collection} this month
  const [loading, setLoading] = useState(false);
  // Which bucket box is expanded to show its per-rep breakdown.
  const [openBucket, setOpenBucket] = useState(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    const [y, m] = todayStr.split('-').map(Number);
    const [debtRes, targetsRes, collRes] = await Promise.all([
      // Company debt aging from the per-customer snapshot (SECURITY DEFINER RPC
      // → consistent company totals for every authorized viewer; excludes
      // regions flagged out of the company total, e.g. مركز مبيعات).
      supabase.rpc('get_company_debt_aging'),
      supabase.from('monthly_targets').select('*').limit(10000),
      // Collection booked so far this month (to date), per rep.
      supabase.from('daily_entries').select('rep_id, daily_collection')
        .eq('year', y).eq('month', m).lte('entry_date', todayStr).limit(50000),
    ]);
    if (debtRes.error) console.error('debt aging:', debtRes.error);
    setRegionRows(debtRes.data || []);
    setTargets(targetsRes.data || []);
    setCollections(collRes.data || []);
    setLoading(false);
  };

  // Normalise the RPC rows into the shape the tables use (one row per rep).
  const rows = useMemo(() => {
    return (regionRows || []).map(r => ({
      repId: r.rep_id,
      name: r.rep_name || 'بدون مندوب',
      region: r.region_name || 'بدون منطقة',
      supervisor: r.supervisor_name || 'بدون مشرف',
      customerCount: Number(r.customer_count) || 0,
      asOf: r.debt_as_of,
      debt_total: Number(r.debt_total) || 0,
      debt_1_45: Number(r.debt_1_45) || 0,
      debt_over_60: Number(r.debt_over_60) || 0,
      debt_over_90: Number(r.debt_over_90) || 0,
      debt_over_120: Number(r.debt_over_120) || 0,
      debt_over_150: Number(r.debt_over_150) || 0,
    })).sort((a, b) => b.debt_total - a.debt_total);
  }, [regionRows]);

  const company = useMemo(() => rows.reduce((acc, r) => addInto(acc, r), emptyBuckets()), [rows]);
  const lastUpdated = useMemo(() => {
    const dates = rows.map(r => r.asOf).filter(Boolean).sort();
    return dates.length ? dates[dates.length - 1] : null;
  }, [rows]);
  const totalCustomers = useMemo(() => rows.reduce((s, r) => s + r.customerCount, 0), [rows]);

  // Group the per-region rows by supervisor (each rep belongs to one region).
  const bySupervisor = useMemo(() => {
    const map = new Map();
    for (const r of rows) {
      const g = map.get(r.supervisor) || { name: r.supervisor, reps: 0, ...emptyBuckets() };
      addInto(g, r); g.reps += 1;
      map.set(r.supervisor, g);
    }
    return [...map.values()].sort((a, b) => b.debt_total - a.debt_total);
  }, [rows]);

  const topDebtor = rows[0];
  const mostAged = useMemo(() => [...rows].sort((a, b) => agedOf(b) - agedOf(a))[0], [rows]);

  // Link arrears to the collection target: how much each rep still needs to
  // collect to hit the monthly collection target, and how much overdue debt
  // (61+ days) is available to collect against it.
  const coverage = useMemo(() => {
    const [y, m] = todayStr.split('-').map(Number);
    const tMap = buildEffectiveTargetsMap(targets, y, m);
    const collByRep = {};
    for (const c of collections) collByRep[c.rep_id] = (collByRep[c.rep_id] || 0) + (Number(c.daily_collection) || 0);
    const list = rows.map(r => {
      const target = Number(tMap[r.repId]?.target_collection) || 0;
      const collected = collByRep[r.repId] || 0;
      const remaining = Math.max(0, target - collected);
      const arrears = dueOf(r); // المستحق تحصيله (61+ days) — the collectable pool
      return { ...r, target, collected, remaining, arrears };
    }).filter(x => x.target > 0);
    const totals = list.reduce((a, x) => {
      a.target += x.target; a.collected += x.collected; a.remaining += x.remaining; a.arrears += x.arrears; return a;
    }, { target: 0, collected: 0, remaining: 0, arrears: 0 });
    return { list: list.sort((a, b) => b.remaining - a.remaining), totals };
  }, [rows, targets, collections, todayStr]);

  // نعرض المديونية فوق 60 يوم كنسبة واضحة من هدف التحصيل — رقم صريح.
  const covState = (x) => ({ txt: `${pct(x.arrears, x.target)}% من هدف التحصيل` });

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
        <h1 className="page-title">🏦 تحليل المتأخرات (أعمار الديون)</h1>
        <div style={{ fontSize: 13, color: 'var(--text-muted, #64748b)', fontWeight: 700 }}>
          آخر تحديث للمديونية: {fmtDate(lastUpdated)}
        </div>
      </div>

      {loading ? (
        <div className="loading"><div className="spinner" />جاري التحميل...</div>
      ) : rows.length === 0 ? (
        <div className="card"><div className="empty-state">
          <div className="empty-state-icon">🏦</div>
          <div className="empty-state-text">لا توجد بيانات ديون بعد. تُحدَّث من شاشة «تحديث ديون العملاء» برفع ملف إكسل لكل منطقة.</div>
        </div></div>
      ) : (
        <>
          {/* Company summary */}
          <div className="card">
            <div className="card-title">إجمالي ديون الشركة — {formatCurrency(company.debt_total)}</div>
            <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 10, padding: '12px 14px', marginBottom: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
              <span style={{ color: '#9a3412', fontWeight: 800, fontSize: 15 }}>💰 المبلغ المستحق تحصيله (من 61 يوم فأكثر)</span>
              <span style={{ color: '#c2410c', fontWeight: 800, fontSize: 22 }}>{formatCurrency(dueOf(company))}
                <span style={{ fontSize: 12, fontWeight: 700, marginInlineStart: 6 }}>({pct(dueOf(company), company.debt_total)}% من الإجمالي)</span>
              </span>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-muted, #64748b)', marginTop: '-0.25rem', marginBottom: '0.75rem' }}>
              الأرقام محسوبة من مديونية كل عميل (المرفوعة عبر «تحديث ديون العملاء») — {formatNumber(totalCustomers)} عميل عليه مديونية.
              اضغط أي فترة لعرض تفاصيل المبالغ — مين عليه كام.
            </p>
            <div className="form-grid">
              {BUCKETS.map(b => {
                const active = openBucket === b.key;
                return (
                  <div key={b.key} role="button" tabIndex={0}
                    onClick={() => setOpenBucket(active ? null : b.key)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenBucket(active ? null : b.key); } }}
                    style={{
                      cursor: 'pointer', border: `1px solid ${active ? '#2563eb' : '#e2e8f0'}`,
                      borderRadius: 10, padding: 12, background: active ? '#eff6ff' : '#ffffff',
                      boxShadow: active ? '0 0 0 2px #bfdbfe' : 'none', textAlign: 'center',
                    }}>
                    <span style={{ display: 'block', color: '#64748b', fontSize: 13, marginBottom: 6 }}>{b.label}</span>
                    <strong style={{ fontSize: 19, color: '#0f172a' }}>{formatCurrency(company[b.key])}</strong>
                    <div style={{ fontSize: 12, color: '#2563eb', marginTop: 4, fontWeight: 700 }}>{pct(company[b.key], company.debt_total)}% من الإجمالي</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Bucket breakdown (who owes what in the selected period) */}
          {openBucket && (() => {
            const label = BUCKETS.find(b => b.key === openBucket)?.label || '';
            const bucketTotal = company[openBucket] || 0;
            const list = rows.map(r => ({ name: r.name, region: r.region, supervisor: r.supervisor, amount: r[openBucket] }))
              .filter(x => x.amount > 0).sort((a, b) => b.amount - a.amount);
            return (
              <div className="card" style={{ borderInlineStart: '4px solid #2563eb' }}>
                <div className="card-title">تفاصيل «{label}» — عند مين ({formatCurrency(bucketTotal)})</div>
                {list.length === 0 ? (
                  <div style={{ color: '#64748b', fontSize: 14 }}>لا توجد مبالغ في هذه الفترة.</div>
                ) : (
                  <div className="table-wrapper">
                    <table className="responsive-cards">
                      <thead>
                        <tr><th>المندوب</th><th>المنطقة</th><th>المشرف</th><th>المبلغ</th><th>% من الفترة</th></tr>
                      </thead>
                      <tbody>
                        {list.map(x => (
                          <tr key={x.name}>
                            <td data-label="المندوب"><strong>{x.name}</strong></td>
                            <td data-label="المنطقة">{x.region}</td>
                            <td data-label="المشرف">{x.supervisor}</td>
                            <td data-label="المبلغ"><strong>{formatCurrency(x.amount)}</strong></td>
                            <td data-label="% من الفترة">{pct(x.amount, bucketTotal)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Highlights */}
          <div className="form-grid" style={{ marginBottom: '1rem' }}>
            <div className="card" style={{ margin: 0, background: '#fef2f2', borderInlineStart: '4px solid #ef4444' }}>
              <div style={{ color: '#991b1b', fontWeight: 800, marginBottom: 4 }}>🔺 أعلى مديونية</div>
              {topDebtor && <div style={{ fontSize: 14, color: '#7f1d1d' }}>
                <b>{topDebtor.name}</b> — {topDebtor.region}<br />
                {formatCurrency(topDebtor.debt_total)} ({pct(topDebtor.debt_total, company.debt_total)}% من الشركة)
              </div>}
            </div>
            <div className="card" style={{ margin: 0, background: '#fffbeb', borderInlineStart: '4px solid #f59e0b' }}>
              <div style={{ color: '#92400e', fontWeight: 800, marginBottom: 4 }}>⏳ أكثر تأخيرًا (91+ يوم)</div>
              {mostAged && <div style={{ fontSize: 14, color: '#78350f' }}>
                <b>{mostAged.name}</b> — {mostAged.region}<br />
                {formatCurrency(agedOf(mostAged))} متقادمة ({pct(agedOf(mostAged), mostAged.debt_total)}% من دينه)
              </div>}
            </div>
          </div>

          {/* Arrears vs collection target */}
          {coverage.list.length > 0 && (
            <div className="card">
              <div className="card-title">
                ربط المتأخرات بهدف التحصيل — المطلوب تحصيله لتغطية الشركة: {formatCurrency(coverage.totals.remaining)}
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-muted, #64748b)', marginTop: '-0.25rem', marginBottom: '0.75rem' }}>
                «المطلوب تحصيله» = المتبقي على هدف التحصيل الشهري. حصّله من المتأخرات بالأولوية للأقدم (فوق 150 ← 121-150 ← …).
                إجمالي الشركة: هدف {formatCurrency(coverage.totals.target)} · محصّل {formatCurrency(coverage.totals.collected)} ·
                المستحق تحصيله (61+) {formatCurrency(coverage.totals.arrears)}
                {coverage.totals.remaining > 0 ? ` (يغطّي ${pct(coverage.totals.arrears, coverage.totals.remaining)}% من المطلوب)` : ' — الهدف مغطّى ✅'}.
              </p>
              <div className="table-wrapper">
                <table className="responsive-cards">
                  <thead>
                    <tr>
                      <th>المندوب</th><th>المنطقة</th><th>هدف التحصيل</th><th>المحصّل</th>
                      <th>المطلوب تحصيله</th><th>المستحق تحصيله (61+)</th><th>المديونية فوق 60 يوم</th>
                    </tr>
                  </thead>
                  <tbody>
                    {coverage.list.map(x => {
                      const st = covState(x);
                      return (
                        <tr key={x.repId}>
                          <td data-label="المندوب"><strong>{x.name}</strong></td>
                          <td data-label="المنطقة">{x.region}</td>
                          <td data-label="هدف التحصيل">{formatCurrency(x.target)}</td>
                          <td data-label="المحصّل">{formatCurrency(x.collected)}</td>
                          <td data-label="المطلوب تحصيله"><strong style={{ color: x.remaining > 0 ? '#b45309' : '#166534' }}>{formatCurrency(x.remaining)}</strong></td>
                          <td className="due-band" data-label="المستحق تحصيله (61+)"><strong className="due-amount" style={{ fontSize: '1.05rem' }}>{formatCurrency(x.arrears)}</strong></td>
                          <td className="debt-ratio" data-label="المديونية فوق 60 يوم">
                            <span className="ratio-chip">{st.txt}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Per-rep table */}
          <div className="card">
            <div className="card-title">تفصيل المناديب (الأكثر تأخيرًا أولًا — 91+ يوم)</div>
            <div className="table-wrapper">
              <table className="responsive-cards">
                <thead>
                  <tr>
                    <th>المندوب</th><th>المنطقة</th><th>المشرف</th><th>عملاء</th><th>إجمالي الدين</th><th>المستحق تحصيله (61+)</th>
                    {BUCKETS.map(b => <th key={b.key}>{b.label}</th>)}
                    <th>متقادمة (91+)</th>
                  </tr>
                </thead>
                <tbody>
                  {[...rows].sort((a, b) => agedOf(b) - agedOf(a)).map(r => (
                    <tr key={r.repId || r.region}>
                      <td data-label="المندوب"><strong>{r.name}</strong></td>
                      <td data-label="المنطقة">{r.region}</td>
                      <td data-label="المشرف">{r.supervisor}</td>
                      <td data-label="عملاء">{formatNumber(r.customerCount)}</td>
                      <td data-label="إجمالي الدين"><strong>{formatCurrency(r.debt_total)}</strong></td>
                      <td className="due-band" data-label="المستحق تحصيله (61+)"><strong className="due-amount">{formatCurrency(dueOf(r))}</strong></td>
                      {BUCKETS.map(b => (
                        <td key={b.key} data-label={b.label}>
                          {formatCurrency(r[b.key])}
                          <div style={{ fontSize: 11, color: '#94a3b8' }}>{pct(r[b.key], r.debt_total)}%</div>
                        </td>
                      ))}
                      <td data-label="متقادمة (91+)"><strong style={{ color: '#b45309' }}>{formatCurrency(agedOf(r))}</strong>
                        <div style={{ fontSize: 11, color: '#94a3b8' }}>{pct(agedOf(r), r.debt_total)}%</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* By region */}
          <div className="card">
            <div className="card-title">تجميع حسب المنطقة</div>
            <div className="table-wrapper">
              <table className="responsive-cards">
                <thead>
                  <tr><th>المنطقة</th><th>المندوب</th><th>إجمالي الدين</th><th>% من الشركة</th><th>متقادمة (91+)</th><th>% متقادم</th></tr>
                </thead>
                <tbody>
                  {rows.map(g => (
                    <tr key={g.region}>
                      <td data-label="المنطقة"><strong>{g.region}</strong></td>
                      <td data-label="المندوب">{g.name}</td>
                      <td data-label="إجمالي الدين"><strong>{formatCurrency(g.debt_total)}</strong></td>
                      <td data-label="% من الشركة"><span className="badge badge-info">{pct(g.debt_total, company.debt_total)}%</span></td>
                      <td data-label="متقادمة (91+)">{formatCurrency(agedOf(g))}</td>
                      <td data-label="% متقادم">{pct(agedOf(g), g.debt_total)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* By supervisor */}
          <div className="card">
            <div className="card-title">تجميع حسب المشرف (كل مناطقه معًا)</div>
            <div className="table-wrapper">
              <table className="responsive-cards">
                <thead>
                  <tr><th>المشرف</th><th>عدد المناديب</th><th>إجمالي الدين</th><th>% من الشركة</th><th>متقادمة (91+)</th><th>% متقادم</th></tr>
                </thead>
                <tbody>
                  {bySupervisor.map(g => (
                    <tr key={g.name}>
                      <td data-label="المشرف"><strong>{g.name}</strong></td>
                      <td data-label="عدد المناديب">{formatNumber(g.reps)}</td>
                      <td data-label="إجمالي الدين"><strong>{formatCurrency(g.debt_total)}</strong></td>
                      <td data-label="% من الشركة"><span className="badge badge-info">{pct(g.debt_total, company.debt_total)}%</span></td>
                      <td data-label="متقادمة (91+)">{formatCurrency(agedOf(g))}</td>
                      <td data-label="% متقادم">{pct(agedOf(g), g.debt_total)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <p className="muted-text" style={{ fontSize: 12, marginTop: 8 }}>
            الأرقام من مديونية العملاء لكل منطقة (تُحدَّث يوميًا برفع إكسل من «تحديث ديون العملاء»).
            «مركز مبيعات» (حسابات الجملة المركزية) مستبعد من إجمالي ديون الشركة.
          </p>
        </>
      )}
    </div>
  );
}
