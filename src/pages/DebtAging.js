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

export default function DebtAging() {
  const today = new Date();
  const pad2 = (n) => String(n).padStart(2, '0');
  const todayStr = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`;
  const [asOf, setAsOf] = useState(todayStr);
  const [reps, setReps] = useState([]);
  const [entries, setEntries] = useState([]);
  const [targets, setTargets] = useState([]);
  const [collections, setCollections] = useState([]); // {rep_id, daily_collection} this month
  const [loading, setLoading] = useState(false);
  // Which bucket box is expanded to show its per-rep breakdown.
  const [openBucket, setOpenBucket] = useState(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [asOf]);

  const load = async () => {
    setLoading(true);
    const [y, m] = asOf.split('-').map(Number);
    const [repsRes, entriesRes, targetsRes, collRes] = await Promise.all([
      supabase.from('representatives')
        .select('id, name, is_active, supervisor_id, supervisors(name), regions(name)')
        .eq('is_active', true),
      // Rows where debt was actually ENTERED (its owner is recorded in
      // field_owners), on or before the chosen date, newest first — so each
      // rep's latest snapshot is the current balance even if it was paid down
      // to zero (a real 0 differs from "no debt entered", which we skip).
      supabase.from('daily_entries')
        .select('rep_id, entry_date, debt_total, debt_1_45, debt_over_60, debt_over_90, debt_over_120, debt_over_150')
        .lte('entry_date', asOf)
        .not('field_owners->>debt_total', 'is', null)
        .order('entry_date', { ascending: false })
        .limit(20000),
      supabase.from('monthly_targets').select('*').limit(10000),
      // Collection booked so far in the selected month (to date), per rep.
      supabase.from('daily_entries').select('rep_id, daily_collection')
        .eq('year', y).eq('month', m).lte('entry_date', asOf).limit(50000),
    ]);
    if (repsRes.data) setReps(repsRes.data);
    setEntries(entriesRes.data || []);
    setTargets(targetsRes.data || []);
    setCollections(collRes.data || []);
    setLoading(false);
  };

  // Per-rep latest snapshot (+ previous for the day-over-day change).
  const rows = useMemo(() => {
    const repById = new Map(reps.map(r => [r.id, r]));
    const byRep = new Map();
    for (const e of entries) {
      const list = byRep.get(e.rep_id) || [];
      list.push(e); // already sorted date desc
      byRep.set(e.rep_id, list);
    }
    const out = [];
    for (const [repId, list] of byRep.entries()) {
      const rep = repById.get(repId);
      if (!rep) continue; // inactive/unknown rep
      const cur = list[0];
      const prev = list[1];
      out.push({
        repId,
        name: rep.name,
        region: rep.regions?.name || 'بدون منطقة',
        supervisor: rep.supervisors?.name || 'بدون مشرف',
        date: cur.entry_date,
        debt_total: Number(cur.debt_total) || 0,
        debt_1_45: Number(cur.debt_1_45) || 0,
        debt_over_60: Number(cur.debt_over_60) || 0,
        debt_over_90: Number(cur.debt_over_90) || 0,
        debt_over_120: Number(cur.debt_over_120) || 0,
        debt_over_150: Number(cur.debt_over_150) || 0,
        change: prev != null ? (Number(cur.debt_total) || 0) - (Number(prev.debt_total) || 0) : null,
      });
    }
    return out.sort((a, b) => b.debt_total - a.debt_total);
  }, [entries, reps]);

  const company = useMemo(() => rows.reduce((acc, r) => addInto(acc, r), emptyBuckets()), [rows]);

  const groupBy = (field) => {
    const map = new Map();
    for (const r of rows) {
      const key = r[field];
      const g = map.get(key) || { name: key, reps: 0, ...emptyBuckets() };
      addInto(g, r); g.reps += 1;
      map.set(key, g);
    }
    return [...map.values()].sort((a, b) => b.debt_total - a.debt_total);
  };
  const byRegion = useMemo(() => groupBy('region'), [rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const bySupervisor = useMemo(() => groupBy('supervisor'), [rows]); // eslint-disable-line react-hooks/exhaustive-deps

  const topDebtor = rows[0];
  const mostAged = useMemo(() => [...rows].sort((a, b) => agedOf(b) - agedOf(a))[0], [rows]);

  // Link arrears to the collection target: how much each rep still needs to
  // collect to hit the monthly collection target, and whether the outstanding
  // arrears cover that gap.
  const coverage = useMemo(() => {
    const [y, m] = asOf.split('-').map(Number);
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
  }, [rows, targets, collections, asOf]);

  // بدل حكم «كافية/غير كافية» (كان بيلخبط): نعرض المديونية فوق 60 يوم كنسبة
  // واضحة من هدف التحصيل — رقم صريح بدون تفسير قد يُفهم خطأ.
  const covState = (x) => ({
    txt: `${pct(x.arrears, x.target)}% من هدف التحصيل`,
  });

  const changeCell = (change) => {
    if (change == null) return <span style={{ color: '#94a3b8' }}>—</span>;
    if (change === 0) return <span style={{ color: '#94a3b8' }}>ثابت</span>;
    const up = change > 0; // debt went up = bad
    return (
      <span style={{ color: up ? '#ef4444' : '#10b981', fontWeight: 700 }}>
        {up ? '▲' : '▼'} {formatCurrency(Math.abs(change))}
      </span>
    );
  };

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
        <h1 className="page-title">🏦 تحليل المتأخرات (أعمار الديون)</h1>
        <div className="form-group" style={{ margin: 0 }}>
          <label className="form-label" style={{ display: 'inline-block', marginInlineEnd: '0.5rem' }}>حتى تاريخ</label>
          <input className="form-input" type="date" value={asOf} max={todayStr}
            onChange={e => setAsOf(e.target.value)} style={{ display: 'inline-block', width: 'auto' }} />
        </div>
      </div>

      {loading ? (
        <div className="loading"><div className="spinner" />جاري التحميل...</div>
      ) : rows.length === 0 ? (
        <div className="card"><div className="empty-state">
          <div className="empty-state-icon">🏦</div>
          <div className="empty-state-text">لا توجد بيانات ديون مسجّلة حتى هذا التاريخ. أدخِلها من شاشة الإدخال اليومي (قسم أعمار الديون).</div>
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
                    <th>المندوب</th><th>المنطقة</th><th>المشرف</th><th>إجمالي الدين</th><th>المستحق تحصيله (61+)</th>
                    {BUCKETS.map(b => <th key={b.key}>{b.label}</th>)}
                    <th>متقادمة (91+)</th><th>التغيّر</th>
                  </tr>
                </thead>
                <tbody>
                  {[...rows].sort((a, b) => agedOf(b) - agedOf(a)).map(r => (
                    <tr key={r.repId}>
                      <td data-label="المندوب"><strong>{r.name}</strong></td>
                      <td data-label="المنطقة">{r.region}</td>
                      <td data-label="المشرف">{r.supervisor}</td>
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
                      <td data-label="التغيّر">{changeCell(r.change)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted-text" style={{ fontSize: 12, marginTop: 8 }}>
              التغيّر = فرق إجمالي الدين عن آخر إدخال سابق للمندوب (🔺 زيادة الدين، 🔻 انخفاضه).
            </p>
          </div>

          {/* By region */}
          <div className="card">
            <div className="card-title">تجميع حسب المنطقة</div>
            <div className="table-wrapper">
              <table className="responsive-cards">
                <thead>
                  <tr><th>المنطقة</th><th>عدد المناديب</th><th>إجمالي الدين</th><th>% من الشركة</th><th>متقادمة (91+)</th><th>% متقادم</th></tr>
                </thead>
                <tbody>
                  {byRegion.map(g => (
                    <tr key={g.name}>
                      <td data-label="المنطقة"><strong>{g.name}</strong></td>
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
        </>
      )}
    </div>
  );
}
