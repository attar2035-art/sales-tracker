import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { formatCurrency, formatNumber } from '../lib/helpers';
import { DEBT_BUCKETS, debtDueOf } from '../lib/debtAging';

// Aging weight — the older the bucket, the heavier — used for the "oldest" sort
// so customers whose debt is the most aged (فوق 150 → 61-90) rise to the top.
const agingScore = (r) => (Number(r.debt_over_150) || 0) * 4 + (Number(r.debt_over_120) || 0) * 3
  + (Number(r.debt_over_90) || 0) * 2 + (Number(r.debt_over_60) || 0) * 1;

// متأخرات العملاء — a standalone, always-visible list of every customer that
// owes money, sortable by Pareto (highest debt, 80/20) or by oldest aging,
// with region / rep filters and search. Management + rep-scoped views.
export default function CustomerArrears({ rpc = 'get_all_customer_debt', title = 'متأخرات العملاء' }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [regionFilter, setRegionFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [dueOnly, setDueOnly] = useState(false); // only customers with 61+ arrears
  const [sortBy, setSortBy] = useState('pareto'); // pareto | oldest | due
  const [limit, setLimit] = useState(50);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.rpc(rpc);
      if (error) console.error('customer arrears:', error);
      setRows(data || []);
      setLoading(false);
    })();
  }, [rpc]);

  const regions = useMemo(() => {
    const m = new Map();
    for (const r of rows) if (r.region_name) m.set(r.region_name, (m.get(r.region_name) || 0) + 1);
    return [...m.keys()].sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      if (regionFilter !== 'all' && r.region_name !== regionFilter) return false;
      if (dueOnly && debtDueOf(r) <= 0) return false;
      if (q) {
        const hay = `${r.customer_name || ''} ${r.customer_code || ''} ${r.phone || ''} ${r.rep_name || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, regionFilter, dueOnly, search]);

  const totals = useMemo(() => filtered.reduce((a, r) => {
    a.count += 1; a.total += Number(r.debt_total) || 0; a.due += debtDueOf(r); return a;
  }, { count: 0, total: 0, due: 0 }), [filtered]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    if (sortBy === 'oldest') {
      arr.sort((a, b) => agingScore(b) - agingScore(a) || (Number(b.debt_total) || 0) - (Number(a.debt_total) || 0));
    } else if (sortBy === 'due') {
      arr.sort((a, b) => debtDueOf(b) - debtDueOf(a) || (Number(b.debt_total) || 0) - (Number(a.debt_total) || 0));
    } else { // pareto — highest total debt first
      arr.sort((a, b) => (Number(b.debt_total) || 0) - (Number(a.debt_total) || 0));
    }
    return arr;
  }, [filtered, sortBy]);

  // Pareto 80/20: cumulative debt share down the (debt-sorted) list, and the
  // index of the "vital few" that together make up 80% of the debt.
  const pareto = useMemo(() => {
    const total = sorted.reduce((s, r) => s + (Number(r.debt_total) || 0), 0);
    let run = 0;
    const cum = sorted.map((r) => {
      run += Number(r.debt_total) || 0;
      return total > 0 ? (run / total) * 100 : 0;
    });
    const cutoff = cum.findIndex(p => p >= 80); // index of first row reaching 80%
    return { cum, cutoff, total };
  }, [sorted]);

  const shown = sorted.slice(0, limit);

  return (
    <div>
      <div className="page-header"><h1 className="page-title">💰 {title}</h1></div>

      {/* Summary tiles */}
      <div className="form-grid" style={{ marginBottom: '1rem' }}>
        <div className="card" style={{ margin: 0, background: '#eff6ff', borderInlineStart: '4px solid #2563eb' }}>
          <div style={{ color: '#1e40af', fontSize: 13, fontWeight: 700 }}>عملاء عليهم مديونية</div>
          <strong style={{ fontSize: '1.5rem', color: '#0f172a' }}>{formatNumber(totals.count)}</strong>
        </div>
        <div className="card" style={{ margin: 0, background: '#f8fafc', borderInlineStart: '4px solid #64748b' }}>
          <div style={{ color: '#475569', fontSize: 13, fontWeight: 700 }}>إجمالي الدين</div>
          <strong style={{ fontSize: '1.5rem', color: '#0f172a' }}>{formatCurrency(totals.total)}</strong>
        </div>
        <div className="card" style={{ margin: 0, background: '#fef2f2', borderInlineStart: '4px solid #dc2626' }}>
          <div style={{ color: '#991b1b', fontSize: 13, fontWeight: 700 }}>المستحق تحصيله (61+ يوم)</div>
          <strong style={{ fontSize: '1.5rem', color: '#b91c1c' }}>{formatCurrency(totals.due)}</strong>
        </div>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="form-grid">
          {regions.length > 1 && (
            <div className="form-group">
              <label className="form-label">المنطقة / المندوب</label>
              <select className="form-select" value={regionFilter} onChange={e => { setRegionFilter(e.target.value); setLimit(50); }}>
                <option value="all">كل المناطق</option>
                {regions.map(rn => <option key={rn} value={rn}>{rn}</option>)}
              </select>
            </div>
          )}
          <div className="form-group">
            <label className="form-label">الترتيب</label>
            <select className="form-select" value={sortBy} onChange={e => { setSortBy(e.target.value); setLimit(50); }}>
              <option value="pareto">الأعلى مديونية — قاعدة باريتو (80/20)</option>
              <option value="oldest">الأقدم — حسب أعمار الدين</option>
              <option value="due">الأكثر استحقاقًا للتحصيل (61+)</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">بحث (اسم / كود / تليفون)</label>
            <input className="form-input" value={search} onChange={e => { setSearch(e.target.value); setLimit(50); }} placeholder="🔎 اكتب اسم العميل أو كوده أو تليفونه" />
          </div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14 }}>
          <input type="checkbox" checked={dueOnly} onChange={e => { setDueOnly(e.target.checked); setLimit(50); }} />
          عرض من عليهم متأخرات مستحقة (61+ يوم) فقط
        </label>
      </div>

      {/* List */}
      <div className="card">
        <div className="card-title">
          القائمة — {formatNumber(filtered.length)} عميل
          {sortBy === 'pareto' ? ' (الأعلى مديونية أولًا)' : sortBy === 'oldest' ? ' (الأقدم حسب أعمار الدين)' : ' (الأكثر استحقاقًا أولًا)'}
        </div>

        {!loading && sortBy === 'pareto' && pareto.cutoff >= 0 && (
          <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, padding: '10px 14px', marginBottom: '0.75rem', fontSize: 13, color: '#1e3a8a' }}>
            📊 <b>قاعدة باريتو:</b> أعلى <b>{formatNumber(pareto.cutoff + 1)}</b> عميل
            ({Math.round(((pareto.cutoff + 1) / filtered.length) * 100)}% من العملاء) عليهم <b>~80%</b> من إجمالي الدين.
            ابدأ التحصيل بهم — الصفوف المميّزة بـ ⭐.
          </div>
        )}

        {loading ? (
          <div className="loading"><div className="spinner" />جاري التحميل...</div>
        ) : filtered.length === 0 ? (
          <div style={{ color: '#64748b', fontSize: 14 }}>لا يوجد عملاء مطابقين.</div>
        ) : (
          <>
            <div className="table-wrapper">
              <table className="responsive-cards">
                <thead>
                  <tr>
                    <th>#</th><th>العميل</th><th>المنطقة</th><th>المندوب</th><th>المدينة</th><th>التليفون</th>
                    <th>إجمالي الدين</th>
                    {sortBy === 'pareto' && <th>نسبة تراكمية</th>}
                    <th>المستحق (61+)</th>
                    {DEBT_BUCKETS.map(b => <th key={b.key}>{b.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((c, i) => {
                    const vital = sortBy === 'pareto' && pareto.cutoff >= 0 && i <= pareto.cutoff;
                    return (
                    <tr key={c.customer_code} style={{ background: vital ? 'rgba(37,99,235,0.06)' : undefined }}>
                      <td data-label="#">{vital ? '⭐ ' : ''}{formatNumber(i + 1)}</td>
                      <td data-label="العميل"><strong>{c.customer_name}</strong>
                        <div style={{ fontSize: 11, color: '#94a3b8' }}>
                          كود {c.customer_code}
                          {c.debt_offbook ? ' · خارج حساب المندوب' : ''}
                          {c.region_excluded ? ' · مركز مبيعات' : ''}
                        </div>
                      </td>
                      <td data-label="المنطقة">{c.region_name}</td>
                      <td data-label="المندوب">{c.rep_name || '—'}</td>
                      <td data-label="المدينة">{c.city || '—'}</td>
                      <td data-label="التليفون">{c.phone || '—'}</td>
                      <td data-label="إجمالي الدين"><strong>{formatCurrency(c.debt_total)}</strong></td>
                      {sortBy === 'pareto' && <td data-label="نسبة تراكمية">{Math.round(pareto.cum[i] || 0)}%</td>}
                      <td className="due-band" data-label="المستحق (61+)"><strong className="due-amount">{formatCurrency(debtDueOf(c))}</strong></td>
                      {DEBT_BUCKETS.map(b => <td key={b.key} data-label={b.label}>{formatCurrency(c[b.key])}</td>)}
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {filtered.length > shown.length && (
              <div className="btn-row" style={{ marginTop: '0.75rem' }}>
                <button className="btn btn-ghost" onClick={() => setLimit(l => l + 100)}>
                  عرض المزيد ({formatNumber(filtered.length - shown.length)} متبقّي)
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
