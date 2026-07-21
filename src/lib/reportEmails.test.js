const { computeRepMetrics } = require('./reportMetrics');
const { buildRepEmail, buildSummaryEmail } = require('../../tools/send-daily-rep-reports');

const entry = (over = {}) => ({
  daily_sales: 0, daily_collection: 0, total_visits: 0, successful_visits: 0,
  new_customers: 0, new_customers_value: 0, new_products_skus: 0, new_products_qty: 0,
  shelf_photos: 0, working_hours: 0, km: 0, daily_expenses: 0, overdue_collected: 0,
  ...over,
});

const makeMetrics = (rep, sales, collection) => computeRepMetrics({
  rep,
  yesterdayRows: [entry({ daily_sales: sales, daily_collection: collection, total_visits: 4, new_customers: 1, new_products_skus: 2 })],
  monthRows: [entry({ daily_sales: sales * 2, daily_collection: collection * 2, total_visits: 8 })],
  target: { target_sales: 1000, target_collection: 400, target_total_visits: 40 },
  remainingDays: 5,
  monthProgress: 50,
});

const repA = { id: 'r1', name: 'أحمد', supervisor_id: 'sup1', regions: { name: 'الرياض' }, supervisors: { id: 'sup1', name: 'خالد' } };
const repB = { id: 'r2', name: 'سالم', supervisor_id: 'sup1', regions: { name: 'جدة' }, supervisors: { id: 'sup1', name: 'خالد' } };

describe('buildRepEmail', () => {
  it('produces a subject and HTML containing the rep name and yesterday figures', () => {
    const email = buildRepEmail(makeMetrics(repA, 200, 100), 'ahmed@example.com', '2026-07-15', 5);
    expect(email.to).toBe('ahmed@example.com');
    expect(email.subject).toContain('أحمد');
    expect(email.subject).toContain('2026-07-15');
    expect(email.html).toContain('<!doctype html>');
    expect(email.html).toContain('أحمد');
    expect(email.html).toContain('الرياض');
    expect(email.text).toContain('مبيعات أمس');
  });
});

describe('buildSummaryEmail', () => {
  const metricsList = [makeMetrics(repA, 200, 100), makeMetrics(repB, 300, 150)];

  it('renders one table row per rep plus an aggregated total', () => {
    const email = buildSummaryEmail({ to: 'admin@example.com', scopeName: 'كل المناديب', metricsList, reportDate: '2026-07-15', remainingDays: 5 });
    expect(email.to).toBe('admin@example.com');
    expect(email.subject).toContain('كل المناديب');
    expect(email.html).toContain('أحمد');
    expect(email.html).toContain('سالم');
    expect(email.html).toContain('الإجمالي');
    // Company yesterday sales total = 200 + 300 = 500 (Arabic-Indic digits)
    const total = new Intl.NumberFormat('ar-SA').format(500);
    expect(email.html).toContain(total);
    expect(email.text).toContain('عدد المناديب: 2');
  });

  it('marks a rep who did not submit an entry yesterday', () => {
    const noEntry = computeRepMetrics({
      rep: repB, yesterdayRows: [], monthRows: [entry({ daily_sales: 10 })],
      target: {}, remainingDays: 5, monthProgress: 50,
    });
    const email = buildSummaryEmail({ to: 'admin@example.com', scopeName: 'كل المناديب', metricsList: [noEntry], reportDate: '2026-07-15', remainingDays: 5 });
    expect(email.html).toContain('لا إدخال');
  });
});
