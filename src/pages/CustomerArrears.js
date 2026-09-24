import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { formatCurrency, formatNumber } from '../lib/helpers';
import { DEBT_BUCKETS, debtDueOf } from '../lib/debtAging';

// متأخرات العملاء — a standalone, always-visible list of every customer that
// owes money (across all regions), most overdue (61+) first, with region /
// rep / city filters and search. Management view (admin / manager / data_entry).
export default function CustomerArrears({ rpc = 'get_all_customer_debt', title = 'متأخرات العملاء' }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [regionFilter, setRegionFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [dueOnly, setDueOnly] = useState(false); // only customers with 61+ arrears
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

  const shown = filtered.slice(0, limit);

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
          القائمة — {formatNumber(filtered.length)} عميل (الأكثر استحقاقًا أولًا)
        </div>
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
                    <th>العميل</th><th>المنطقة</th><th>المندوب</th><th>المدينة</th><th>التليفون</th>
                    <th>إجمالي الدين</th><th>المستحق (61+)</th>
                    {DEBT_BUCKETS.map(b => <th key={b.key}>{b.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {shown.map(c => (
                    <tr key={c.customer_code}>
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
                      <td className="due-band" data-label="المستحق (61+)"><strong className="due-amount">{formatCurrency(debtDueOf(c))}</strong></td>
                      {DEBT_BUCKETS.map(b => <td key={b.key} data-label={b.label}>{formatCurrency(c[b.key])}</td>)}
                    </tr>
                  ))}
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
