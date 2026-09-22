// Shared debt-aging bucket definitions and helpers, so the rep dashboard,
// the supervisor team view and the analysis page all agree on the same
// buckets, labels (Latin digits) and derived figures.
export const DEBT_BUCKETS = [
  { key: 'debt_1_45', label: '45-60 يوم' },
  { key: 'debt_over_60', label: '61-90 يوم' },
  { key: 'debt_over_90', label: '91-120 يوم' },
  { key: 'debt_over_120', label: '121-150 يوم' },
  { key: 'debt_over_150', label: 'فوق 150' },
];

// "Due to collect" = 61 days and older (excludes the 45-60 bucket).
export const DEBT_DUE_KEYS = ['debt_over_60', 'debt_over_90', 'debt_over_120', 'debt_over_150'];
// "Aged" (harder) debt = 91 days and older.
export const DEBT_AGED_KEYS = ['debt_over_90', 'debt_over_120', 'debt_over_150'];

// Columns to pull when reading a debt snapshot from daily_entries.
export const DEBT_COLUMNS = 'entry_date, debt_total, debt_1_45, debt_over_60, debt_over_90, debt_over_120, debt_over_150';

export const debtDueOf = (o) => DEBT_DUE_KEYS.reduce((s, k) => s + (Number(o?.[k]) || 0), 0);
export const debtAgedOf = (o) => DEBT_AGED_KEYS.reduce((s, k) => s + (Number(o?.[k]) || 0), 0);
export const debtPct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
