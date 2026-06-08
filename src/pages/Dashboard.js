import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import {
  MONTHS_AR, formatCurrency, formatNumber,
  getAchievementStatus, getStatusColor, getStatusLabel,
  getMonthProgress, getRemainingWorkingDays, getTotalWorkingDaysInMonth,
} from '../lib/helpers';

function KPICard({ icon, title, achieved, target, unit = '', color = '#3b82f6', priority }) {
  const pct = target > 0 ? Math.min(100, Math.round((achieved / target) * 100)) : 0;
  const remaining = Math.max(0, target - achieved);
  const monthProg = Math.round(getMonthProgress(new Date().getFullYear(), new Date().getMonth() + 1));
  const status = getAchievementStatus(achieved, target, getMonthProgress(new Date().getFullYear(), new Date().getMonth() + 1));

  return (
    <div className="stat-card" style={{ borderRight: `4px solid ${color}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
        <div>
          <div className="stat-label">{icon} {title}</div>
          <div className="stat-value" style={{ color }}>{formatCurrency(achieved)}{unit}</div>
        </div>
        {target > 0 && (
          <div style={{ textAlign: 'left' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: getStatusColor(status) }}>{pct}%</div>
            <span className="badge" style={{ background: status === 'ahead' ? '#064e3b' : status === 'on-track' ? '#451a03' : '#450a0a', color: getStatusColor(status) }}>
              {getStatusLabel(status)}
            </span>
          </div>
        )}
      </div>
      {target > 0 && (
        <>
          <div className="progress-bar" style={{ height: 8, marginBottom: '0.5rem' }}>
            <div className="progress-fill" style={{ width: `${pct}%`, background: color }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            <span>الهدف: {formatCurrency(target)}{unit}</span>
            <span style={{ color: '#ef4444' }}>متبقي: {formatCurrency(remaining)}{unit}</span>
          </div>
        </>
      )}
    </div>
  );
}

export default function Dashboard() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filterSup, setFilterSup] = useState('');
  const [filterRegion, setFilterRegion] = useState('');
  const [supervisors, setSupervisors] = useState([]);
  const [regions, setRegions] = useState([]);
  const [activeMetric, setActiveMetric] = useState('sales');
  const [activeView, setActiveView] = useState('reps');

  useEffect(() => { fetchMeta(); }, []);
  useEffect(() => { fetchData(); }, [year, month]);

  const fetchMeta = async () => {
    const [s, r] = await Promise.all([
      supabase.from('supervisors').select('*').order('name'),
      supabase.from('regions').select('*').order('name'),
    ]);
    if (s.data) setSupervisors(s.data);
    if (r.data) setRegions(r.data);
  };

  const fetchData = async () => {
    setLoading(true);
    const { data: reps } = await supabase.from('representatives')
      .select('*, supervisors(name,id), regions(name,id)')
      .eq('is_active', true).order('name');
    if (!reps) { setLoading(false); return; }
    const { data: targets } = await supabase.from('monthly_targets')
      .select('*').eq('year', year).eq('month', month);
    const { data: entries } = await supabase.from('daily_entries')
      .select('*').eq('year', year).eq('month', month);
    const targetsMap = {};
    (targets || []).forEach(t => { targetsMap[t.rep_id] = t; });
    const entriesMap = {};
    (entries || []).forEach(e => {
      if (!entriesMap[e.rep_id]) entriesMap[e.rep_id] = [];
      entriesMap[e.rep_id].push(e);
    });
    const remainingDays = getRemainingWorkingDays(year, month);
    const monthProg = getMonthProgress(year, month);
    const combined = reps.map(rep => {
      const t = targetsMap[rep.id] || {};
      const repEntries = entriesMap[rep.id] || [];
      const sum = (field) => repEntries.reduce((acc, e) => acc + (parseFloat(e[field]) || 0), 0);
      const achieved = {
        sales: sum('daily_sales'), collection: sum('daily_collection'),
        new_customers: sum('new_customers'), new_customers_value: sum('new_customers_value'),
        total_visits: sum('total_visits'), successful_visits: sum('successful_visits'),
        new_products_skus: sum('new_products_skus'), new_products_qty: sum('new_products_qty'),
        new_products_availability: repEntries.length > 0
          ? repEntries.reduce((a, e) => a + (parseFloat(e.new_products_availability) || 0), 0) / repEntries.length : 0,
        working_hours: sum('working_hours'), km: sum('km'),
        expenses: sum('daily_expenses'), overdue_collected: sum('overdue_collected'),
      };
      const remaining = {
        sales: Math.max(0, (t.target_sales || 0) - achieved.sales),
        collection: Math.max(0, (t.target_collection || 0) - achieved.collection),
        new_customers: Math.max(0, (t.target_new_customers || 0) - achieved.new_customers),
        total_visits: Math.max(0, (t.target_total_visits || 0) - achieved.total_visits),
        successful_visits: Math.max(0, (t.target_successful_visits || 0) - achieved.successful_visits),
        new_products_skus: Math.max(0, (t.target_new_products_skus || 0) - achieved.new_products_skus),
        new_products_qty: Math.max(0, (t.target_new_products_qty || 0) - achieved.new_products_qty),
      };
      const dailyRequired = {
        sales: remainingDays > 0 ? remaining.sales / remainingDays : remaining.sales,
        collection: remainingDays > 0 ? remaining.collection / remainingDays : remaining.collection,
        new_customers: remainingDays > 0 ? remaining.new_customers / remainingDays : remaining.new_customers,
        total_visits: remainingDays > 0 ? remaining.total_visits / remainingDays : remaining.total_visits,
        successful_visits: remainingDays > 0 ? remaining.successful_visits / remainingDays : remaining.successful_visits,
        new_products_skus: remainingDays > 0 ? remaining.new_products_skus / remainingDays : remaining.new_products_skus,
        new_products_qty: remainingDays > 0 ? remaining.new_products_qty / remainingDays : remaining.new_products_qty,
      };
      return {
        ...rep, target: t, achieved, remaining, dailyRequired,
        overdue_remaining: Math.max(0, (t.overdue_total || 0) - achieved.overdue_collected),
        monthProgress: monthProg, remainingDays,
        salesStatus: getAchievementStatus(achieved.sales, t.target_sales || 0, monthProg),
      };
    });
    setData(combined);
    setLoading(false);
  };

  const years = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1];
  const filtered = data.filter(d => {
    if (filterSup && d.supervisors?.id !== filterSup) return false;
    if (filterRegion && d.regions?.id !== filterRegion) return false;
    return true;
  });

  // KPI Totals
  const kpi = {
    sales: filtered.reduce((a, d) => a + d.achieved.sales, 0),
    targetSales: filtered.reduce((a, d) => a + (d.target.target_sales || 0), 0),
    collection: filtered.reduce((a, d) => a + d.achieved.collection, 0),
    targetCollection: filtered.reduce((a, d) => a + (d.target.target_collection || 0), 0),
    newProductsSkus: filtered.reduce((a, d) => a + d.achieved.new_products_skus, 0),
    targetNewProductsSkus: filtered.reduce((a, d) => a + (d.target.target_new_products_skus || 0), 0),
    newProductsQty: filtered.reduce((a, d) => a + d.achieved.new_products_qty, 0),
    targetNewProductsQty: filtered.reduce((a, d) => a + (d.target.target_new_products_qty || 0), 0),
    newCustomers: filtered.reduce((a, d) => a + d.achieved.new_customers, 0),
    targetNewCustomers: filtered.reduce((a, d) => a + (d.target.target_new_customers || 0), 0),
    newCustomersValue: filtered.reduce((a, d) => a + d.achieved.new_customers_value, 0),
    totalVisits: filtered.reduce((a, d) => a + d.achieved.total_visits, 0),
    targetVisits: filtered.reduce((a, d) => a + (d.target.target_total_visits || 0), 0),
    successfulVisits: filtered.reduce((a, d) => a + d.achieved.successful_visits, 0),
    targetSuccessfulVisits: filtered.reduce((a, d) => a + (d.target.target_successful_visits || 0), 0),
    km: filtered.reduce((a, d) => a + d.achieved.km, 0),
    expenses: filtered.reduce((a, d) => a + d.achieved.expenses, 0),
    overdueCollected: filtered.reduce((a, d) => a + d.achieved.overdue_collected, 0),
    overdueTotal: filtered.reduce((a, d) => a + (d.target.overdue_total || 0), 0),
  };

  const monthProg = getMonthProgress(year, month);
  const remainingDays = getRemainingWorkingDays(year, month);
  const totalDays = getTotalWorkingDaysInMonth(year, month);

  // إجماليات المشرفين
  const supervisorStats = supervisors.map(sup => {
    const supReps = data.filter(d => d.supervisors?.id === sup.id);
    const totalTargetSales = supReps.reduce((a, d) => a + (d.target.target_sales || 0), 0);
    const totalTargetCollection = supReps.reduce((a, d) => a + (d.target.target_collection || 0), 0);
    const totalSales = supReps.reduce((a, d) => a + d.achieved.sales, 0);
    const totalCollection = supReps.reduce((a, d) => a + d.achieved.collection, 0);
    const totalVisits = supReps.reduce((a, d) => a + d.achieved.total_visits, 0);
    const totalNewCustomers = supReps.reduce((a, d) => a + d.achieved.new_customers, 0);
    const totalExpenses = supReps.reduce((a, d) => a + d.achieved.expenses, 0);
    const salesPct = totalTargetSales > 0 ? Math.round((totalSales / totalTargetSales) * 100) : 0;
    const colPct = totalTargetCollection > 0 ? Math.round((totalCollection / totalTargetCollection) * 100) : 0;
    const status = getAchievementStatus(totalSales, totalTargetSales, monthProg);
    return {
      ...sup, supReps: supReps.length,
      totalTargetSales, totalTargetCollection,
      totalSales, totalCollection, totalVisits,
      totalNewCustomers, totalExpenses,
      salesPct, colPct, status,
      regions: [...new Set(supReps.map(d => d.regions?.name).filter(Boolean))].join('، '),
    };
  });

  const metrics = [
    { key: 'sales', label: 'المبيعات' },
    { key: 'collection', label: 'التحصيل' },
    { key: 'visits', label: 'الزيارات' },
    { key: 'products', label: 'المنتجات' },
    { key: 'overdue', label: 'المتأخرات' },
  ];

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">📊 لوحة المتابعة</h1>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <select className="form-select" style={{ width: 'auto' }} value={filterSup} onChange={e => { setFilterSup(e.target.value); setActiveView('reps'); }}>
            <option value="">كل المشرفين</option>
            {supervisors.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select className="form-select" style={{ width: 'auto' }} value={filterRegion} onChange={e => setFilterRegion(e.target.value)}>
            <option value="">كل المناطق</option>
            {regions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <div className="month-selector">
            <select value={month} onChange={e => setMonth(+e.target.value)}>
              {MONTHS_AR.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
            <select value={year} onChange={e => setYear(+e.target.value)}>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* شريط تقدم الشهر */}
      <div className="card" style={{ marginBottom: '1rem', padding: '1rem 1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
          <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>📅 تقدم الشهر — {MONTHS_AR[month-1]} {year}</span>
          <span style={{ color: '#8b5cf6', fontWeight: 700 }}>{Math.round(monthProg)}% — متبقي {remainingDays} يوم من {totalDays}</span>
        </div>
        <div className="progress-bar" style={{ height: 10 }}>
          <div className="progress-fill" style={{ width: `${monthProg}%`, background: '#8b5cf6' }} />
        </div>
      </div>

      {/* KPI Cards - الأولوية الأولى: المبيعات والتحصيل */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
        <KPICard icon="🎯" title="المبيعات" achieved={kpi.sales} target={kpi.targetSales} color="#3b82f6" />
        <KPICard icon="💰" title="التحصيل" achieved={kpi.collection} target={kpi.targetCollection} color="#10b981" />
      </div>

      {/* KPI Cards - الأولوية الثانية: الأصناف الجديدة */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
        <KPICard icon="📦" title="الأصناف الجديدة" achieved={kpi.newProductsSkus} target={kpi.targetNewProductsSkus} color="#f59e0b" unit=" صنف" />
        <KPICard icon="📦" title="قطع المنتجات الجديدة" achieved={kpi.newProductsQty} target={kpi.targetNewProductsQty} color="#f59e0b" unit=" قطعة" />
      </div>

      {/* KPI Cards - الأولوية الثالثة: العملاء الجدد */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
        <KPICard icon="👥" title="العملاء الجدد" achieved={kpi.newCustomers} target={kpi.targetNewCustomers} color="#8b5cf6" unit=" عميل" />
        <KPICard icon="🧾" title="قيمة فواتير العملاء الجدد" achieved={kpi.newCustomersValue} target={0} color="#8b5cf6" />
      </div>

      {/* KPI Cards - الأولوية الرابعة: الزيارات */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
        <KPICard icon="📍" title="الزيارات الإجمالي" achieved={kpi.totalVisits} target={kpi.targetVisits} color="#06b6d4" unit=" زيارة" />
        <KPICard icon="✅" title="الزيارات الناجحة" achieved={kpi.successfulVisits} target={kpi.targetSuccessfulVisits} color="#06b6d4" unit=" زيارة" />
      </div>

      {/* KPI Cards - الأولوية الخامسة: الكيلومترات والمصروفات والمتأخرات */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <KPICard icon="🚗" title="الكيلومترات" achieved={kpi.km} target={0} color="#64748b" unit=" كم" />
        <KPICard icon="💸" title="المصروفات" achieved={kpi.expenses} target={0} color="#64748b" />
        <KPICard icon="⚠️" title="المحصل من المتأخرات" achieved={kpi.overdueCollected} target={kpi.overdueTotal} color="#ef4444" />
      </div>

      {/* تبويب العرض */}
      <div className="tabs">
        <button className={`tab ${activeView === 'supervisors' ? 'active' : ''}`} onClick={() => setActiveView('supervisors')}>👔 المشرفون</button>
        <button className={`tab ${activeView === 'reps' ? 'active' : ''}`} onClick={() => setActiveView('reps')}>👤 المندوبون</button>
      </div>

      {/* عرض المشرفين */}
      {activeView === 'supervisors' && (
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>المشرف</th><th>المناطق</th><th>المندوبين</th>
                <th>هدف المبيعات</th><th>المبيعات</th><th>%</th>
                <th>هدف التحصيل</th><th>التحصيل</th><th>%</th>
                <th>الزيارات</th><th>عملاء جدد</th><th>مصروفات</th><th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {supervisorStats.map(sup => (
                <tr key={sup.id}>
                  <td><strong>{sup.name}</strong></td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{sup.regions}</td>
                  <td style={{ textAlign: 'center' }}>{sup.supReps}</td>
                  <td>{formatCurrency(sup.totalTargetSales)}</td>
                  <td style={{ color: '#10b981', fontWeight: 700 }}>{formatCurrency(sup.totalSales)}</td>
                  <td>
                    <div style={{ minWidth: 70 }}>
                      <div style={{ fontSize: '0.8rem', fontWeight: 700, color: getStatusColor(sup.status) }}>{sup.salesPct}%</div>
                      <div className="progress-bar"><div className="progress-fill" style={{ width: `${Math.min(100, sup.salesPct)}%`, background: getStatusColor(sup.status) }} /></div>
                    </div>
                  </td>
                  <td>{formatCurrency(sup.totalTargetCollection)}</td>
                  <td style={{ color: '#10b981', fontWeight: 700 }}>{formatCurrency(sup.totalCollection)}</td>
                  <td>
                    <div style={{ fontSize: '0.8rem', fontWeight: 700 }}>{sup.colPct}%</div>
                    <div className="progress-bar"><div className="progress-fill" style={{ width: `${Math.min(100, sup.colPct)}%`, background: '#10b981' }} /></div>
                  </td>
                  <td>{formatNumber(sup.totalVisits)}</td>
                  <td>{formatNumber(sup.totalNewCustomers)}</td>
                  <td>{formatCurrency(sup.totalExpenses)}</td>
                  <td><span className="badge" style={{ background: sup.status === 'ahead' ? '#064e3b' : sup.status === 'on-track' ? '#451a03' : '#450a0a', color: getStatusColor(sup.status) }}>{getStatusLabel(sup.status)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* عرض المندوبين */}
      {activeView === 'reps' && (
        <>
          <div className="tabs">
            {metrics.map(m => (
              <button key={m.key} className={`tab ${activeMetric === m.key ? 'active' : ''}`}
                onClick={() => setActiveMetric(m.key)}>{m.label}</button>
            ))}
          </div>
          {loading ? (
            <div className="loading"><div className="spinner" />جاري التحميل...</div>
          ) : filtered.length === 0 ? (
            <div className="empty-state"><div className="empty-state-icon">📊</div><div className="empty-state-text">لا توجد بيانات</div></div>
          ) : (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>المندوب</th><th>المشرف</th><th>المنطقة</th>
                    {activeMetric === 'sales' && <><th>هدف البيع</th><th>المنجز</th><th>المتبقي</th><th>يومي مطلوب</th><th>%</th><th>الحالة</th></>}
                    {activeMetric === 'collection' && <><th>هدف التحصيل</th><th>المحصل</th><th>المتبقي</th><th>يومي مطلوب</th><th>%</th></>}
                    {activeMetric === 'visits' && <><th>هدف الزيارات</th><th>إجمالي</th><th>ناجحة</th><th>صور الرف</th><th>متبقي</th><th>يومي مطلوب</th></>}
                    {activeMetric === 'products' && <><th>هدف الأصناف</th><th>أصناف منجزة</th><th>هدف القطع</th><th>قطع منجزة</th><th>نسبة التوفر</th></>}
                    {activeMetric === 'overdue' && <><th>إجمالي المتأخرات</th><th>المحصل</th><th>المتبقي</th><th>مصروفات الشهر</th><th>الكم</th></>}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(d => {
                    const salesPct = d.target.target_sales > 0 ? Math.round((d.achieved.sales / d.target.target_sales) * 100) : 0;
                    const colPct = d.target.target_collection > 0 ? Math.round((d.achieved.collection / d.target.target_collection) * 100) : 0;
                    const status = d.salesStatus;
                    return (
                      <tr key={d.id}>
                        <td><strong>{d.name}</strong></td>
                        <td style={{ color: 'var(--text-secondary)' }}>{d.supervisors?.name || '-'}</td>
                        <td style={{ color: 'var(--text-secondary)' }}>{d.regions?.name || '-'}</td>
                        {activeMetric === 'sales' && <>
                          <td>{formatCurrency(d.target.target_sales)}</td>
                          <td style={{ color: '#10b981', fontWeight: 700 }}>{formatCurrency(d.achieved.sales)}</td>
                          <td style={{ color: '#ef4444' }}>{formatCurrency(d.remaining.sales)}</td>
                          <td style={{ color: '#f59e0b' }}>{formatCurrency(d.dailyRequired.sales)}</td>
                          <td>
                            <div style={{ minWidth: 80 }}>
                              <div style={{ fontSize: '0.8rem', fontWeight: 700, color: getStatusColor(status) }}>{salesPct}%</div>
                              <div className="progress-bar"><div className="progress-fill" style={{ width: `${Math.min(100, salesPct)}%`, background: getStatusColor(status) }} /></div>
                            </div>
                          </td>
                          <td><span className="badge" style={{ background: status === 'ahead' ? '#064e3b' : status === 'on-track' ? '#451a03' : '#450a0a', color: getStatusColor(status) }}>{getStatusLabel(status)}</span></td>
                        </>}
                        {activeMetric === 'collection' && <>
                          <td>{formatCurrency(d.target.target_collection)}</td>
                          <td style={{ color: '#10b981', fontWeight: 700 }}>{formatCurrency(d.achieved.collection)}</td>
                          <td style={{ color: '#ef4444' }}>{formatCurrency(d.remaining.collection)}</td>
                          <td style={{ color: '#f59e0b' }}>{formatCurrency(d.dailyRequired.collection)}</td>
                          <td><div style={{ fontSize: '0.8rem', fontWeight: 700 }}>{colPct}%</div><div className="progress-bar"><div className="progress-fill" style={{ width: `${Math.min(100, colPct)}%`, background: '#10b981' }} /></div></td>
                        </>}
                        {activeMetric === 'visits' && <>
                          <td>{formatNumber(d.target.target_total_visits)}</td>
                          <td style={{ color: '#60a5fa', fontWeight: 700 }}>{formatNumber(d.achieved.total_visits)}</td>
                          <td style={{ color: '#10b981' }}>{formatNumber(d.achieved.successful_visits)}</td>
                          <td style={{ color: '#a78bfa' }}>{formatNumber(d.achieved.total_visits)}</td>
                          <td style={{ color: '#ef4444' }}>{formatNumber(d.remaining.total_visits)}</td>
                          <td style={{ color: '#f59e0b' }}>{formatNumber(d.dailyRequired.total_visits).split('.')[0]}</td>
                        </>}
                        {activeMetric === 'products' && <>
                          <td>{formatNumber(d.target.target_new_products_skus)}</td>
                          <td style={{ color: '#10b981', fontWeight: 700 }}>{formatNumber(d.achieved.new_products_skus)}</td>
                          <td>{formatNumber(d.target.target_new_products_qty)}</td>
                          <td style={{ color: '#10b981', fontWeight: 700 }}>{formatNumber(d.achieved.new_products_qty)}</td>
                          <td style={{ color: '#f59e0b', fontWeight: 700 }}>{Math.round(d.achieved.new_products_availability)}%</td>
                        </>}
                        {activeMetric === 'overdue' && <>
                          <td style={{ color: '#ef4444' }}>{formatCurrency(d.target.overdue_total)}</td>
                          <td style={{ color: '#10b981', fontWeight: 700 }}>{formatCurrency(d.achieved.overdue_collected)}</td>
                          <td style={{ color: '#ef4444', fontWeight: 700 }}>{formatCurrency(d.overdue_remaining)}</td>
                          <td>{formatCurrency(d.achieved.expenses)}</td>
                          <td>{formatNumber(d.achieved.km)} كم</td>
                        </>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
