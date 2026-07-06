import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import {
  MONTHS_AR,
  formatCurrency,
  formatNumber,
  getRemainingWorkingDays,
  getTotalWorkingDaysInMonth,
  getMonthProgress,
} from '../lib/helpers';
import { buildEffectiveTargetsMap } from '../lib/targets';

const metricConfig = [
  { key: 'sales', title: 'المبيعات', icon: '🎯', targetKey: 'target_sales', color: '#3b82f6', currency: true },
  { key: 'collection', title: 'التحصيل', icon: '💰', targetKey: 'target_collection', color: '#10b981', currency: true },
  { key: 'total_visits', title: 'الزيارات', icon: '📍', targetKey: 'target_total_visits', color: '#06b6d4' },
  { key: 'successful_visits', title: 'الزيارات الناجحة', icon: '✅', targetKey: 'target_successful_visits', color: '#14b8a6' },
  { key: 'new_customers', title: 'عملاء جدد', icon: '👥', targetKey: 'target_new_customers', color: '#8b5cf6' },
  { key: 'new_products_skus', title: 'أصناف جديدة', icon: '📦', targetKey: 'target_new_products_skus', color: '#f59e0b' },
];

const sumBy = (rows, field) => rows.reduce((total, row) => total + (parseFloat(row[field]) || 0), 0);

const formatMetric = (value, currency) => currency ? formatCurrency(value) : formatNumber(value);

function getMetricState(percent, monthProgress) {
  if (percent >= monthProgress + 5) return { label: 'متقدم', color: '#10b981', bg: '#052e25' };
  if (percent >= monthProgress - 5) return { label: 'في المسار', color: '#f59e0b', bg: '#3f2a05' };
  return { label: 'يحتاج تركيز', color: '#ef4444', bg: '#3b0909' };
}

function PerformanceCard({ metric, achieved, target, remainingDays, monthProgress }) {
  const percent = target > 0 ? Math.round((achieved / target) * 100) : 0;
  const remaining = target > 0 ? Math.max(0, target - achieved) : 0;
  const dailyRequired = target > 0 && remainingDays > 0 ? remaining / remainingDays : remaining;
  const state = target > 0 ? getMetricState(percent, monthProgress) : { label: 'بدون هدف', color: '#94a3b8', bg: '#172033' };

  return (
    <div className="rep-card" style={{ borderTopColor: metric.color }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start' }}>
        <div>
          <div className="rep-card-label">{metric.icon} {metric.title}</div>
          <div className="rep-card-value" style={{ color: metric.color }}>{formatMetric(achieved, metric.currency)}</div>
        </div>
        <span className="badge" style={{ color: state.color, background: state.bg }}>{state.label}</span>
      </div>
      <div className="progress-bar" style={{ height: 9, marginTop: '1rem' }}>
        <div className="progress-fill" style={{ width: `${Math.min(100, percent)}%`, background: metric.color }} />
      </div>
      <div className="rep-card-grid">
        <span>الهدف<br /><strong>{target > 0 ? formatMetric(target, metric.currency) : '-'}</strong></span>
        <span>المتبقي<br /><strong>{target > 0 ? formatMetric(remaining, metric.currency) : '-'}</strong></span>
        <span>يوميًا<br /><strong>{target > 0 ? formatMetric(dailyRequired, metric.currency) : '-'}</strong></span>
        <span>النسبة<br /><strong>{target > 0 ? `${percent}%` : '-'}</strong></span>
      </div>
    </div>
  );
}

function FocusItem({ title, value, tone = '#3b82f6' }) {
  return (
    <div style={{ borderRight: `3px solid ${tone}`, padding: '0.75rem 1rem', background: '#111827', borderRadius: 8 }}>
      <div style={{ color: 'var(--text-secondary)', fontSize: '0.78rem', marginBottom: 4 }}>{title}</div>
      <div style={{ color: 'var(--text-primary)', fontWeight: 800 }}>{value}</div>
    </div>
  );
}

export default function RepDashboard({ repId }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [entries, setEntries] = useState([]);
  const [target, setTarget] = useState(null);
  const [rep, setRep] = useState(null);
  const [topCustomers, setTopCustomers] = useState([]);
  const [riskCustomers, setRiskCustomers] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => { if (repId) fetchRep(); }, [repId]);
  useEffect(() => { if (repId) fetchDetails(); }, [repId, year, month]);

  const fetchRep = async () => {
    const { data } = await supabase.from('representatives')
      .select('*, supervisors(name), regions(id,name)')
      .eq('id', repId)
      .single();
    if (data) {
      setRep(data);
      fetchRegionInsights(data);
    }
  };

  const fetchDetails = async () => {
    setLoading(true);
    const [entriesResult, targetsResult] = await Promise.all([
      supabase.from('daily_entries').select('*')
        .eq('rep_id', repId).eq('year', year).eq('month', month).order('entry_date'),
      supabase.from('monthly_targets').select('*')
        .eq('rep_id', repId).limit(10000),
    ]);
    if (entriesResult.data) setEntries(entriesResult.data);
    const targetMap = buildEffectiveTargetsMap(targetsResult.data || [], year, month);
    setTarget(targetMap[repId] || null);
    setLoading(false);
  };

  const fetchRegionInsights = async (repData) => {
    if (!repData?.region_id) return;

    const { data: customers } = await supabase
      .from('customers')
      .select('id, customer_code, customer_name')
      .eq('region_id', repData.region_id)
      .limit(500);

    const customerIds = (customers || []).map(c => c.id);
    if (customerIds.length) {
      const { data: salesRows } = await supabase
        .from('customer_product_sales')
        .select('customer_id, amount, quantity, product_id')
        .in('customer_id', customerIds)
        .limit(5000);

      const totals = {};
      (salesRows || []).forEach(row => {
        if (!totals[row.customer_id]) totals[row.customer_id] = { amount: 0, quantity: 0, products: new Set() };
        totals[row.customer_id].amount += Number(row.amount) || 0;
        totals[row.customer_id].quantity += Number(row.quantity) || 0;
        if (row.product_id) totals[row.customer_id].products.add(row.product_id);
      });

      setTopCustomers((customers || [])
        .map(customer => ({
          ...customer,
          amount: totals[customer.id]?.amount || 0,
          quantity: totals[customer.id]?.quantity || 0,
          skuCount: totals[customer.id]?.products.size || 0,
        }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 6));
    }

    if (repData.regions?.name) {
      const { data: riskRows } = await supabase
        .from('customer_yearly_sales')
        .select('customer_code, customer_name, net_sales, collected, aging_61_90, aging_91_120, aging_120_plus, debt_age, year')
        .eq('region_name', repData.regions.name)
        .order('year', { ascending: false })
        .limit(500);

      setRiskCustomers((riskRows || [])
        .map(row => ({
          ...row,
          riskAmount: (Number(row.aging_61_90) || 0) + (Number(row.aging_91_120) || 0) + (Number(row.aging_120_plus) || 0),
        }))
        .filter(row => row.riskAmount > 0)
        .sort((a, b) => b.riskAmount - a.riskAmount)
        .slice(0, 5));
    }
  };

  const years = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1];
  const remainingDays = getRemainingWorkingDays(year, month);
  const totalDays = getTotalWorkingDaysInMonth(year, month);
  const monthProgress = Math.round(getMonthProgress(year, month));

  const totals = useMemo(() => ({
    sales: sumBy(entries, 'daily_sales'),
    collection: sumBy(entries, 'daily_collection'),
    new_customers: sumBy(entries, 'new_customers'),
    new_customers_value: sumBy(entries, 'new_customers_value'),
    total_visits: sumBy(entries, 'total_visits'),
    successful_visits: sumBy(entries, 'successful_visits'),
    shelf_photos: sumBy(entries, 'shelf_photos'),
    new_products_skus: sumBy(entries, 'new_products_skus'),
    new_products_qty: sumBy(entries, 'new_products_qty'),
    working_hours: sumBy(entries, 'working_hours'),
    km: sumBy(entries, 'km'),
    expenses: sumBy(entries, 'daily_expenses'),
    overdue_collected: sumBy(entries, 'overdue_collected'),
  }), [entries]);

  const salesTarget = target?.target_sales || 0;
  const collectionTarget = target?.target_collection || 0;
  const visitSuccessRate = totals.total_visits > 0 ? Math.round((totals.successful_visits / totals.total_visits) * 100) : 0;
  const shelfCoverage = totals.total_visits > 0 ? Math.round((totals.shelf_photos / totals.total_visits) * 100) : 0;
  const salesRemaining = Math.max(0, salesTarget - totals.sales);
  const collectionRemaining = Math.max(0, collectionTarget - totals.collection);

  const nextActions = [
    { title: 'مبيعات مطلوبة يوميًا', value: salesTarget > 0 ? formatCurrency(remainingDays > 0 ? salesRemaining / remainingDays : salesRemaining) : '-', tone: '#3b82f6' },
    { title: 'تحصيل مطلوب يوميًا', value: collectionTarget > 0 ? formatCurrency(remainingDays > 0 ? collectionRemaining / remainingDays : collectionRemaining) : '-', tone: '#10b981' },
    { title: 'نسبة نجاح الزيارات', value: `${visitSuccessRate}%`, tone: '#06b6d4' },
    { title: 'تغطية صور الرف', value: `${shelfCoverage}%`, tone: '#f59e0b' },
  ];

  return (
    <div className="rep-dashboard">
      <div className="rep-hero">
        <div>
          <div className="rep-eyebrow">لوحة تشغيل المندوب</div>
          <h1>{rep?.name || 'تقريري'}</h1>
          <div className="rep-meta">
            <span>المنطقة: <strong>{rep?.regions?.name || '-'}</strong></span>
            <span>المشرف: <strong>{rep?.supervisors?.name || 'بدون مشرف'}</strong></span>
            <span>الشهر: <strong>{MONTHS_AR[month - 1]} {year}</strong></span>
          </div>
        </div>
        <div className="month-selector">
          <select value={month} onChange={e => setMonth(+e.target.value)}>
            {MONTHS_AR.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <select value={year} onChange={e => setYear(+e.target.value)}>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      <div className="rep-month-band">
        <div>
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>تقدم الشهر</div>
          <strong>{monthProgress}%</strong>
        </div>
        <div className="progress-bar" style={{ height: 10, flex: 1, margin: 0 }}>
          <div className="progress-fill" style={{ width: `${monthProgress}%`, background: '#8b5cf6' }} />
        </div>
        <div style={{ textAlign: 'left' }}>
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>المتبقي</div>
          <strong>{remainingDays} من {totalDays} يوم</strong>
        </div>
      </div>

      {loading ? (
        <div className="loading"><div className="spinner" />جاري التحميل...</div>
      ) : (
        <>
          <div className="rep-grid">
            {metricConfig.map(metric => (
              <PerformanceCard
                key={metric.key}
                metric={metric}
                achieved={totals[metric.key] || 0}
                target={target?.[metric.targetKey] || 0}
                remainingDays={remainingDays}
                monthProgress={monthProgress}
              />
            ))}
          </div>

          <div className="rep-two-col">
            <section className="rep-panel">
              <div className="card-title">خطة اليوم</div>
              <div className="rep-focus-list">
                {nextActions.map(item => <FocusItem key={item.title} {...item} />)}
              </div>
            </section>

            <section className="rep-panel">
              <div className="card-title">الخطة الاستراتيجية للمنطقة</div>
              <div className="strategy-box">
                <div><strong>تركيز البيع:</strong> رفع تغطية العملاء الأعلى قيمة ومتابعة الأصناف الجديدة.</div>
                <div><strong>تركيز التحصيل:</strong> البدء بالعملاء ذوي المديونية الأقدم والأعلى قيمة.</div>
                <div><strong>إيقاع الزيارات:</strong> الحفاظ على زيارة يومية منتظمة مع توثيق صور الرف.</div>
              </div>
            </section>
          </div>

          <div className="rep-two-col">
            <section className="rep-panel">
              <div className="card-title">كبار عملاء المنطقة</div>
              {topCustomers.length === 0 ? (
                <div className="empty-state" style={{ padding: '2rem' }}>لا توجد بيانات عملاء كافية</div>
              ) : (
                <div className="rep-list">
                  {topCustomers.map((customer, index) => (
                    <div className="rep-list-row" key={customer.id}>
                      <span className="rep-rank">{index + 1}</span>
                      <div>
                        <strong>{customer.customer_name}</strong>
                        <small>{customer.customer_code} · {formatNumber(customer.skuCount)} صنف</small>
                      </div>
                      <b>{formatCurrency(customer.amount)}</b>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="rep-panel">
              <div className="card-title">مخاطر التحصيل</div>
              {riskCustomers.length === 0 ? (
                <div className="empty-state" style={{ padding: '2rem' }}>لا توجد مخاطر تحصيل مسجلة للمنطقة</div>
              ) : (
                <div className="rep-list">
                  {riskCustomers.map(customer => (
                    <div className="rep-list-row" key={`${customer.customer_code}-${customer.year}`}>
                      <span className="badge badge-danger">{customer.debt_age || 'متأخر'}</span>
                      <div>
                        <strong>{customer.customer_name}</strong>
                        <small>{customer.customer_code} · سنة {customer.year}</small>
                      </div>
                      <b style={{ color: '#ef4444' }}>{formatCurrency(customer.riskAmount)}</b>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          <section className="rep-panel">
            <div className="card-title">السجل اليومي ({entries.length} يوم)</div>
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
                    {entries.map(entry => (
                      <tr key={entry.id}>
                        <td>{new Date(entry.entry_date).toLocaleDateString('ar-SA-u-ca-gregory')}</td>
                        <td style={{ color: '#10b981' }}>{formatCurrency(entry.daily_sales)}</td>
                        <td style={{ color: '#10b981' }}>{formatCurrency(entry.daily_collection)}</td>
                        <td>{entry.new_customers}</td>
                        <td>{entry.total_visits}</td>
                        <td>{entry.successful_visits}</td>
                        <td>{entry.shelf_photos || 0}</td>
                        <td>{entry.new_products_skus}</td>
                        <td>{entry.new_products_qty}</td>
                        <td>{entry.working_hours}</td>
                        <td>{entry.km}</td>
                        <td>{formatCurrency(entry.daily_expenses)}</td>
                      </tr>
                    ))}
                    <tr style={{ background: '#0f172a', fontWeight: 700 }}>
                      <td>الإجمالي</td>
                      <td style={{ color: '#10b981' }}>{formatCurrency(totals.sales)}</td>
                      <td style={{ color: '#10b981' }}>{formatCurrency(totals.collection)}</td>
                      <td>{formatNumber(totals.new_customers)}</td>
                      <td>{formatNumber(totals.total_visits)}</td>
                      <td>{formatNumber(totals.successful_visits)}</td>
                      <td>{formatNumber(totals.shelf_photos)}</td>
                      <td>{formatNumber(totals.new_products_skus)}</td>
                      <td>{formatNumber(totals.new_products_qty)}</td>
                      <td>{formatNumber(totals.working_hours)}</td>
                      <td>{formatNumber(totals.km)}</td>
                      <td style={{ color: '#f59e0b' }}>{formatCurrency(totals.expenses)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
