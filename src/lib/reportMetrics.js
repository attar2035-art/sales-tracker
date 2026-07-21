// Pure, side-effect-free helpers shared by the daily email report script
// (tools/send-daily-rep-reports.js) and its unit tests. CommonJS so the
// plain-Node report script can `require` it directly.

const MONTHS_AR = [
  'يناير', 'فبراير', 'مارس', 'إبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

function isWorkingDay(date) {
  return new Date(date).getDay() !== 5;
}

function getWorkingDaysInMonth(year, month) {
  const days = [];
  const date = new Date(year, month - 1, 1);
  while (date.getMonth() === month - 1) {
    if (isWorkingDay(date)) days.push(new Date(date));
    date.setDate(date.getDate() + 1);
  }
  return days;
}

function getMonthProgressUntil(year, month, dateString) {
  const total = getWorkingDaysInMonth(year, month);
  const reportDate = new Date(`${dateString}T23:59:59`);
  const passed = total.filter(day => day <= reportDate).length;
  return total.length > 0 ? (passed / total.length) * 100 : 0;
}

function getRemainingWorkingDaysAfter(year, month, dateString) {
  const reportDate = new Date(`${dateString}T23:59:59`);
  return getWorkingDaysInMonth(year, month).filter(day => day > reportDate).length;
}

function formatNumber(value) {
  return new Intl.NumberFormat('ar-SA').format(Math.round(Number(value) || 0));
}

function formatCurrency(value) {
  return new Intl.NumberFormat('ar-SA').format(Math.round(Number(value) || 0));
}

function sumBy(rows, field) {
  return (rows || []).reduce((sum, row) => sum + (parseFloat(row[field]) || 0), 0);
}

function targetForMonth(targets, repId, year, month) {
  return [...(targets || [])]
    .filter(target => target.rep_id === repId)
    .filter(target => target.year < year || (target.year === year && target.month <= month))
    .sort((a, b) => (b.year - a.year) || (b.month - a.month))[0] || {};
}

function percent(achieved, target) {
  return target > 0 ? Math.round((achieved / target) * 100) : 0;
}

function statusLabel(achieved, target, monthProgress) {
  if (!target) return 'بدون هدف';
  const rate = (achieved / target) * 100;
  if (rate >= monthProgress + 5) return 'متقدم';
  if (rate >= monthProgress - 5) return 'في المسار';
  return 'متأخر';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Compute every aggregate indicator for a single rep: yesterday's totals,
// month-to-date totals, targets, achievement %, status, and the daily rate
// still required to hit the monthly sales/collection targets.
function computeRepMetrics({ rep, yesterdayRows, monthRows, target, remainingDays, monthProgress }) {
  const yesterday = {
    sales: sumBy(yesterdayRows, 'daily_sales'),
    collection: sumBy(yesterdayRows, 'daily_collection'),
    visits: sumBy(yesterdayRows, 'total_visits'),
    successfulVisits: sumBy(yesterdayRows, 'successful_visits'),
    newCustomers: sumBy(yesterdayRows, 'new_customers'),
    newCustomersValue: sumBy(yesterdayRows, 'new_customers_value'),
    newProductsSkus: sumBy(yesterdayRows, 'new_products_skus'),
    newProductsQty: sumBy(yesterdayRows, 'new_products_qty'),
    shelfPhotos: sumBy(yesterdayRows, 'shelf_photos'),
    workingHours: sumBy(yesterdayRows, 'working_hours'),
    km: sumBy(yesterdayRows, 'km'),
    expenses: sumBy(yesterdayRows, 'daily_expenses'),
    overdueCollected: sumBy(yesterdayRows, 'overdue_collected'),
  };
  const month = {
    sales: sumBy(monthRows, 'daily_sales'),
    collection: sumBy(monthRows, 'daily_collection'),
    visits: sumBy(monthRows, 'total_visits'),
    successfulVisits: sumBy(monthRows, 'successful_visits'),
    newCustomers: sumBy(monthRows, 'new_customers'),
    newProductsSkus: sumBy(monthRows, 'new_products_skus'),
    newProductsQty: sumBy(monthRows, 'new_products_qty'),
    expenses: sumBy(monthRows, 'daily_expenses'),
    overdueCollected: sumBy(monthRows, 'overdue_collected'),
  };
  const targets = {
    sales: Number(target?.target_sales) || 0,
    collection: Number(target?.target_collection) || 0,
    visits: Number(target?.target_total_visits) || 0,
  };
  const salesRemaining = Math.max(0, targets.sales - month.sales);
  const collectionRemaining = Math.max(0, targets.collection - month.collection);
  return {
    rep,
    hasEntryYesterday: (yesterdayRows || []).length > 0,
    yesterday,
    month,
    targets,
    salesRemaining,
    collectionRemaining,
    requiredSalesDaily: remainingDays > 0 ? salesRemaining / remainingDays : salesRemaining,
    requiredCollectionDaily: remainingDays > 0 ? collectionRemaining / remainingDays : collectionRemaining,
    salesPercent: percent(month.sales, targets.sales),
    collectionPercent: percent(month.collection, targets.collection),
    visitsPercent: percent(month.visits, targets.visits),
    salesStatus: statusLabel(month.sales, targets.sales, monthProgress),
    collectionStatus: statusLabel(month.collection, targets.collection, monthProgress),
  };
}

// Sum a list of computeRepMetrics results into company/team-level totals.
function aggregateMetrics(metricsList) {
  const list = metricsList || [];
  const zeroKeys = Object.keys(list[0]?.yesterday || {
    sales: 0, collection: 0, visits: 0, successfulVisits: 0, newCustomers: 0,
    newCustomersValue: 0, newProductsSkus: 0, newProductsQty: 0, shelfPhotos: 0,
    workingHours: 0, km: 0, expenses: 0, overdueCollected: 0,
  });
  const add = (acc, obj) => {
    Object.keys(obj).forEach(key => { acc[key] = (acc[key] || 0) + (Number(obj[key]) || 0); });
    return acc;
  };
  const yesterday = {};
  const month = {};
  const targets = { sales: 0, collection: 0, visits: 0 };
  zeroKeys.forEach(key => { yesterday[key] = 0; });
  list.forEach(m => {
    add(yesterday, m.yesterday);
    add(month, m.month);
    targets.sales += m.targets.sales;
    targets.collection += m.targets.collection;
    targets.visits += m.targets.visits;
  });
  return {
    count: list.length,
    reported: list.filter(m => m.hasEntryYesterday).length,
    yesterday,
    month,
    targets,
    salesPercent: percent(month.sales || 0, targets.sales),
    collectionPercent: percent(month.collection || 0, targets.collection),
  };
}

module.exports = {
  MONTHS_AR,
  isWorkingDay,
  getWorkingDaysInMonth,
  getMonthProgressUntil,
  getRemainingWorkingDaysAfter,
  formatNumber,
  formatCurrency,
  sumBy,
  targetForMonth,
  percent,
  statusLabel,
  escapeHtml,
  computeRepMetrics,
  aggregateMetrics,
};
