import {
  MONTHS_AR,
  formatCurrency,
  formatNumber,
} from './helpers';
import { buildEffectiveTargetsMap } from './targets';

export const sumBy = (rows, field) =>
  (rows || []).reduce((total, row) => total + (parseFloat(row[field]) || 0), 0);

export const toDateString = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const getSixMonthWindow = (year, month) => {
  const start = new Date(year, month - 1, 1);
  start.setMonth(start.getMonth() - 5);
  const end = new Date(year, month, 0);
  const months = [];
  for (let i = 0; i < 6; i += 1) {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
    months.push({
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: `${MONTHS_AR[d.getMonth()]} ${d.getFullYear()}`,
    });
  }
  return { months, startDate: toDateString(start), endDate: toDateString(end) };
};

export const calcPercent = (achieved, target) =>
  target > 0 ? Math.round((achieved / target) * 100) : 0;

export const clampPercent = (value) => Math.max(0, Math.min(100, Math.round(value || 0)));

export const dailyRequired = (remaining, days) => (days > 0 ? remaining / days : remaining);

export const getScoreLabel = (score) => {
  if (score >= 90) return 'أداء قوي جدًا';
  if (score >= 75) return 'أداء جيد';
  if (score >= 55) return 'يحتاج متابعة';
  return 'يحتاج تدخل سريع';
};

export function getMetricState(percent, monthProgress) {
  if (percent >= monthProgress + 5) return { label: 'متقدم', color: '#10b981', bg: '#052e25' };
  if (percent >= monthProgress - 5) return { label: 'في المسار', color: '#f59e0b', bg: '#3f2a05' };
  return { label: 'يحتاج تركيز', color: '#ef4444', bg: '#3b0909' };
}

export const buildSmartGoals = ({
  totals,
  target,
  remainingDays,
  monthProgress,
  topCustomers,
  riskCustomers,
  productFocus,
}) => {
  const goals = [];
  const pushGoal = (goal) => goals.push({ id: `${goal.type}-${goals.length}`, ...goal });

  const salesTarget = parseFloat(target?.target_sales) || 0;
  const collectionTarget = parseFloat(target?.target_collection) || 0;
  const visitTarget = parseFloat(target?.target_total_visits) || 0;
  const successVisitTarget = parseFloat(target?.target_successful_visits) || 0;
  const newCustomerTarget = parseFloat(target?.target_new_customers) || 0;

  const salesPercent = calcPercent(totals.sales, salesTarget);
  const collectionPercent = calcPercent(totals.collection, collectionTarget);
  const visitPercent = calcPercent(totals.total_visits, visitTarget);
  const successVisitPercent = calcPercent(totals.successful_visits, successVisitTarget);
  const newCustomerPercent = calcPercent(totals.new_customers, newCustomerTarget);

  if (salesTarget > 0 && salesPercent < Math.max(100, monthProgress) && salesPercent < 100) {
    const gap = Math.max(0, salesTarget - totals.sales);
    pushGoal({
      type: 'sales',
      title: 'إغلاق فجوة المبيعات',
      target: `${formatCurrency(dailyRequired(gap, remainingDays))} يوميًا`,
      detail: `المحقق ${salesPercent}% من هدف المبيعات. المتبقي ${formatCurrency(gap)}.`,
      priority: salesPercent < monthProgress - 10 ? 'عالي' : 'متوسط',
      tone: '#3b82f6',
    });
  }

  if (collectionTarget > 0 && collectionPercent < Math.max(100, monthProgress) && collectionPercent < 100) {
    const gap = Math.max(0, collectionTarget - totals.collection);
    pushGoal({
      type: 'collection',
      title: 'رفع التحصيل اليومي',
      target: `${formatCurrency(dailyRequired(gap, remainingDays))} يوميًا`,
      detail: `المحقق ${collectionPercent}% من هدف التحصيل. ابدأ بالعملاء الأعلى مديونية.`,
      priority: collectionPercent < monthProgress - 10 ? 'عالي' : 'متوسط',
      tone: '#10b981',
    });
  }

  if (visitTarget > 0 && visitPercent < 100) {
    const gap = Math.max(0, visitTarget - totals.total_visits);
    pushGoal({
      type: 'visits',
      title: 'استكمال الزيارات',
      target: `${formatNumber(Math.ceil(dailyRequired(gap, remainingDays)))} زيارة يوميًا`,
      detail: `المتبقي ${formatNumber(gap)} زيارة من هدف الشهر.`,
      priority: visitPercent < monthProgress - 10 ? 'عالي' : 'متوسط',
      tone: '#06b6d4',
    });
  }

  if (successVisitTarget > 0 && successVisitPercent < 100) {
    const gap = Math.max(0, successVisitTarget - totals.successful_visits);
    pushGoal({
      type: 'successful-visits',
      title: 'تحويل الزيارات إلى زيارات ناجحة',
      target: `${formatNumber(Math.ceil(dailyRequired(gap, remainingDays)))} زيارة ناجحة يوميًا`,
      detail: `نسبة نجاح الزيارات الحالية ${totals.total_visits > 0 ? Math.round((totals.successful_visits / totals.total_visits) * 100) : 0}%.`,
      priority: 'متوسط',
      tone: '#14b8a6',
    });
  }

  if (newCustomerTarget > 0 && newCustomerPercent < 100) {
    const gap = Math.max(0, newCustomerTarget - totals.new_customers);
    pushGoal({
      type: 'new-customers',
      title: 'إضافة عملاء جدد',
      target: `${formatNumber(Math.ceil(dailyRequired(gap, remainingDays)))} عميل يوميًا`,
      detail: `المتبقي ${formatNumber(gap)} عميل جديد للوصول للهدف.`,
      priority: 'متوسط',
      tone: '#8b5cf6',
    });
  }

  if (topCustomers.length) {
    pushGoal({
      type: 'top-customers',
      title: 'زيارة كبار العملاء',
      target: topCustomers.slice(0, 3).map(customer => customer.customer_name).join('، '),
      detail: 'ابدأ بالعملاء الأعلى قيمة في المنطقة قبل توسيع الزيارات.',
      priority: 'عالي',
      tone: '#f59e0b',
    });
  }

  if (riskCustomers.length) {
    const risk = riskCustomers[0];
    pushGoal({
      type: 'risk',
      title: 'متابعة أكبر خطر تحصيل',
      target: risk.customer_name || 'عميل متأخر',
      detail: `قيمة الخطر ${formatCurrency(risk.riskAmount || 0)}. المطلوب إجراء متابعة اليوم.`,
      priority: 'عالي',
      tone: '#ef4444',
    });
  }

  if (productFocus.length) {
    pushGoal({
      type: 'product',
      title: 'دفع المنتجات ذات الأولوية',
      target: productFocus.slice(0, 3).map(product => product.product_name).join('، '),
      detail: 'ركز على الأصناف الأعلى دورانًا أو المطلوبة في خطة المنطقة.',
      priority: 'متوسط',
      tone: '#22c55e',
    });
  }

  return goals
    .sort((a, b) => (a.priority === 'عالي' ? -1 : 1) - (b.priority === 'عالي' ? -1 : 1))
    .slice(0, 5);
};

export const buildHistoryRows = (months, rows, targets, repId) => {
  return months.map(period => {
    const monthRows = (rows || []).filter(row => row.year === period.year && row.month === period.month);
    const effectiveTarget = buildEffectiveTargetsMap(targets || [], period.year, period.month)[repId] || null;
    const sales = sumBy(monthRows, 'daily_sales');
    const collection = sumBy(monthRows, 'daily_collection');
    const visits = sumBy(monthRows, 'total_visits');
    const successfulVisits = sumBy(monthRows, 'successful_visits');
    const newCustomers = sumBy(monthRows, 'new_customers');
    const salesTarget = parseFloat(effectiveTarget?.target_sales) || 0;
    const collectionTarget = parseFloat(effectiveTarget?.target_collection) || 0;
    return {
      ...period,
      days: monthRows.length,
      sales,
      collection,
      visits,
      successfulVisits,
      newCustomers,
      salesTarget,
      collectionTarget,
      salesPercent: calcPercent(sales, salesTarget),
      collectionPercent: calcPercent(collection, collectionTarget),
    };
  });
};
