import {
  sumBy,
  toDateString,
  getSixMonthWindow,
  calcPercent,
  clampPercent,
  dailyRequired,
  getScoreLabel,
  getMetricState,
  buildSmartGoals,
  buildHistoryRows,
} from './repMetrics';

describe('sumBy', () => {
  it('sums a numeric field, coercing strings and ignoring non-numbers', () => {
    const rows = [{ x: 10 }, { x: '5.5' }, { x: null }, { x: 'abc' }, {}];
    expect(sumBy(rows, 'x')).toBe(15.5);
  });
  it('returns 0 for null/empty input', () => {
    expect(sumBy(null, 'x')).toBe(0);
    expect(sumBy([], 'x')).toBe(0);
  });
});

describe('toDateString', () => {
  it('formats a Date as YYYY-MM-DD with zero padding', () => {
    expect(toDateString(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(toDateString(new Date(2026, 11, 31))).toBe('2026-12-31');
  });
});

describe('getSixMonthWindow', () => {
  it('returns 6 consecutive months ending with the selected month', () => {
    const { months, startDate, endDate } = getSixMonthWindow(2026, 7);
    expect(months).toHaveLength(6);
    expect(months[0].key).toBe('2026-02');
    expect(months[5].key).toBe('2026-07');
    expect(startDate).toBe('2026-02-01');
    expect(endDate).toBe('2026-07-31'); // last day of July
  });

  it('crosses a year boundary correctly', () => {
    const { months } = getSixMonthWindow(2026, 2);
    expect(months[0].key).toBe('2025-09');
    expect(months[5].key).toBe('2026-02');
  });
});

describe('calcPercent', () => {
  it('rounds achieved/target * 100', () => {
    expect(calcPercent(50, 200)).toBe(25);
    expect(calcPercent(1, 3)).toBe(33);
  });
  it('returns 0 when target is 0 or negative', () => {
    expect(calcPercent(50, 0)).toBe(0);
    expect(calcPercent(50, -10)).toBe(0);
  });
  it('can exceed 100 (no clamping)', () => {
    expect(calcPercent(300, 200)).toBe(150);
  });
});

describe('clampPercent', () => {
  it('clamps into the 0..100 range', () => {
    expect(clampPercent(-5)).toBe(0);
    expect(clampPercent(150)).toBe(100);
    expect(clampPercent(42.4)).toBe(42);
    expect(clampPercent(null)).toBe(0);
  });
});

describe('dailyRequired', () => {
  it('divides the remaining amount over remaining days', () => {
    expect(dailyRequired(100, 4)).toBe(25);
  });
  it('falls back to the whole remaining amount when days <= 0 (past/finished month)', () => {
    expect(dailyRequired(100, 0)).toBe(100);
    expect(dailyRequired(100, -3)).toBe(100);
  });
});

describe('getScoreLabel', () => {
  it('maps score bands to Arabic labels', () => {
    expect(getScoreLabel(95)).toBe('أداء قوي جدًا');
    expect(getScoreLabel(80)).toBe('أداء جيد');
    expect(getScoreLabel(60)).toBe('يحتاج متابعة');
    expect(getScoreLabel(20)).toBe('يحتاج تدخل سريع');
  });
});

describe('getMetricState', () => {
  const progress = 50;
  it('is "متقدم" when clearly ahead of month progress', () => {
    expect(getMetricState(60, progress).label).toBe('متقدم');
  });
  it('is "في المسار" when near month progress', () => {
    expect(getMetricState(48, progress).label).toBe('في المسار');
  });
  it('is "يحتاج تركيز" when behind', () => {
    expect(getMetricState(30, progress).label).toBe('يحتاج تركيز');
  });
});

describe('buildSmartGoals', () => {
  const baseArgs = {
    totals: {
      sales: 0, collection: 0, total_visits: 0,
      successful_visits: 0, new_customers: 0,
    },
    target: null,
    remainingDays: 10,
    monthProgress: 50,
    topCustomers: [],
    riskCustomers: [],
    productFocus: [],
  };

  it('returns no goals when there is no target and no insights', () => {
    expect(buildSmartGoals(baseArgs)).toEqual([]);
  });

  it('creates a sales goal when behind target', () => {
    const goals = buildSmartGoals({
      ...baseArgs,
      target: { target_sales: 1000 },
      totals: { ...baseArgs.totals, sales: 100 },
    });
    const sales = goals.find(g => g.type === 'sales');
    expect(sales).toBeDefined();
    expect(sales.priority).toBe('عالي'); // 10% << monthProgress(50)-10
  });

  it('does not create a sales goal once the target is met', () => {
    const goals = buildSmartGoals({
      ...baseArgs,
      target: { target_sales: 1000 },
      totals: { ...baseArgs.totals, sales: 1000 },
    });
    expect(goals.find(g => g.type === 'sales')).toBeUndefined();
  });

  it('caps the list at 5 goals and puts high-priority first', () => {
    const goals = buildSmartGoals({
      ...baseArgs,
      target: {
        target_sales: 1000, target_collection: 1000, target_total_visits: 100,
        target_successful_visits: 100, target_new_customers: 50,
      },
      topCustomers: [{ customer_name: 'A' }],
      riskCustomers: [{ customer_name: 'R', riskAmount: 500 }],
      productFocus: [{ product_name: 'P' }],
    });
    expect(goals.length).toBeLessThanOrEqual(5);
    expect(goals[0].priority).toBe('عالي');
  });
});

describe('buildHistoryRows', () => {
  const months = getSixMonthWindow(2026, 7).months;
  const entries = [
    { year: 2026, month: 7, daily_sales: 100, daily_collection: 40, total_visits: 3, successful_visits: 2, new_customers: 1 },
    { year: 2026, month: 7, daily_sales: 200, daily_collection: 60, total_visits: 5, successful_visits: 4, new_customers: 2 },
    { year: 2026, month: 6, daily_sales: 50, daily_collection: 10, total_visits: 1, successful_visits: 1, new_customers: 0 },
  ];
  const targets = [{ rep_id: 'r1', year: 2026, month: 7, target_sales: 600, target_collection: 200 }];

  it('aggregates entries per month and computes percentages against effective targets', () => {
    const rows = buildHistoryRows(months, entries, targets, 'r1');
    const july = rows.find(r => r.key === '2026-07');
    expect(july.sales).toBe(300);
    expect(july.collection).toBe(100);
    expect(july.visits).toBe(8);
    expect(july.days).toBe(2);
    expect(july.salesPercent).toBe(50); // 300/600
    expect(july.collectionPercent).toBe(50); // 100/200
  });

  it('inherits July target into a missing month and marks 0 sales as 0%', () => {
    const rows = buildHistoryRows(months, entries, targets, 'r1');
    const june = rows.find(r => r.key === '2026-06');
    expect(june.sales).toBe(50);
    // June has no explicit target and July is later, so no earlier target to inherit => 0
    expect(june.salesTarget).toBe(0);
    expect(june.salesPercent).toBe(0);
  });
});
