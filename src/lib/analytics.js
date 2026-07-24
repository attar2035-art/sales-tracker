// Canonical customer ABC classification (BUG-022).
//
// Previously the app graded customers two different ways: CustomerSegmentation
// used positional rank percentiles while CustomerABCAnalysis used cumulative
// sales — so the same customer could land in different grades. The standard,
// value-based ABC method is cumulative-sales: sort by value descending and
// assign grades by the running share of total value. This module is the single
// source of truth for both screens.

// 3-tier (A/B/C) — used by the ABC analysis tab.
export const ABC_BOUNDARIES = [
  { grade: 'A', maxCumulative: 80 },
  { grade: 'B', maxCumulative: 95 },
  { grade: 'C', maxCumulative: Infinity },
];

// 4-tier (A/B/C/D) — used by the segmentation grading tab.
export const ABCD_BOUNDARIES = [
  { grade: 'A', maxCumulative: 80 },
  { grade: 'B', maxCumulative: 95 },
  { grade: 'C', maxCumulative: 99 },
  { grade: 'D', maxCumulative: Infinity },
];

// Assign a grade to each customer by cumulative share of total value.
// Returns a new array sorted by value descending, each item augmented with
// `grade` and `cumulativePercent`. `valueKey` selects the sales field
// (net_sales, yearly_sales, …). Non-positive totals grade everyone the lowest.
export function classifyByCumulativeSales(customers, { valueKey = 'net_sales', boundaries = ABCD_BOUNDARIES } = {}) {
  const list = Array.isArray(customers) ? customers : [];
  const lowest = boundaries[boundaries.length - 1].grade;
  const sorted = [...list].sort((a, b) => (Number(b[valueKey]) || 0) - (Number(a[valueKey]) || 0));
  const total = sorted.reduce((sum, c) => sum + (Number(c[valueKey]) || 0), 0);
  if (total <= 0) {
    return sorted.map(c => ({ ...c, cumulativePercent: 0, grade: lowest }));
  }
  let cumulative = 0;
  return sorted.map(c => {
    cumulative += Number(c[valueKey]) || 0;
    const cumulativePercent = (cumulative / total) * 100;
    const bucket = boundaries.find(b => cumulativePercent <= b.maxCumulative) || boundaries[boundaries.length - 1];
    return { ...c, cumulativePercent, grade: bucket.grade };
  });
}
