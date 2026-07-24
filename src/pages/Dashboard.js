import React, { useState, useEffect } from 'react';
import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { supabase } from '../lib/supabase';
import {
  MONTHS_AR, formatCurrency, formatNumber,
  getAchievementStatus, getStatusColor, getStatusLabel,
  getMonthProgress, getRemainingWorkingDays, getTotalWorkingDaysInMonth, getMonthPhase,
} from '../lib/helpers';
import { buildEffectiveTargetsMap } from '../lib/targets';
import { getDailyRequirement } from '../lib/repMetrics';

// Format a daily-required figure that may be null (finished month → not applicable).
const fmtDaily = (value, currency = true) =>
  value == null ? '-' : (currency ? formatCurrency(value) : formatNumber(value));

const NO_SUPERVISOR = '__none__';

const toDateString = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const getSixMonthWindow = (year, month) => {
  const start = new Date(year, month - 1, 1);
  start.setMonth(start.getMonth() - 5);
  const end = new Date(year, month, 0);
  const months = [];
  for (let i = 0; i < 6; i += 1) {
    const date = new Date(start.getFullYear(), start.getMonth() + i, 1);
    months.push({
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
      label: MONTHS_AR[date.getMonth()],
    });
  }
  return { months, startDate: toDateString(start), endDate: toDateString(end) };
};

function calcPoints(achieved, target) {
  const sales = target.target_sales > 0 ? Math.min(1, achieved.sales / target.target_sales) * 40 : 0;
  const collection = target.target_collection > 0 ? Math.min(1, achieved.collection / target.target_collection) * 30 : 0;
  const skus = target.target_new_products_skus > 0 ? Math.min(1, achieved.new_products_skus / target.target_new_products_skus) * 15 : 0;
  const customers = target.target_new_customers > 0 ? Math.min(1, achieved.new_customers / target.target_new_customers) * 10 : 0;
  const visits = target.target_total_visits > 0 ? Math.min(1, achieved.total_visits / target.target_total_visits) * 5 : 0;
  return Math.round(sales + collection + skus + customers + visits);
}

function KPICard({ icon, title, achieved, target, unit = '', color = '#3b82f6', monthProgress }) {
  const pct = target > 0 ? Math.min(100, Math.round((achieved / target) * 100)) : 0;
  const remaining = Math.max(0, target - achieved);
  // Use the SELECTED month's progress (passed in), not today's.
  const monthProg = monthProgress != null
    ? monthProgress
    : getMonthProgress(new Date().getFullYear(), new Date().getMonth() + 1);
  const status = getAchievementStatus(achieved, target, monthProg);
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

function CircleMetric({ label, value, target, color = '#3b82f6', currency = false }) {
  const pct = target > 0 ? Math.min(100, Math.round((value / target) * 100)) : 0;
  const formatter = currency ? formatCurrency : formatNumber;
  return (
    <div className="circle-metric-card">
      <div className="circle-meter" style={{ '--pct': `${pct}%`, '--meter-color': color }}>
        <span>{target > 0 ? `${pct}%` : '-'}</span>
      </div>
      <div>
        <strong>{label}</strong>
        <span>{formatter(value)}</span>
        <small>{target > 0 ? `الهدف ${formatter(target)}` : 'بدون هدف'}</small>
      </div>
    </div>
  );
}

function getMedal(rank) {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return `#${rank}`;
}

function getPointsColor(points) {
  if (points >= 80) return '#10b981';
  if (points >= 60) return '#f59e0b';
  if (points >= 40) return '#f97316';
  return '#ef4444';
}

export default function Dashboard({ supervisorId }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filterSup, setFilterSup] = useState(supervisorId || '');
  const [filterRegion, setFilterRegion] = useState('');
  const [supervisors, setSupervisors] = useState([]);
  const [regions, setRegions] = useState([]);
  const [regionHistory, setRegionHistory] = useState({ months: [], rows: [], chartRows: [] });
  const [activeMetric, setActiveMetric] = useState('sales');
  const [activeView, setActiveView] = useState('points');

  useEffect(() => { fetchMeta(); }, []);
  useEffect(() => { fetchData(); }, [year, month, filterSup]);

  const fetchMeta = async () => {
    const { data: s } = await supabase.from('supervisors').select('*').order('name');
    if (s) setSupervisors(s);
    if (!supervisorId) {
      const { data: r } = await supabase.from('regions').select('*').order('name');
      if (r) setRegions(r);
    }
  };

  const fetchData = async () => {
    setLoading(true);
    let query = supabase.from('representatives')
      .select('*, supervisors(name,id), regions(name,id)')
      .order('name');
    if (supervisorId) query = query.eq('supervisor_id', supervisorId);
    else if (filterSup === NO_SUPERVISOR) query = query.is('supervisor_id', null);
    else if (filterSup) query = query.eq('supervisor_id', filterSup);
    const { data: reps } = await query;
    if (!reps) { setLoading(false); return; }
    const { data: targets } = await supabase.from('monthly_targets')
      .select('*').limit(10000);
    const { data: entries } = await supabase.from('daily_entries')
      .select('*').eq('year', year).eq('month', month).limit(10000);
    const repIds = reps.map(rep => rep.id);
    const historyWindow = getSixMonthWindow(year, month);
    const { data: historyEntries } = repIds.length ? await supabase.from('daily_entries')
      .select('*')
      .in('rep_id', repIds)
      .gte('entry_date', historyWindow.startDate)
      .lte('entry_date', historyWindow.endDate)
      .limit(50000) : { data: [] };
    const targetsMap = buildEffectiveTargetsMap(targets || [], year, month);
    const entriesMap = {};
    (entries || []).forEach(e => {
      if (!entriesMap[e.rep_id]) entriesMap[e.rep_id] = [];
      entriesMap[e.rep_id].push(e);
    });
    const remainingDays = getRemainingWorkingDays(year, month);
    const totalDays = getTotalWorkingDaysInMonth(year, month);
    const monthPhase = getMonthPhase(year, month);
    const monthProg = getMonthProgress(year, month);
    const combined = reps.map(rep => {
      const t = targetsMap[rep.id] || {};
      const repEntries = entriesMap[rep.id] || [];
      const sum = (field) => repEntries.reduce((acc, e) => acc + (parseFloat(e[field]) || 0), 0);
      const achieved = {
        sales: sum('daily_sales'), collection: sum('daily_collection'),
        new_customers: sum('new_customers'), new_customers_value: sum('new_customers_value'),
        total_visits: sum('total_visits'), successful_visits: sum('successful_visits'),
        shelf_photos: sum('shelf_photos'),
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
      // Month-phase aware: null for a finished month (no daily rate applies),
      // spread over all working days for a future month.
      const dr = (rem) => getDailyRequirement(rem, remainingDays, monthPhase, totalDays);
      const dailyRequired = {
        sales: dr(remaining.sales),
        collection: dr(remaining.collection),
        new_customers: dr(remaining.new_customers),
        total_visits: dr(remaining.total_visits),
        successful_visits: dr(remaining.successful_visits),
        new_products_skus: dr(remaining.new_products_skus),
        new_products_qty: dr(remaining.new_products_qty),
      };
      const points = calcPoints(achieved, t);
      return {
        ...rep, target: t, achieved, remaining, dailyRequired, points,
        overdue_remaining: Math.max(0, (t.overdue_total || 0) - achieved.overdue_collected),
        monthProgress: monthProg, remainingDays,
        salesStatus: getAchievementStatus(achieved.sales, t.target_sales || 0, monthProg),
        hasMonthlyData: repEntries.length > 0 || Boolean(targetsMap[rep.id] && !targetsMap[rep.id]._isInherited),
      };
    }).filter(rep => rep.is_active || rep.hasMonthlyData);
    setData(combined);
    setRegionHistory(buildRegionHistory(historyWindow.months, reps, historyEntries || []));
    if (supervisorId || filterSup) {
      const supRegions = [...new Map(combined
        .filter(r => r.regions)
        .map(r => [r.regions.id, r.regions])
      ).values()];
      setRegions(supRegions);
    } else {
      const { data: r } = await supabase.from('regions').select('*').order('name');
      if (r) setRegions(r);
    }
    setLoading(false);
  };

  const buildRegionHistory = (months, reps, entries) => {
    const repMap = {};
    (reps || []).forEach(rep => {
      repMap[rep.id] = rep;
    });
    const regionMap = {};
    (reps || []).forEach(rep => {
      const regionName = rep.regions?.name || 'بدون منطقة';
      if (!regionMap[regionName]) {
        regionMap[regionName] = {
          region: regionName,
          sales: 0,
          collection: 0,
          visits: 0,
          successfulVisits: 0,
          reps: new Set(),
          months: months.map(period => ({ ...period, sales: 0, collection: 0 })),
        };
      }
      regionMap[regionName].reps.add(rep.id);
    });
    (entries || []).forEach(entry => {
      const rep = repMap[entry.rep_id];
      if (!rep) return;
      const regionName = rep.regions?.name || 'بدون منطقة';
      if (!regionMap[regionName]) return;
      const row = regionMap[regionName];
      const monthRow = row.months.find(period => period.year === entry.year && period.month === entry.month);
      const sales = parseFloat(entry.daily_sales) || 0;
      const collection = parseFloat(entry.daily_collection) || 0;
      row.sales += sales;
      row.collection += collection;
      row.visits += parseFloat(entry.total_visits) || 0;
      row.successfulVisits += parseFloat(entry.successful_visits) || 0;
      if (monthRow) {
        monthRow.sales += sales;
        monthRow.collection += collection;
      }
    });
    const rows = Object.values(regionMap)
      .map(row => ({ ...row, repsCount: row.reps.size }))
      .sort((a, b) => b.sales - a.sales);
    const chartRows = rows.slice(0, 12).map(row => ({
      region: row.region,
      sales: Math.round(row.sales),
      collection: Math.round(row.collection),
    }));
    return { months, rows, chartRows };
  };

  const years = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1];
  const filtered = data.filter(d => {
    if (filterRegion && d.regions?.id !== filterRegion) return false;
    return true;
  });

  const sortedByPoints = [...filtered].sort((a, b) => b.points - a.points);

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

  const supervisorRows = data.some(d => !d.supervisors?.id)
    ? [...supervisors, { id: NO_SUPERVISOR, name: 'بدون مشرف' }]
    : supervisors;

  const supervisorStats = supervisorRows.map(sup => {
    const supReps = sup.id === NO_SUPERVISOR
      ? data.filter(d => !d.supervisors?.id)
      : data.filter(d => d.supervisors?.id === sup.id);
    const totalTargetSales = supReps.reduce((a, d) => a + (d.target.target_sales || 0), 0);
    const totalTargetCollection = supReps.reduce((a, d) => a + (d.target.target_collection || 0), 0);
    const totalSales = supReps.reduce((a, d) => a + d.achieved.sales, 0);
    const totalCollection = supReps.reduce((a, d) => a + d.achieved.collection, 0);
    const totalVisits = supReps.reduce((a, d) => a + d.achieved.total_visits, 0);
    const totalNewCustomers = supReps.reduce((a, d) => a + d.achieved.new_customers, 0);
    const totalExpenses = supReps.reduce((a, d) => a + d.achieved.expenses, 0);
    const totalPoints = supReps.length > 0 ? Math.round(supReps.reduce((a, d) => a + d.points, 0) / supReps.length) : 0;
    const salesPct = totalTargetSales > 0 ? Math.round((totalSales / totalTargetSales) * 100) : 0;
    const colPct = totalTargetCollection > 0 ? Math.round((totalCollection / totalTargetCollection) * 100) : 0;
    const status = getAchievementStatus(totalSales, totalTargetSales, monthProg);
    return {
      ...sup, supReps: supReps.length,
      totalTargetSales, totalTargetCollection,
      totalSales, totalCollection, totalVisits,
      totalNewCustomers, totalExpenses, totalPoints,
      salesPct, colPct, status,
      regions: [...new Set(supReps.map(d => d.regions?.name).filter(Boolean))].join('، '),
    };
  }).sort((a, b) => b.totalPoints - a.totalPoints);

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
          {!supervisorId && (
            <select className="form-select" style={{ width: 'auto' }} value={filterSup}
              onChange={e => { setFilterSup(e.target.value); setFilterRegion(''); }}>
              <option value="">كل المشرفين</option>
              <option value={NO_SUPERVISOR}>بدون مشرف</option>
              {supervisors.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
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

      <div className="card" style={{ marginBottom: '1rem', padding: '1rem 1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
          <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>📅 تقدم الشهر — {MONTHS_AR[month-1]} {year}</span>
          <span style={{ color: '#8b5cf6', fontWeight: 700 }}>{Math.round(monthProg)}% — متبقي {remainingDays} يوم من {totalDays}</span>
        </div>
        <div className="progress-bar" style={{ height: 10 }}>
          <div className="progress-fill" style={{ width: `${monthProg}%`, background: '#8b5cf6' }} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
        <KPICard monthProgress={monthProg} icon="🎯" title="المبيعات" achieved={kpi.sales} target={kpi.targetSales} color="#3b82f6" />
        <KPICard monthProgress={monthProg} icon="💰" title="التحصيل" achieved={kpi.collection} target={kpi.targetCollection} color="#10b981" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
        <KPICard monthProgress={monthProg} icon="📦" title="الأصناف الجديدة" achieved={kpi.newProductsSkus} target={kpi.targetNewProductsSkus} color="#f59e0b" unit=" صنف" />
        <KPICard monthProgress={monthProg} icon="📦" title="قطع المنتجات الجديدة" achieved={kpi.newProductsQty} target={kpi.targetNewProductsQty} color="#f59e0b" unit=" قطعة" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
        <KPICard monthProgress={monthProg} icon="👥" title="العملاء الجدد" achieved={kpi.newCustomers} target={kpi.targetNewCustomers} color="#8b5cf6" unit=" عميل" />
        <KPICard monthProgress={monthProg} icon="🧾" title="قيمة فواتير العملاء الجدد" achieved={kpi.newCustomersValue} target={0} color="#8b5cf6" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
        <KPICard monthProgress={monthProg} icon="📍" title="الزيارات الإجمالي" achieved={kpi.totalVisits} target={kpi.targetVisits} color="#06b6d4" unit=" زيارة" />
        <KPICard monthProgress={monthProg} icon="✅" title="الزيارات الناجحة" achieved={kpi.successfulVisits} target={kpi.targetSuccessfulVisits} color="#06b6d4" unit=" زيارة" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <KPICard monthProgress={monthProg} icon="🚗" title="الكيلومترات" achieved={kpi.km} target={0} color="#64748b" unit=" كم" />
        <KPICard monthProgress={monthProg} icon="💸" title="المصروفات" achieved={kpi.expenses} target={0} color="#64748b" />
        <KPICard monthProgress={monthProg} icon="⚠️" title="المحصل من المتأخرات" achieved={kpi.overdueCollected} target={kpi.overdueTotal} color="#ef4444" />
      </div>

      <section className="dashboard-visual-panel">
        <div className="card-title">تقرير الشهر الحالي — مؤشرات دائرية</div>
        <div className="circle-metric-grid">
          <CircleMetric label="المبيعات" value={kpi.sales} target={kpi.targetSales} color="#3b82f6" currency />
          <CircleMetric label="التحصيل" value={kpi.collection} target={kpi.targetCollection} color="#10b981" currency />
          <CircleMetric label="الزيارات" value={kpi.totalVisits} target={kpi.targetVisits} color="#06b6d4" />
          <CircleMetric label="الزيارات الناجحة" value={kpi.successfulVisits} target={kpi.targetSuccessfulVisits} color="#14b8a6" />
          <CircleMetric label="العملاء الجدد" value={kpi.newCustomers} target={kpi.targetNewCustomers} color="#8b5cf6" />
          <CircleMetric label="الأصناف الجديدة" value={kpi.newProductsSkus} target={kpi.targetNewProductsSkus} color="#f59e0b" />
        </div>
      </section>

      <section className="dashboard-visual-panel">
        <div className="section-head">
          <div>
            <div className="card-title">المناطق — آخر 6 شهور</div>
            <div className="muted-text">بيع وتحصيل لكل المناطق حسب المناديب المرتبطين بها</div>
          </div>
          <span className="badge badge-info">{regionHistory.rows.length} منطقة</span>
        </div>
        <div className="region-history-layout">
          <div className="chart-box">
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={regionHistory.chartRows} margin={{ top: 12, right: 12, left: 0, bottom: 72 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#263244" />
                <XAxis dataKey="region" stroke="#94a3b8" angle={-35} textAnchor="end" interval={0} height={86} />
                <YAxis stroke="#94a3b8" tickFormatter={value => `${Math.round(value / 1000)}k`} />
                <Tooltip formatter={(value) => formatCurrency(value)} contentStyle={{ background: '#111827', border: '1px solid #334155', color: '#f8fafc' }} />
                <Legend />
                <Bar dataKey="sales" name="المبيعات" fill="#3b82f6" radius={[6, 6, 0, 0]} />
                <Bar dataKey="collection" name="التحصيل" fill="#10b981" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="region-history-list">
            {regionHistory.rows.slice(0, 8).map(region => {
              const collectionRate = region.sales > 0 ? Math.round((region.collection / region.sales) * 100) : 0;
              return (
                <div className="region-history-card" key={region.region}>
                  <div>
                    <strong>{region.region}</strong>
                    <span>{region.repsCount} مندوب · {formatNumber(region.visits)} زيارة</span>
                  </div>
                  <div>
                    <b>{formatCurrency(region.sales)}</b>
                    <small>تحصيل {formatCurrency(region.collection)} · {collectionRate}%</small>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <div className="tabs">
        <button className={`tab ${activeView === 'points' ? 'active' : ''}`} onClick={() => setActiveView('points')}>🏆 ترتيب النقاط</button>
        {!supervisorId && <button className={`tab ${activeView === 'supervisors' ? 'active' : ''}`} onClick={() => setActiveView('supervisors')}>👔 المشرفون</button>}
        <button className={`tab ${activeView === 'reps' ? 'active' : ''}`} onClick={() => setActiveView('reps')}>👤 المندوبون</button>
      </div>

      {activeView === 'points' && (
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>الترتيب</th><th>المندوب</th><th>المشرف</th><th>المنطقة</th><th>النقاط</th>
                <th>المبيعات %</th><th>التحصيل %</th><th>الأصناف %</th><th>العملاء %</th><th>الزيارات %</th>
              </tr>
            </thead>
            <tbody>
              {sortedByPoints.map((d, i) => {
                const salesPct = d.target.target_sales > 0 ? Math.round((d.achieved.sales / d.target.target_sales) * 100) : 0;
                const colPct = d.target.target_collection > 0 ? Math.round((d.achieved.collection / d.target.target_collection) * 100) : 0;
                const skusPct = d.target.target_new_products_skus > 0 ? Math.round((d.achieved.new_products_skus / d.target.target_new_products_skus) * 100) : 0;
                const custPct = d.target.target_new_customers > 0 ? Math.round((d.achieved.new_customers / d.target.target_new_customers) * 100) : 0;
                const visitsPct = d.target.target_total_visits > 0 ? Math.round((d.achieved.total_visits / d.target.target_total_visits) * 100) : 0;
                return (
                  <tr key={d.id} style={{ background: i === 0 ? '#1a2a1a' : i === 1 ? '#1a1a2a' : i === 2 ? '#2a1a0a' : '' }}>
                    <td style={{ fontSize: '1.25rem', textAlign: 'center' }}>{getMedal(i + 1)}</td>
                    <td><strong>{d.name}</strong></td>
                    <td style={{ color: 'var(--text-secondary)' }}>{d.supervisors?.name || 'بدون مشرف'}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>{d.regions?.name || '-'}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ fontSize: '1.25rem', fontWeight: 800, color: getPointsColor(d.points) }}>{d.points}</span>
                        <div style={{ flex: 1, minWidth: 60 }}>
                          <div className="progress-bar">
                            <div className="progress-fill" style={{ width: `${d.points}%`, background: getPointsColor(d.points) }} />
                          </div>
                        </div>
                      </div>
                    </td>
                    <td style={{ color: getPointsColor(salesPct) }}>{salesPct}%</td>
                    <td style={{ color: getPointsColor(colPct) }}>{colPct}%</td>
                    <td style={{ color: getPointsColor(skusPct) }}>{skusPct}%</td>
                    <td style={{ color: getPointsColor(custPct) }}>{custPct}%</td>
                    <td style={{ color: getPointsColor(visitsPct) }}>{visitsPct}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {activeView === 'supervisors' && !supervisorId && (
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>الترتيب</th><th>المشرف</th><th>المناطق</th><th>المندوبين</th>
                <th>متوسط النقاط</th><th>هدف المبيعات</th><th>المبيعات</th><th>%</th>
                <th>هدف التحصيل</th><th>التحصيل</th><th>%</th>
                <th>الزيارات</th><th>عملاء جدد</th><th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {supervisorStats.map((sup, i) => (
                <tr key={sup.id}>
                  <td style={{ fontSize: '1.1rem', textAlign: 'center' }}>{getMedal(i + 1)}</td>
                  <td><strong>{sup.name}</strong></td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{sup.regions}</td>
                  <td style={{ textAlign: 'center' }}>{sup.supReps}</td>
                  <td><span style={{ fontSize: '1.1rem', fontWeight: 800, color: getPointsColor(sup.totalPoints) }}>{sup.totalPoints}</span></td>
                  <td>{formatCurrency(sup.totalTargetSales)}</td>
                  <td style={{ color: '#10b981', fontWeight: 700 }}>{formatCurrency(sup.totalSales)}</td>
                  <td>
                    <div style={{ minWidth: 60 }}>
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
                  <td><span className="badge" style={{ background: sup.status === 'ahead' ? '#064e3b' : sup.status === 'on-track' ? '#451a03' : '#450a0a', color: getStatusColor(sup.status) }}>{getStatusLabel(sup.status)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
                    <th>المندوب</th><th>المشرف</th><th>المنطقة</th><th>النقاط</th>
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
                        <td style={{ color: 'var(--text-secondary)' }}>{d.supervisors?.name || 'بدون مشرف'}</td>
                        <td style={{ color: 'var(--text-secondary)' }}>{d.regions?.name || '-'}</td>
                        <td><span style={{ fontWeight: 800, color: getPointsColor(d.points) }}>{d.points}</span></td>
                        {activeMetric === 'sales' && <>
                          <td>{formatCurrency(d.target.target_sales)}</td>
                          <td style={{ color: '#10b981', fontWeight: 700 }}>{formatCurrency(d.achieved.sales)}</td>
                          <td style={{ color: '#ef4444' }}>{formatCurrency(d.remaining.sales)}</td>
                          <td style={{ color: '#f59e0b' }}>{fmtDaily(d.dailyRequired.sales)}</td>
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
                          <td style={{ color: '#f59e0b' }}>{fmtDaily(d.dailyRequired.collection)}</td>
                          <td><div style={{ fontSize: '0.8rem', fontWeight: 700 }}>{colPct}%</div><div className="progress-bar"><div className="progress-fill" style={{ width: `${Math.min(100, colPct)}%`, background: '#10b981' }} /></div></td>
                        </>}
                        {activeMetric === 'visits' && <>
                          <td>{formatNumber(d.target.target_total_visits)}</td>
                          <td style={{ color: '#60a5fa', fontWeight: 700 }}>{formatNumber(d.achieved.total_visits)}</td>
                          <td style={{ color: '#10b981' }}>{formatNumber(d.achieved.successful_visits)}</td>
                          <td style={{ color: '#a78bfa' }}>{formatNumber(d.achieved.shelf_photos)}</td>
                          <td style={{ color: '#ef4444' }}>{formatNumber(d.remaining.total_visits)}</td>
                          <td style={{ color: '#f59e0b' }}>{d.dailyRequired.total_visits == null ? '-' : formatNumber(d.dailyRequired.total_visits).split('.')[0]}</td>
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
