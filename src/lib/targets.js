export const TARGET_FIELDS = [
  'target_sales',
  'target_collection',
  'target_new_customers',
  'target_new_customers_value',
  'target_total_visits',
  'target_successful_visits',
  'target_new_products_skus',
  'target_new_products_qty',
  'target_working_hours',
  'target_km',
  'overdue_total',
];

export const EMPTY_TARGET = TARGET_FIELDS.reduce((acc, field) => {
  acc[field] = '';
  return acc;
}, {});

export const isTargetMonthOnOrBefore = (target, year, month) => {
  return target.year < year || (target.year === year && target.month <= month);
};

export const isSameTargetMonth = (target, year, month) => {
  return target.year === year && target.month === month;
};

export const buildEffectiveTargetsMap = (targets, year, month) => {
  const map = {};
  [...(targets || [])]
    .filter(target => isTargetMonthOnOrBefore(target, year, month))
    .sort((a, b) => (b.year - a.year) || (b.month - a.month))
    .forEach(target => {
      if (!map[target.rep_id]) {
        map[target.rep_id] = {
          ...target,
          _isInherited: !isSameTargetMonth(target, year, month),
          _sourceYear: target.year,
          _sourceMonth: target.month,
        };
      }
    });
  return map;
};

export const targetToForm = (target) => {
  if (!target) return { ...EMPTY_TARGET };
  return TARGET_FIELDS.reduce((acc, field) => {
    acc[field] = target[field] ?? '';
    return acc;
  }, {});
};
