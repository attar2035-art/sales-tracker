import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import {
  MONTHS_AR,
  formatCurrency,
  formatNumber,
  getRemainingWorkingDays,
  getTotalWorkingDaysInMonth,
  getMonthProgress,
  getMonthPhase,
} from '../lib/helpers';
import { buildEffectiveTargetsMap } from '../lib/targets';
import {
  sumBy,
  getSixMonthWindow,
  calcPercent,
  clampPercent,
  getScoreLabel,
  getMetricState,
  getDailyRequirement,
  buildSmartGoals,
  buildHistoryRows,
} from '../lib/repMetrics';

const metricConfig = [
  { key: 'sales', title: 'المبيعات', icon: '🎯', targetKey: 'target_sales', color: '#3b82f6', currency: true },
  { key: 'collection', title: 'التحصيل', icon: '💰', targetKey: 'target_collection', color: '#10b981', currency: true },
  { key: 'total_visits', title: 'الزيارات', icon: '📍', targetKey: 'target_total_visits', color: '#06b6d4' },
  { key: 'successful_visits', title: 'الزيارات الناجحة', icon: '✅', targetKey: 'target_successful_visits', color: '#14b8a6' },
  { key: 'new_customers', title: 'عملاء جدد', icon: '👥', targetKey: 'target_new_customers', color: '#8b5cf6' },
  { key: 'new_products_skus', title: 'أصناف جديدة', icon: '📦', targetKey: 'target_new_products_skus', color: '#f59e0b' },
];

const formatMetric = (value, currency) => currency ? formatCurrency(value) : formatNumber(value);

function PerformanceCard({ metric, achieved, target, remainingDays, totalDays, monthPhase, monthProgress }) {
  const percent = target > 0 ? Math.round((achieved / target) * 100) : 0;
  const remaining = target > 0 ? Math.max(0, target - achieved) : 0;
  const dailyRequired = target > 0 ? getDailyRequirement(remaining, remainingDays, monthPhase, totalDays) : null;
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
        <span>يوميًا<br /><strong>{target > 0 && dailyRequired !== null ? formatMetric(dailyRequired, metric.currency) : '-'}</strong></span>
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

const isMissingTableError = (error) => error?.code === 'PGRST205' || error?.code === '42P01';

const fetchOptionalRows = async (query, fallback = []) => {
  const { data, error } = await query;
  if (error) {
    if (!isMissingTableError(error)) console.warn('Optional insight query failed:', error.message);
    return fallback;
  }
  return data || fallback;
};

const normalizeText = (value) => (value || '').toString().trim();

export default function RepDashboard({ repId }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [entries, setEntries] = useState([]);
  const [target, setTarget] = useState(null);
  const [rep, setRep] = useState(null);
  const [topCustomers, setTopCustomers] = useState([]);
  const [riskCustomers, setRiskCustomers] = useState([]);
  const [productFocus, setProductFocus] = useState([]);
  const [opportunities, setOpportunities] = useState([]);
  const [regionStrategy, setRegionStrategy] = useState(null);
  const [regionProfile, setRegionProfile] = useState({ customers: 0, products: 0, source: 'computed' });
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (repId) fetchRep(); }, [repId]);
  useEffect(() => {
    if (!repId) return undefined;
    let ignore = false;
    fetchDetails(() => !ignore);
    return () => { ignore = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repId, year, month]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (rep?.id) fetchRegionInsights(rep); }, [rep, year, month]);

  const fetchRep = async () => {
    const { data } = await supabase.from('representatives')
      .select('*, supervisors(name), regions(id,name)')
      .eq('id', repId)
      .single();
    if (data) {
      setRep(data);
    }
  };

  const fetchDetails = async (isCurrent = () => true) => {
    setLoading(true);
    const historyWindow = getSixMonthWindow(year, month);
    const [entriesResult, targetsResult, historyResult] = await Promise.all([
      supabase.from('daily_entries').select('*')
        .eq('rep_id', repId).eq('year', year).eq('month', month).order('entry_date'),
      supabase.from('monthly_targets').select('*')
        .eq('rep_id', repId).limit(10000),
      supabase.from('daily_entries').select('*')
        .eq('rep_id', repId)
        .gte('entry_date', historyWindow.startDate)
        .lte('entry_date', historyWindow.endDate)
        .order('entry_date'),
    ]);
    if (!isCurrent()) return; // a newer month/rep selection superseded this response
    if (entriesResult.data) setEntries(entriesResult.data);
    const targetMap = buildEffectiveTargetsMap(targetsResult.data || [], year, month);
    setTarget(targetMap[repId] || null);
    setHistory(buildHistoryRows(historyWindow.months, historyResult.data || [], targetsResult.data || [], repId));
    setLoading(false);
  };

  const fetchRegionInsights = async (repData) => {
    if (!repData?.region_id) return;
    const regionName = repData.regions?.name;
    setTopCustomers([]);
    setRiskCustomers([]);
    setProductFocus([]);
    setOpportunities([]);
    setRegionStrategy(null);
    setRegionProfile({ customers: 0, products: 0, source: 'computed' });

    const [
      sheetTopCustomers,
      sheetRisks,
      sheetProducts,
      sheetOpportunities,
      sheetStrategies,
    ] = await Promise.all([
      regionName ? fetchOptionalRows(
        supabase.from('top_customers_by_region')
          .select('*')
          .eq('region_name', regionName)
          .order('total_sales_6m', { ascending: false })
          .limit(8)
      ) : [],
      regionName ? fetchOptionalRows(
        supabase.from('customer_risks')
          .select('*')
          .eq('region_name', regionName)
          .order('total_debt', { ascending: false })
          .limit(6)
      ) : [],
      regionName ? fetchOptionalRows(
        supabase.from('product_analysis_by_region')
          .select('*')
          .eq('region_name', regionName)
          .order('total_sales_6m', { ascending: false })
          .limit(8)
      ) : [],
      regionName ? fetchOptionalRows(
        supabase.from('opportunities_by_region')
          .select('*')
          .eq('region_name', regionName)
          .order('estimated_value', { ascending: false })
          .limit(8)
      ) : [],
      regionName ? fetchOptionalRows(
        supabase.from('region_strategy')
          .select('*')
          .eq('region_name', regionName)
          .eq('strategy_year', year)
          .limit(12)
      ) : [],
    ]);

    if (sheetTopCustomers.length) {
      setTopCustomers(sheetTopCustomers.map((customer, index) => ({
        id: `${customer.customer_code || index}-${index}`,
        customer_code: customer.customer_code,
        customer_name: customer.customer_name,
        amount: Number(customer.total_sales_6m) || 0,
        quantity: 0,
        skuCount: Number(customer.sku_count) || 0,
        className: customer.customer_class,
        collectionRate: customer.collection_rate,
        note: customer.notes,
      })));
    }

    if (sheetRisks.length) {
      setRiskCustomers(sheetRisks.map((customer, index) => ({
        id: `${customer.customer_code || index}-${index}`,
        customer_code: customer.customer_code,
        customer_name: customer.customer_name,
        riskAmount: Number(customer.total_debt) || 0,
        debt_age: customer.risk_level,
        risk_reason: customer.risk_reason,
        recommended_action: customer.recommended_action,
      })));
    }

    if (sheetProducts.length) {
      setProductFocus(sheetProducts.map((product, index) => ({
        id: `${product.product_code || index}-${index}`,
        product_code: product.product_code,
        product_name: product.product_name,
        amount: Number(product.total_sales_6m) || 0,
        quantity: Number(product.total_qty_6m) || 0,
        customers: Number(product.active_customers_count) || 0,
        status: product.status,
        action: product.recommended_action,
      })));
    }

    if (sheetOpportunities.length) {
      setOpportunities(sheetOpportunities.map((opportunity, index) => ({
        id: `${opportunity.customer_code || index}-${opportunity.product_code || index}`,
        type: opportunity.opportunity_type,
        customer_name: opportunity.customer_name,
        product_name: opportunity.product_name,
        description: opportunity.opportunity_description,
        value: Number(opportunity.estimated_value) || 0,
        priority: opportunity.priority,
        action: opportunity.recommended_action,
      })));
    }

    if (sheetStrategies.length) {
      const currentMonthName = MONTHS_AR[month - 1];
      setRegionStrategy(
        sheetStrategies.find(row => normalizeText(row.strategy_month) === currentMonthName)
        || sheetStrategies[0]
      );
    }

    const { data: customers } = await supabase
      .from('customers')
      .select('id, customer_code, customer_name')
      .eq('region_id', repData.region_id)
      .limit(500);

    const customerIds = (customers || []).map(c => c.id);
    setRegionProfile(profile => ({ ...profile, customers: customerIds.length }));
    if (customerIds.length) {
      const { data: salesRows } = await supabase
        .from('customer_product_sales')
        .select('customer_id, amount, quantity, product_id, products(product_code, product_name)')
        .in('customer_id', customerIds)
        .limit(5000);

      const totals = {};
      const products = {};
      (salesRows || []).forEach(row => {
        if (!totals[row.customer_id]) totals[row.customer_id] = { amount: 0, quantity: 0, products: new Set() };
        totals[row.customer_id].amount += Number(row.amount) || 0;
        totals[row.customer_id].quantity += Number(row.quantity) || 0;
        if (row.product_id) totals[row.customer_id].products.add(row.product_id);
        if (row.product_id) {
          if (!products[row.product_id]) {
            products[row.product_id] = {
              id: row.product_id,
              product_code: row.products?.product_code,
              product_name: row.products?.product_name || 'صنف غير محدد',
              amount: 0,
              quantity: 0,
              customers: new Set(),
            };
          }
          products[row.product_id].amount += Number(row.amount) || 0;
          products[row.product_id].quantity += Number(row.quantity) || 0;
          products[row.product_id].customers.add(row.customer_id);
        }
      });
      setRegionProfile(profile => ({ ...profile, products: Object.keys(products).length }));

      if (!sheetTopCustomers.length) {
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

      if (!sheetProducts.length) {
        setProductFocus(Object.values(products)
          .map(product => ({ ...product, customers: product.customers.size, status: 'قوي', action: 'تعزيز الانتشار لدى عملاء A و B' }))
          .sort((a, b) => b.amount - a.amount)
          .slice(0, 8));
      }
    }

    if (regionName && !sheetRisks.length) {
      const { data: riskRows } = await supabase
        .from('customer_yearly_sales')
        .select('customer_code, customer_name, net_sales, collected, aging_61_90, aging_91_120, aging_120_plus, debt_age, year')
        .eq('region_name', regionName)
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
  const monthPhase = getMonthPhase(year, month);

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

  const salesDaily = getDailyRequirement(salesRemaining, remainingDays, monthPhase, totalDays);
  const collectionDaily = getDailyRequirement(collectionRemaining, remainingDays, monthPhase, totalDays);
  const nextActions = [
    { title: 'مبيعات مطلوبة يوميًا', value: salesTarget > 0 && salesDaily !== null ? formatCurrency(salesDaily) : '-', tone: '#3b82f6' },
    { title: 'تحصيل مطلوب يوميًا', value: collectionTarget > 0 && collectionDaily !== null ? formatCurrency(collectionDaily) : '-', tone: '#10b981' },
    { title: 'نسبة نجاح الزيارات', value: `${visitSuccessRate}%`, tone: '#06b6d4' },
    { title: 'تغطية صور الرف', value: `${shelfCoverage}%`, tone: '#f59e0b' },
  ];

  const actionPlan = regionStrategy ? [
    { title: 'تركيز البيع', value: regionStrategy.sales_focus || 'رفع مبيعات العملاء الأعلى قيمة.', tone: '#3b82f6' },
    { title: 'تركيز التحصيل', value: regionStrategy.collection_focus || 'متابعة العملاء المتأخرين.', tone: '#10b981' },
    { title: 'خطة الزيارات', value: regionStrategy.visit_plan || 'زيارة العملاء حسب الأولوية.', tone: '#06b6d4' },
    { title: 'منتجات للدفع', value: regionStrategy.products_to_push || 'تعزيز المنتجات الأعلى دورانًا.', tone: '#f59e0b' },
  ] : [
    { title: 'تركيز البيع', value: 'رفع تغطية العملاء الأعلى قيمة ومتابعة الأصناف الجديدة.', tone: '#3b82f6' },
    { title: 'تركيز التحصيل', value: 'البدء بالعملاء ذوي المديونية الأقدم والأعلى قيمة.', tone: '#10b981' },
    { title: 'خطة الزيارات', value: 'الحفاظ على زيارة يومية منتظمة مع توثيق صور الرف.', tone: '#06b6d4' },
    { title: 'منتجات للدفع', value: productFocus.slice(0, 3).map(p => p.product_name).join('، ') || 'تعزيز المنتجات الأعلى دورانًا.', tone: '#f59e0b' },
  ];

  const historyTotals = history.reduce((acc, row) => {
    acc.sales += row.sales;
    acc.collection += row.collection;
    acc.visits += row.visits;
    acc.newCustomers += row.newCustomers;
    return acc;
  }, { sales: 0, collection: 0, visits: 0, newCustomers: 0 });
  const bestHistoryMonth = [...history].sort((a, b) => b.salesPercent - a.salesPercent)[0];
  const salesPercent = calcPercent(totals.sales, salesTarget);
  const collectionPercent = calcPercent(totals.collection, collectionTarget);
  const visitPercent = calcPercent(totals.total_visits, target?.target_total_visits || 0);
  const successVisitPercent = calcPercent(totals.successful_visits, target?.target_successful_visits || 0);
  const newCustomerPercent = calcPercent(totals.new_customers, target?.target_new_customers || 0);
  const scoreParts = [
    salesTarget > 0 ? clampPercent(salesPercent) : null,
    collectionTarget > 0 ? clampPercent(collectionPercent) : null,
    target?.target_total_visits > 0 ? clampPercent(visitPercent) : null,
    target?.target_successful_visits > 0 ? clampPercent(successVisitPercent) : null,
    target?.target_new_customers > 0 ? clampPercent(newCustomerPercent) : null,
  ].filter(value => value !== null);
  const performanceScore = scoreParts.length
    ? Math.round(scoreParts.reduce((sum, value) => sum + value, 0) / scoreParts.length)
    : 0;
  const smartGoals = buildSmartGoals({
    totals,
    target,
    remainingDays,
    monthProgress,
    monthPhase,
    topCustomers,
    riskCustomers,
    productFocus,
  });
  const assistantSummary = monthPhase === 'past'
    ? 'هذا الشهر مكتمل. البيانات معروضة للمراجعة والمقارنة فقط، ولا توجد أهداف يومية قابلة للتنفيذ.'
    : scoreParts.length === 0
    ? 'لم يتم تحديد أهداف لهذا الشهر بعد. ستظهر التوصيات الذكية بمجرد إضافة الأهداف.'
    : performanceScore >= 75
    ? 'أداؤك جيد. حافظ على الإيقاع وركز على التحصيل والزيارات ذات القيمة الأعلى.'
    : performanceScore >= 55
      ? 'أنت قريب من المسار المطلوب. الأولوية الآن للفجوات اليومية الموضحة بالأسفل.'
      : 'اللوحة تشير إلى فجوة واضحة. ابدأ اليوم بأعلى هدف أولوية ثم تابع كبار العملاء.';

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

      <div className="rep-profile-strip">
        <div className="rep-mini-stat">
          <span>محفظة العملاء</span>
          <strong>{formatNumber(regionProfile.customers)}</strong>
        </div>
        <div className="rep-mini-stat">
          <span>أصناف نشطة</span>
          <strong>{formatNumber(regionProfile.products)}</strong>
        </div>
        <div className="rep-mini-stat">
          <span>كبار العملاء</span>
          <strong>{formatNumber(topCustomers.length)}</strong>
        </div>
        <div className="rep-mini-stat">
          <span>فرص مفتوحة</span>
          <strong>{formatNumber(opportunities.length)}</strong>
        </div>
        <div className="rep-mini-stat">
          <span>مخاطر تحصيل</span>
          <strong>{formatNumber(riskCustomers.length)}</strong>
        </div>
      </div>

      <section className="rep-ai-panel">
        <div className="rep-score-card">
          <span>درجة الأداء الذكية</span>
          <strong>{performanceScore}%</strong>
          <b>{scoreParts.length ? getScoreLabel(performanceScore) : 'بدون أهداف محددة'}</b>
          <div className="progress-bar" style={{ height: 9, marginTop: '0.85rem' }}>
            <div className="progress-fill" style={{ width: `${performanceScore}%`, background: performanceScore >= 75 ? '#10b981' : performanceScore >= 55 ? '#f59e0b' : '#ef4444' }} />
          </div>
        </div>
        <div className="rep-assistant-card">
          <div className="rep-assistant-head">
            <div>
              <span>المساعد الذكي</span>
              <strong>أهدافك العملية لهذا الشهر</strong>
            </div>
            <span className="badge badge-info">تحديث تلقائي</span>
          </div>
          <p>{assistantSummary}</p>
          <div className="rep-ai-goals">
            {smartGoals.length === 0 ? (
              <div className="rep-ai-goal" style={{ borderRightColor: '#10b981' }}>
                <span className="badge badge-success">مكتمل</span>
                <div>
                  <strong>لا توجد فجوات واضحة الآن</strong>
                  <small>تابع الإدخال اليومي وحافظ على نفس المعدل.</small>
                </div>
                <b>استمرار</b>
              </div>
            ) : smartGoals.map(goal => (
              <div className="rep-ai-goal" key={goal.id} style={{ borderRightColor: goal.tone }}>
                <span className={`badge ${goal.priority === 'عالي' ? 'badge-danger' : 'badge-warning'}`}>{goal.priority}</span>
                <div>
                  <strong>{goal.title}</strong>
                  <small>{goal.detail}</small>
                </div>
                <b>{goal.target}</b>
              </div>
            ))}
          </div>
        </div>
      </section>

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
                totalDays={totalDays}
                monthPhase={monthPhase}
                monthProgress={monthProgress}
              />
            ))}
          </div>

          <section className="rep-panel">
            <div className="card-title">إنجاز آخر 6 شهور</div>
            <div className="rep-history-summary">
              <div><span>إجمالي المبيعات</span><strong>{formatCurrency(historyTotals.sales)}</strong></div>
              <div><span>إجمالي التحصيل</span><strong>{formatCurrency(historyTotals.collection)}</strong></div>
              <div><span>إجمالي الزيارات</span><strong>{formatNumber(historyTotals.visits)}</strong></div>
              <div><span>عملاء جدد</span><strong>{formatNumber(historyTotals.newCustomers)}</strong></div>
              <div><span>أفضل شهر</span><strong>{bestHistoryMonth?.salesPercent > 0 ? `${bestHistoryMonth.label} (${bestHistoryMonth.salesPercent}%)` : '-'}</strong></div>
            </div>
            <div className="table-wrapper">
              <table className="responsive-cards">
                <thead>
                  <tr>
                    <th>الشهر</th>
                    <th>هدف المبيعات</th>
                    <th>مبيعات محققة</th>
                    <th>نسبة المبيعات</th>
                    <th>هدف التحصيل</th>
                    <th>تحصيل محقق</th>
                    <th>نسبة التحصيل</th>
                    <th>الزيارات</th>
                    <th>ناجحة</th>
                    <th>عملاء جدد</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map(row => (
                    <tr key={row.key}>
                      <td data-label="الشهر">{row.label}</td>
                      <td data-label="هدف المبيعات">{row.salesTarget > 0 ? formatCurrency(row.salesTarget) : '-'}</td>
                      <td data-label="مبيعات محققة" style={{ color: '#10b981' }}>{formatCurrency(row.sales)}</td>
                      <td data-label="نسبة المبيعات"><span className={`badge ${row.salesPercent >= 100 ? 'badge-success' : row.salesPercent > 0 ? 'badge-warning' : 'badge-danger'}`}>{row.salesTarget > 0 ? `${row.salesPercent}%` : '-'}</span></td>
                      <td data-label="هدف التحصيل">{row.collectionTarget > 0 ? formatCurrency(row.collectionTarget) : '-'}</td>
                      <td data-label="تحصيل محقق" style={{ color: '#10b981' }}>{formatCurrency(row.collection)}</td>
                      <td data-label="نسبة التحصيل"><span className={`badge ${row.collectionPercent >= 100 ? 'badge-success' : row.collectionPercent > 0 ? 'badge-warning' : 'badge-danger'}`}>{row.collectionTarget > 0 ? `${row.collectionPercent}%` : '-'}</span></td>
                      <td data-label="الزيارات">{formatNumber(row.visits)}</td>
                      <td data-label="ناجحة">{formatNumber(row.successfulVisits)}</td>
                      <td data-label="عملاء جدد">{formatNumber(row.newCustomers)}</td>
                    </tr>
                  ))}
                  <tr style={{ background: '#0f172a', fontWeight: 700 }}>
                    <td data-label="الشهر">الإجمالي</td>
                    <td data-label="هدف المبيعات">-</td>
                    <td data-label="مبيعات محققة" style={{ color: '#10b981' }}>{formatCurrency(historyTotals.sales)}</td>
                    <td data-label="نسبة المبيعات">-</td>
                    <td data-label="هدف التحصيل">-</td>
                    <td data-label="تحصيل محقق" style={{ color: '#10b981' }}>{formatCurrency(historyTotals.collection)}</td>
                    <td data-label="نسبة التحصيل">-</td>
                    <td data-label="الزيارات">{formatNumber(historyTotals.visits)}</td>
                    <td data-label="ناجحة">-</td>
                    <td data-label="عملاء جدد">{formatNumber(historyTotals.newCustomers)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

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
                {actionPlan.map(item => (
                  <div key={item.title} style={{ borderRightColor: item.tone }}>
                    <strong>{item.title}:</strong> {item.value}
                  </div>
                ))}
                {regionStrategy?.rep_instructions && (
                  <div style={{ borderRightColor: '#8b5cf6' }}>
                    <strong>تعليمات مباشرة:</strong> {regionStrategy.rep_instructions}
                  </div>
                )}
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

          <div className="rep-two-col">
            <section className="rep-panel">
              <div className="card-title">منتجات يجب دفعها</div>
              {productFocus.length === 0 ? (
                <div className="empty-state" style={{ padding: '2rem' }}>لا توجد بيانات منتجات للمنطقة</div>
              ) : (
                <div className="rep-list">
                  {productFocus.map((product, index) => (
                    <div className="rep-list-row" key={product.id}>
                      <span className="rep-rank">{index + 1}</span>
                      <div>
                        <strong>{product.product_name}</strong>
                        <small>{product.product_code || '-'} · {formatNumber(product.customers)} عميل · {formatNumber(product.quantity)} قطعة</small>
                      </div>
                      <b>{formatCurrency(product.amount)}</b>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="rep-panel">
              <div className="card-title">فرص بيع قريبة</div>
              {opportunities.length === 0 ? (
                <div className="empty-state" style={{ padding: '2rem' }}>لا توجد فرص مستوردة بعد لهذه المنطقة</div>
              ) : (
                <div className="rep-list">
                  {opportunities.map(opportunity => (
                    <div className="rep-list-row rep-list-row-wide" key={opportunity.id}>
                      <span className="badge badge-info">{opportunity.priority || 'فرصة'}</span>
                      <div>
                        <strong>{opportunity.customer_name || opportunity.product_name}</strong>
                        <small>{opportunity.product_name || opportunity.description}</small>
                        {opportunity.action && <small>{opportunity.action}</small>}
                      </div>
                      <b>{formatCurrency(opportunity.value)}</b>
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
                <table className="responsive-cards">
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
                        <td data-label="التاريخ">{new Date(entry.entry_date).toLocaleDateString('ar-SA-u-ca-gregory')}</td>
                        <td data-label="مبيعات" style={{ color: '#10b981' }}>{formatCurrency(entry.daily_sales)}</td>
                        <td data-label="تحصيل" style={{ color: '#10b981' }}>{formatCurrency(entry.daily_collection)}</td>
                        <td data-label="عملاء">{entry.new_customers}</td>
                        <td data-label="زيارات">{entry.total_visits}</td>
                        <td data-label="ناجحة">{entry.successful_visits}</td>
                        <td data-label="صور رف">{entry.shelf_photos || 0}</td>
                        <td data-label="أصناف">{entry.new_products_skus}</td>
                        <td data-label="قطع">{entry.new_products_qty}</td>
                        <td data-label="ساعات">{entry.working_hours}</td>
                        <td data-label="كم">{entry.km}</td>
                        <td data-label="مصروفات">{formatCurrency(entry.daily_expenses)}</td>
                      </tr>
                    ))}
                    <tr style={{ background: '#0f172a', fontWeight: 700 }}>
                      <td data-label="التاريخ">الإجمالي</td>
                      <td data-label="مبيعات" style={{ color: '#10b981' }}>{formatCurrency(totals.sales)}</td>
                      <td data-label="تحصيل" style={{ color: '#10b981' }}>{formatCurrency(totals.collection)}</td>
                      <td data-label="عملاء">{formatNumber(totals.new_customers)}</td>
                      <td data-label="زيارات">{formatNumber(totals.total_visits)}</td>
                      <td data-label="ناجحة">{formatNumber(totals.successful_visits)}</td>
                      <td data-label="صور رف">{formatNumber(totals.shelf_photos)}</td>
                      <td data-label="أصناف">{formatNumber(totals.new_products_skus)}</td>
                      <td data-label="قطع">{formatNumber(totals.new_products_qty)}</td>
                      <td data-label="ساعات">{formatNumber(totals.working_hours)}</td>
                      <td data-label="كم">{formatNumber(totals.km)}</td>
                      <td data-label="مصروفات" style={{ color: '#f59e0b' }}>{formatCurrency(totals.expenses)}</td>
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
