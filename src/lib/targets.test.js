import {
  TARGET_FIELDS,
  EMPTY_TARGET,
  isTargetMonthOnOrBefore,
  isSameTargetMonth,
  buildEffectiveTargetsMap,
  targetToForm,
} from './targets';

describe('EMPTY_TARGET', () => {
  it('has an empty string for every target field', () => {
    TARGET_FIELDS.forEach(field => {
      expect(EMPTY_TARGET[field]).toBe('');
    });
  });
});

describe('isTargetMonthOnOrBefore', () => {
  it('accepts an earlier year', () => {
    expect(isTargetMonthOnOrBefore({ year: 2025, month: 12 }, 2026, 1)).toBe(true);
  });
  it('accepts the same month', () => {
    expect(isTargetMonthOnOrBefore({ year: 2026, month: 5 }, 2026, 5)).toBe(true);
  });
  it('rejects a later month in the same year', () => {
    expect(isTargetMonthOnOrBefore({ year: 2026, month: 6 }, 2026, 5)).toBe(false);
  });
});

describe('isSameTargetMonth', () => {
  it('matches exact year and month', () => {
    expect(isSameTargetMonth({ year: 2026, month: 5 }, 2026, 5)).toBe(true);
    expect(isSameTargetMonth({ year: 2026, month: 4 }, 2026, 5)).toBe(false);
  });
});

describe('buildEffectiveTargetsMap', () => {
  const targets = [
    { rep_id: 'r1', year: 2026, month: 3, target_sales: 300 },
    { rep_id: 'r1', year: 2026, month: 5, target_sales: 500 },
    { rep_id: 'r2', year: 2026, month: 1, target_sales: 100 },
  ];

  it('picks the exact month target when present', () => {
    const map = buildEffectiveTargetsMap(targets, 2026, 5);
    expect(map.r1.target_sales).toBe(500);
    expect(map.r1._isInherited).toBe(false);
  });

  it('inherits the most recent earlier target when the month is missing', () => {
    const map = buildEffectiveTargetsMap(targets, 2026, 4);
    expect(map.r1.target_sales).toBe(300); // from March, not May
    expect(map.r1._isInherited).toBe(true);
    expect(map.r1._sourceMonth).toBe(3);
  });

  it('omits reps whose earliest target is in the future', () => {
    // Viewing 2025-12: r2's earliest target (2026-01) has not started yet
    const map = buildEffectiveTargetsMap(targets, 2025, 12);
    expect(map.r2).toBeUndefined();
    expect(map.r1).toBeUndefined();
  });

  it('includes a rep whose only target is on-or-before the month', () => {
    const map = buildEffectiveTargetsMap(targets, 2026, 2);
    expect(map.r2.target_sales).toBe(100);
  });

  it('handles null input safely', () => {
    expect(buildEffectiveTargetsMap(null, 2026, 5)).toEqual({});
  });
});

describe('targetToForm', () => {
  it('returns a blank form for a null target', () => {
    expect(targetToForm(null)).toEqual(EMPTY_TARGET);
  });
  it('maps present fields and blanks missing ones', () => {
    const form = targetToForm({ target_sales: 500 });
    expect(form.target_sales).toBe(500);
    expect(form.target_collection).toBe('');
  });
});
