const {
  getWorkingDaysInMonth,
  getMonthProgressUntil,
  getRemainingWorkingDaysAfter,
  formatNumber,
  sumBy,
  targetForMonth,
  percent,
  statusLabel,
  escapeHtml,
  computeRepMetrics,
  aggregateMetrics,
} = require('./reportMetrics');

const entry = (over = {}) => ({
  daily_sales: 0, daily_collection: 0, total_visits: 0, successful_visits: 0,
  new_customers: 0, new_customers_value: 0, new_products_skus: 0, new_products_qty: 0,
  shelf_photos: 0, working_hours: 0, km: 0, daily_expenses: 0, overdue_collected: 0,
  ...over,
});

describe('sumBy / percent', () => {
  it('sums a field coercing strings', () => {
    expect(sumBy([{ x: '2' }, { x: 3 }, { x: null }], 'x')).toBe(5);
    expect(sumBy(null, 'x')).toBe(0);
  });
  it('percent rounds and guards against zero target', () => {
    expect(percent(50, 200)).toBe(25);
    expect(percent(50, 0)).toBe(0);
  });
});

describe('statusLabel', () => {
  const progress = 50;
  it('returns بدون هدف when there is no target', () => {
    expect(statusLabel(100, 0, progress)).toBe('بدون هدف');
  });
  it('classifies relative to month progress', () => {
    expect(statusLabel(60, 100, progress)).toBe('متقدم');
    expect(statusLabel(48, 100, progress)).toBe('في المسار');
    expect(statusLabel(30, 100, progress)).toBe('متأخر');
  });
});

describe('targetForMonth', () => {
  const targets = [
    { rep_id: 'r1', year: 2026, month: 3, target_sales: 300 },
    { rep_id: 'r1', year: 2026, month: 5, target_sales: 500 },
    { rep_id: 'r2', year: 2026, month: 1, target_sales: 100 },
  ];
  it('returns the exact month target', () => {
    expect(targetForMonth(targets, 'r1', 2026, 5).target_sales).toBe(500);
  });
  it('inherits the latest earlier target for a missing month', () => {
    expect(targetForMonth(targets, 'r1', 2026, 4).target_sales).toBe(300);
  });
  it('returns an empty object when nothing applies yet', () => {
    expect(targetForMonth(targets, 'r2', 2025, 12)).toEqual({});
  });
});

describe('working-day helpers (report date based, not "today")', () => {
  it('counts working days excluding Fridays', () => {
    // July 2026 has 5 Fridays => 31 - 5 = 26 working days
    expect(getWorkingDaysInMonth(2026, 7)).toHaveLength(26);
  });
  it('progress and remaining split around the report date', () => {
    const total = 26;
    const remaining = getRemainingWorkingDaysAfter(2026, 7, '2026-07-15');
    const progress = getMonthProgressUntil(2026, 7, '2026-07-15');
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThan(total);
    expect(Math.round(progress)).toBe(Math.round(((total - remaining) / total) * 100));
  });
});

describe('escapeHtml', () => {
  it('escapes HTML-significant characters', () => {
    expect(escapeHtml('<b>"&"</b>')).toBe('&lt;b&gt;&quot;&amp;&quot;&lt;/b&gt;');
    expect(escapeHtml(null)).toBe('');
  });
});

describe('computeRepMetrics', () => {
  const rep = { id: 'r1', name: 'أحمد', regions: { name: 'الرياض' } };
  const monthRows = [
    entry({ daily_sales: 100, daily_collection: 40, total_visits: 3, new_customers: 1, new_products_skus: 2 }),
    entry({ daily_sales: 200, daily_collection: 60, total_visits: 5, new_customers: 2, new_products_skus: 1 }),
  ];
  const yesterdayRows = [monthRows[1]];
  const target = { target_sales: 600, target_collection: 200, target_total_visits: 20 };

  it('aggregates yesterday and month-to-date indicators', () => {
    const m = computeRepMetrics({ rep, yesterdayRows, monthRows, target, remainingDays: 5, monthProgress: 50 });
    expect(m.yesterday.sales).toBe(200);
    expect(m.month.sales).toBe(300);
    expect(m.month.newProductsSkus).toBe(3);
    expect(m.salesPercent).toBe(50); // 300/600
    expect(m.collectionPercent).toBe(50); // 100/200
    expect(m.hasEntryYesterday).toBe(true);
  });

  it('computes the daily amount still required to hit target', () => {
    const m = computeRepMetrics({ rep, yesterdayRows, monthRows, target, remainingDays: 5, monthProgress: 50 });
    // sales remaining = 600-300 = 300 over 5 days => 60/day
    expect(m.requiredSalesDaily).toBe(60);
  });

  it('flags a rep with no entry yesterday', () => {
    const m = computeRepMetrics({ rep, yesterdayRows: [], monthRows, target, remainingDays: 5, monthProgress: 50 });
    expect(m.hasEntryYesterday).toBe(false);
    expect(m.yesterday.sales).toBe(0);
  });

  it('handles missing target without dividing by zero', () => {
    const m = computeRepMetrics({ rep, yesterdayRows, monthRows, target: {}, remainingDays: 5, monthProgress: 50 });
    expect(m.salesPercent).toBe(0);
    expect(m.salesStatus).toBe('بدون هدف');
    expect(m.requiredSalesDaily).toBe(0);
  });
});

describe('aggregateMetrics', () => {
  const build = (sales, collection, target_sales, hasEntry = true) => computeRepMetrics({
    rep: { id: 's', name: 'x', regions: {} },
    yesterdayRows: hasEntry ? [entry({ daily_sales: sales, daily_collection: collection })] : [],
    monthRows: [entry({ daily_sales: sales, daily_collection: collection })],
    target: { target_sales, target_collection: 100 },
    remainingDays: 5,
    monthProgress: 50,
  });

  it('sums yesterday, month and target totals across reps', () => {
    const agg = aggregateMetrics([build(100, 50, 500), build(300, 150, 500)]);
    expect(agg.count).toBe(2);
    expect(agg.yesterday.sales).toBe(400);
    expect(agg.month.collection).toBe(200);
    expect(agg.targets.sales).toBe(1000);
    expect(agg.salesPercent).toBe(40); // 400/1000
  });

  it('counts how many reps actually reported yesterday', () => {
    const agg = aggregateMetrics([build(100, 50, 500, true), build(0, 0, 500, false)]);
    expect(agg.count).toBe(2);
    expect(agg.reported).toBe(1);
  });

  it('returns zeroed totals for an empty list', () => {
    const agg = aggregateMetrics([]);
    expect(agg.count).toBe(0);
    expect(agg.yesterday.sales).toBe(0);
    expect(agg.salesPercent).toBe(0);
  });
});

describe('formatNumber', () => {
  it('rounds and never throws on bad input', () => {
    expect(typeof formatNumber(1234.6)).toBe('string');
    expect(formatNumber(null)).toBe(formatNumber(0));
  });
});
