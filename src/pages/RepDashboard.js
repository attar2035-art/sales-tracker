import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { MONTHS_AR, formatCurrency, formatNumber, getRemainingWorkingDays, getTotalWorkingDaysInMonth, getMonthProgress } from '../lib/helpers';
import { buildEffectiveTargetsMap } from '../lib/targets';

export default function RepDashboard({ repId }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [entries, setEntries] = useState([]);
  const [target, setTarget] = useState(null);
  const [rep, setRep] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { fetchRep(); }, []);
  useEffect(() => { if (repId) fetchDetails(); }, [repId, year, month]);

  const fetchRep = async () => {
    const { data } = await supabase.from('representatives')
      .select('*, supervisors(name), regions(name)').eq('id', repId).single();
    if (data) setRep(data);
  };

  const fetchDetails = async () => {
    setLoading(true);
    const [e, t] = await Promise.all([
      supabase.from('daily_entries').select('*')
        .eq('rep_id', repId).eq('year', year).eq('month', month).order('entry_date'),
      supabase.from('monthly_targets').select('*')
        .eq('rep_id', repId).limit(10000),
    ]);
    if (e.data) setEntries(e.data);
    const targetMap = buildEffectiveTargetsMap(t.data || [], year, month);
    setTarget(targetMap[repId] || null);
    setLoading(false);
  };

  const years = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1];
  const remainingDays = getRemainingWorkingDays(year, month);
  const totalDays = getTotalWorkingDaysInMonth(year, month);
  const monthProg = Math.round(getMonthProgress(year, month));

  const sum = (field) => entries.reduce((a, e) => a + (parseFloat(e[field]) || 0), 0);
  const totals = {
    sales: sum('daily_sales'), collection: sum('daily_collection'),
    new_customers: sum('new_customers'), new_customers_value: sum('new_customers_value'),
    total_visits: sum('total_visits'), successful_visits: sum('successful_visits'),
    shelf_photos: sum('shelf_photos'),
    new_products_skus: sum('new_products_skus'), new_products_qty: sum('new_products_qty'),
    working_hours: sum('working_hours'), km: sum('km'),
    expenses: sum('daily_expenses'), overdue_collected: sum('overdue_collected'),
  };

  const KPIRow = ({ label, achieved, targetVal, currency }) => {
    const pct = targetVal > 0 ? Math.round((achieved / targetVal) * 100) : null;
    const remaining = targetVal > 0 ? Math.max(0, targetVal - achieved) : null;
    const daily = remaining !== null && remainingDays > 0 ? remaining / remainingDays : null;
    const fmt = currency ? formatCurrency : formatNumber;
    const color = pct === null ? '#94a3b8' : pct >= monthProg + 5 ? '#10b981' : pct >= monthProg - 5 ? '#f59e0b' : '#ef4444';
    return (
      <tr>
        <td>{label}</td>
        <td style={{ color: '#10b981', fontWeight: 700 }}>{fmt(achieved)}</td>
        <td>{targetVal > 0 ? fmt(targetVal) : '-'}</td>
        <td style={{ color: '#ef4444' }}>{remaining !== null ? fmt(remaining) : '-'}</td>
        <td style={{ color: '#f59e0b' }}>{daily !== null ? fmt(daily) : '-'}</td>
        <td>
          {pct !== null ? (
            <div>
              <span style={{ fontWeight: 700, color }}>{pct}%</span>
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${Math.min(100, pct)}%`, background: color }} />
              </div>
            </div>
          ) : '-'}
        </td>
      </tr>
    );
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">📊 تقريري</h1>
        <div className="month-selector">
          <select value={month} onChange={e => setMonth(+e.target.value)}>
            {MONTHS_AR.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <select value={year} onChange={e => setYear(+e.target.value)}>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {rep && (
        <div className="card" style={{ padding: '1rem 1.5rem', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
            <div><span className="form-label">المندوب: </span><strong>{rep.name}</strong></div>
            <div><span className="form-label">المشرف: </span>{rep.supervisors?.name || '-'}</div>
            <div><span className="form-label">المنطقة: </span>{rep.regions?.name || '-'}</div>
          </div>
        </div>
      )}

      <div className="card" style={{ padding: '1rem 1.5rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
          <span style={{ fontWeight: 700 }}>📅 تقدم الشهر — {MONTHS_AR[month-1]} {year}</span>
          <span style={{ color: '#8b5cf6', fontWeight: 700 }}>{monthProg}% — متبقي {remainingDays} يوم من {totalDays}</span>
        </div>
        <div className="progress-bar" style={{ height: 10 }}>
          <div className="progress-fill" style={{ width: `${monthProg}%`, background: '#8b5cf6' }} />
        </div>
      </div>

      {loading ? (
        <div className="loading"><div className="spinner" />جاري التحميل...</div>
      ) : (
        <>
          <div className="card">
            <div className="card-title">📈 ملخص الأداء</div>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr><th>البند</th><th>المنجز</th><th>الهدف</th><th>المتبقي</th><th>يومي مطلوب</th><th>%</th></tr>
                </thead>
                <tbody>
                  <KPIRow label="🎯 المبيعات" achieved={totals.sales} targetVal={target?.target_sales || 0} currency />
                  <KPIRow label="💰 التحصيل" achieved={totals.collection} targetVal={target?.target_collection || 0} currency />
                  <KPIRow label="👥 العملاء الجدد" achieved={totals.new_customers} targetVal={target?.target_new_customers || 0} />
                  <KPIRow label="🧾 قيمة فواتير العملاء" achieved={totals.new_customers_value} targetVal={0} currency />
                  <KPIRow label="📍 الزيارات الإجمالي" achieved={totals.total_visits} targetVal={target?.target_total_visits || 0} />
                  <KPIRow label="✅ الزيارات الناجحة" achieved={totals.successful_visits} targetVal={target?.target_successful_visits || 0} />
                  <KPIRow label="📸 صور الرف" achieved={totals.shelf_photos} targetVal={totals.total_visits} />
                  <KPIRow label="📦 الأصناف الجديدة" achieved={totals.new_products_skus} targetVal={target?.target_new_products_skus || 0} />
                  <KPIRow label="📦 القطع الجديدة" achieved={totals.new_products_qty} targetVal={target?.target_new_products_qty || 0} />
                  <KPIRow label="⏰ ساعات العمل" achieved={totals.working_hours} targetVal={target?.target_working_hours || 0} />
                  <KPIRow label="🚗 الكيلومترات" achieved={totals.km} targetVal={0} />
                  <KPIRow label="💸 المصروفات" achieved={totals.expenses} targetVal={0} currency />
                  <KPIRow label="⚠️ محصل المتأخرات" achieved={totals.overdue_collected} targetVal={target?.overdue_total || 0} currency />
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <div className="card-title">📅 السجل اليومي ({entries.length} يوم)</div>
            {entries.length === 0 ? (
              <div className="empty-state"><div className="empty-state-icon">📅</div><div className="empty-state-text">لا توجد إدخالات بعد</div></div>
            ) : (
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>التاريخ</th><th>مبيعات</th><th>تحصيل</th><th>عملاء</th>
                      <th>زيارات</th><th>ناجحة</th><th>صور رف</th><th>أصناف</th><th>قطع</th>
                      <th>ساعات</th><th>كم</th><th>مصروفات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map(e => (
                      <tr key={e.id}>
                        <td>{new Date(e.entry_date).toLocaleDateString('ar-SA-u-ca-gregory')}</td>
                        <td style={{ color: '#10b981' }}>{formatCurrency(e.daily_sales)}</td>
                        <td style={{ color: '#10b981' }}>{formatCurrency(e.daily_collection)}</td>
                        <td>{e.new_customers}</td>
                        <td>{e.total_visits}</td>
                        <td>{e.successful_visits}</td>
                        <td>{e.shelf_photos || 0}</td>
                        <td>{e.new_products_skus}</td>
                        <td>{e.new_products_qty}</td>
                        <td>{e.working_hours}</td>
                        <td>{e.km}</td>
                        <td>{formatCurrency(e.daily_expenses)}</td>
                      </tr>
                    ))}
                    <tr style={{ background: '#0f172a', fontWeight: 700 }}>
                      <td>الإجمالي</td>
                      <td style={{ color: '#10b981' }}>{formatCurrency(totals.sales)}</td>
                      <td style={{ color: '#10b981' }}>{formatCurrency(totals.collection)}</td>
                      <td>{totals.new_customers}</td>
                      <td>{totals.total_visits}</td>
                      <td>{totals.successful_visits}</td>
                      <td>{totals.shelf_photos}</td>
                      <td>{totals.new_products_skus}</td>
                      <td>{totals.new_products_qty}</td>
                      <td>{totals.working_hours}</td>
                      <td>{totals.km}</td>
                      <td style={{ color: '#f59e0b' }}>{formatCurrency(totals.expenses)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
