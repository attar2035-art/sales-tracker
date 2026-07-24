import {
  isWorkingDay,
  getWorkingDaysInMonth,
  getRemainingWorkingDays,
  getPassedWorkingDays,
  getTotalWorkingDaysInMonth,
  getMonthProgress,
  getMonthPhase,
  formatNumber,
  formatCurrency,
  getAchievementStatus,
  getStatusColor,
  getStatusLabel,
  MONTHS_AR,
} from './helpers';

describe('isWorkingDay', () => {
  it('treats Friday as a non-working day', () => {
    // 2026-07-24 is a Friday
    expect(isWorkingDay('2026-07-24')).toBe(false);
  });

  it('treats other days as working days', () => {
    // 2026-07-23 is a Thursday, 2026-07-25 is a Saturday
    expect(isWorkingDay('2026-07-23')).toBe(true);
    expect(isWorkingDay('2026-07-25')).toBe(true);
  });
});

describe('getWorkingDaysInMonth', () => {
  it('excludes only Fridays and stays within the month', () => {
    const days = getWorkingDaysInMonth(2026, 7); // July 2026 has 31 days, 4 Fridays (3,10,17,24,31 => 5)
    // July 2026 Fridays: 3,10,17,24,31 => 5 Fridays
    expect(days).toHaveLength(31 - 5);
    days.forEach(d => {
      expect(d.getMonth()).toBe(6); // July = index 6
      expect(d.getDay()).not.toBe(5); // never Friday
    });
  });

  it('total equals working-days helper', () => {
    expect(getTotalWorkingDaysInMonth(2026, 7)).toBe(getWorkingDaysInMonth(2026, 7).length);
  });
});

describe('remaining / passed working days (time-dependent)', () => {
  const FIXED_NOW = new Date(2026, 6, 21, 12, 0, 0); // 2026-07-21 (a Tuesday), mid-month

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('splits the current month into passed + remaining = total', () => {
    const total = getTotalWorkingDaysInMonth(2026, 7);
    const passed = getPassedWorkingDays(2026, 7);
    const remaining = getRemainingWorkingDays(2026, 7);
    expect(passed + remaining).toBe(total);
    expect(passed).toBeGreaterThan(0);
    expect(remaining).toBeGreaterThan(0);
  });

  it('documents the past-month edge case: 0 remaining, 100% progress', () => {
    // Viewing June 2026 while "today" is 2026-07-21
    expect(getRemainingWorkingDays(2026, 6)).toBe(0);
    expect(Math.round(getMonthProgress(2026, 6))).toBe(100);
  });

  it('documents the future-month edge case: all remaining, 0% progress', () => {
    // Viewing August 2026 while "today" is 2026-07-21
    expect(getRemainingWorkingDays(2026, 8)).toBe(getTotalWorkingDaysInMonth(2026, 8));
    expect(Math.round(getMonthProgress(2026, 8))).toBe(0);
  });
});

describe('getMonthPhase', () => {
  const now = new Date(2026, 6, 21); // 2026-07 is "current"

  it('classifies an earlier month as past', () => {
    expect(getMonthPhase(2026, 6, now)).toBe('past');
    expect(getMonthPhase(2025, 12, now)).toBe('past');
  });

  it('classifies the same year and month as current', () => {
    expect(getMonthPhase(2026, 7, now)).toBe('current');
  });

  it('classifies a later month as future', () => {
    expect(getMonthPhase(2026, 8, now)).toBe('future');
    expect(getMonthPhase(2027, 1, now)).toBe('future');
  });
});

describe('formatNumber / formatCurrency', () => {
  it('rounds and returns a string', () => {
    expect(typeof formatNumber(1234.6)).toBe('string');
    expect(formatNumber(0)).not.toBe('');
  });

  it('formats null/undefined/NaN consistently with 0 (localized)', () => {
    const zero = formatNumber(0);
    expect(formatNumber(null)).toBe(zero);
    expect(formatNumber(undefined)).toBe(zero);
    expect(formatNumber('not a number')).toBe(zero);
    expect(formatCurrency(undefined)).toBe(formatCurrency(0));
  });

  it('rounds to the nearest integer', () => {
    // digits are localized (Arabic-Indic); compare against the same formatter
    expect(formatNumber(10.4)).toBe(formatNumber(10));
    expect(formatNumber(10.5)).toBe(formatNumber(11));
  });
});

describe('getAchievementStatus', () => {
  const progress = 50;
  it('returns no-target when target is 0', () => {
    expect(getAchievementStatus(100, 0, progress)).toBe('no-target');
  });
  it('classifies ahead / on-track / behind around month progress', () => {
    expect(getAchievementStatus(60, 100, progress)).toBe('ahead'); // 60% >= 55
    expect(getAchievementStatus(48, 100, progress)).toBe('on-track'); // 48% within +-5
    expect(getAchievementStatus(30, 100, progress)).toBe('behind'); // 30% < 45
  });
});

describe('status color / label maps', () => {
  it('maps every known status', () => {
    ['ahead', 'on-track', 'behind', 'no-target'].forEach(s => {
      expect(getStatusColor(s)).toMatch(/^#|gray|grey/i);
      expect(typeof getStatusLabel(s)).toBe('string');
    });
  });
});

describe('MONTHS_AR', () => {
  it('has 12 months', () => {
    expect(MONTHS_AR).toHaveLength(12);
  });
});
