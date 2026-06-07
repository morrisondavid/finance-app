import { describe, it, expect } from 'vitest';
import {
  toIsoDate,
  shiftIsoDate,
  daysBetween,
  daysUntil,
  daysLabel,
  todayIsoLocal,
  todayIsoInTimeZone,
  daysUntilInTimeZone,
  isoWeekRange,
  monthRange,
  parseIsoFromDDMMYYYY,
  isoDateAddCalendarMonths,
} from './iso-date.js';

describe('toIsoDate', () => {
  it('formats a UTC-constructed date as YYYY-MM-DD', () => {
    expect(toIsoDate(new Date(Date.UTC(2026, 3, 21)))).toBe('2026-04-21');
  });

  it('zero-pads single-digit months and days', () => {
    expect(toIsoDate(new Date(Date.UTC(2026, 0, 1)))).toBe('2026-01-01');
    expect(toIsoDate(new Date(Date.UTC(2026, 8, 9)))).toBe('2026-09-09');
  });
});

describe('isoDateAddCalendarMonths', () => {
  it('adds months in local calendar sense', () => {
    expect(isoDateAddCalendarMonths('2026-05-08', 12)).toBe('2027-05-08');
    expect(isoDateAddCalendarMonths('2026-01-31', 1)).toBe('2026-02-28');
  });

  it('subtracts months when negative', () => {
    expect(isoDateAddCalendarMonths('2026-05-08', -12)).toBe('2025-05-08');
  });
});

describe('shiftIsoDate', () => {
  it('shifts forward by the given number of days', () => {
    expect(shiftIsoDate('2026-04-21', 1)).toBe('2026-04-22');
    expect(shiftIsoDate('2026-04-21', 10)).toBe('2026-05-01');
  });

  it('shifts backward on negative values', () => {
    expect(shiftIsoDate('2026-04-21', -1)).toBe('2026-04-20');
    expect(shiftIsoDate('2026-04-21', -30)).toBe('2026-03-22');
  });

  it('crosses month boundaries', () => {
    expect(shiftIsoDate('2026-01-31', 1)).toBe('2026-02-01');
    expect(shiftIsoDate('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('crosses year boundaries', () => {
    expect(shiftIsoDate('2025-12-31', 1)).toBe('2026-01-01');
    expect(shiftIsoDate('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('handles leap years', () => {
    expect(shiftIsoDate('2024-02-28', 1)).toBe('2024-02-29');
    expect(shiftIsoDate('2024-02-29', 1)).toBe('2024-03-01');
    expect(shiftIsoDate('2025-02-28', 1)).toBe('2025-03-01');
  });

  it('is DST-safe (UK spring forward / autumn back)', () => {
    expect(shiftIsoDate('2026-03-29', 1)).toBe('2026-03-30');
    expect(shiftIsoDate('2026-10-25', 1)).toBe('2026-10-26');
  });

  it('zero shift is a no-op', () => {
    expect(shiftIsoDate('2026-04-21', 0)).toBe('2026-04-21');
  });
});

describe('daysBetween', () => {
  it('returns 0 for the same date', () => {
    expect(daysBetween('2026-04-21', '2026-04-21')).toBe(0);
  });

  it('positive when a is after b', () => {
    expect(daysBetween('2026-04-22', '2026-04-21')).toBe(1);
    expect(daysBetween('2026-05-21', '2026-04-21')).toBe(30);
  });

  it('negative when a is before b', () => {
    expect(daysBetween('2026-04-20', '2026-04-21')).toBe(-1);
    expect(daysBetween('2026-03-21', '2026-04-21')).toBe(-31);
  });

  it('crosses year boundaries', () => {
    expect(daysBetween('2026-01-01', '2025-12-31')).toBe(1);
  });

  it('is DST-safe across a UK spring-forward weekend', () => {
    expect(daysBetween('2026-03-30', '2026-03-29')).toBe(1);
  });
});

describe('daysUntil', () => {
  it('counts calendar days using an injected today', () => {
    const today = new Date(2026, 3, 21);
    expect(daysUntil('2026-04-21', today)).toBe(0);
    expect(daysUntil('2026-04-22', today)).toBe(1);
    expect(daysUntil('2026-04-20', today)).toBe(-1);
  });

  it('is based on the local calendar day, not UTC', () => {
    const lateEvening = new Date(2026, 3, 21, 23, 30, 0);
    expect(daysUntil('2026-04-21', lateEvening)).toBe(0);
    expect(daysUntil('2026-04-22', lateEvening)).toBe(1);
  });
});

describe('daysLabel', () => {
  it('formats today', () => {
    expect(daysLabel(0)).toBe('Today');
  });

  it('formats a single day in future / past', () => {
    expect(daysLabel(1)).toBe('1 day');
    expect(daysLabel(-1)).toBe('1 day overdue');
  });

  it('formats multiple days in future / past', () => {
    expect(daysLabel(5)).toBe('5 days');
    expect(daysLabel(-5)).toBe('5 days overdue');
  });
});

describe('todayIsoInTimeZone', () => {
  it('returns the calendar day in Europe/London', () => {
    const instant = new Date('2026-06-07T23:30:00.000Z');
    expect(todayIsoInTimeZone(instant, 'Europe/London')).toBe('2026-06-08');
    expect(todayIsoInTimeZone(instant, 'UTC')).toBe('2026-06-07');
  });
});

describe('daysUntilInTimeZone', () => {
  it('matches daysUntil against the timezone calendar day', () => {
    const now = new Date('2026-06-08T00:30:00.000Z');
    expect(daysUntilInTimeZone('2026-06-07', 'Europe/London', now)).toBe(-1);
    expect(daysUntilInTimeZone('2026-06-08', 'Europe/London', now)).toBe(0);
  });
});

describe('todayIsoLocal', () => {
  it('returns YYYY-MM-DD for an injected Date', () => {
    expect(todayIsoLocal(new Date(2026, 3, 21))).toBe('2026-04-21');
    expect(todayIsoLocal(new Date(2026, 0, 1))).toBe('2026-01-01');
  });

  it('does not roll over after 00:00 UTC on late-evening UK dates', () => {
    const ukLateEvening = new Date(2026, 3, 21, 23, 45, 0);
    expect(todayIsoLocal(ukLateEvening)).toBe('2026-04-21');
  });
});

describe('isoWeekRange', () => {
  it('returns Monday..Sunday for a mid-week day', () => {
    // 2026-04-22 is a Wednesday
    expect(isoWeekRange('2026-04-22')).toEqual({ start: '2026-04-20', end: '2026-04-26' });
  });

  it('returns the same week when called on its Monday', () => {
    expect(isoWeekRange('2026-04-20')).toEqual({ start: '2026-04-20', end: '2026-04-26' });
  });

  it('returns the same week when called on its Sunday', () => {
    expect(isoWeekRange('2026-04-26')).toEqual({ start: '2026-04-20', end: '2026-04-26' });
  });

  it('spans the year boundary correctly (2026-01-01 is a Thursday)', () => {
    expect(isoWeekRange('2026-01-01')).toEqual({ start: '2025-12-29', end: '2026-01-04' });
  });

  it('handles a Monday at the start of the year', () => {
    // 2024-01-01 is a Monday
    expect(isoWeekRange('2024-01-01')).toEqual({ start: '2024-01-01', end: '2024-01-07' });
  });

  it('is DST-safe across the UK spring-forward boundary (2026-03-29 is a Sunday)', () => {
    expect(isoWeekRange('2026-03-29')).toEqual({ start: '2026-03-23', end: '2026-03-29' });
    expect(isoWeekRange('2026-03-30')).toEqual({ start: '2026-03-30', end: '2026-04-05' });
  });
});

describe('monthRange', () => {
  it('returns first..last day of a 31-day month', () => {
    expect(monthRange('2026-01-15')).toEqual({ start: '2026-01-01', end: '2026-01-31' });
  });

  it('returns first..last day of a 30-day month', () => {
    expect(monthRange('2026-04-15')).toEqual({ start: '2026-04-01', end: '2026-04-30' });
  });

  it('handles February in a non-leap year (28 days)', () => {
    expect(monthRange('2025-02-10')).toEqual({ start: '2025-02-01', end: '2025-02-28' });
  });

  it('handles February in a leap year (29 days)', () => {
    expect(monthRange('2024-02-10')).toEqual({ start: '2024-02-01', end: '2024-02-29' });
  });

  it('returns the same range when called on the first day', () => {
    expect(monthRange('2026-07-01')).toEqual({ start: '2026-07-01', end: '2026-07-31' });
  });

  it('returns the same range when called on the last day', () => {
    expect(monthRange('2026-07-31')).toEqual({ start: '2026-07-01', end: '2026-07-31' });
  });

  it('handles December (year boundary does not affect range)', () => {
    expect(monthRange('2026-12-15')).toEqual({ start: '2026-12-01', end: '2026-12-31' });
  });
});

describe('parseIsoFromDDMMYYYY', () => {
  it('parses the canonical UK date format', () => {
    expect(parseIsoFromDDMMYYYY('22/04/2026')).toBe('2026-04-22');
  });

  it('accepts single-digit day and month and zero-pads them', () => {
    expect(parseIsoFromDDMMYYYY('1/2/2026')).toBe('2026-02-01');
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseIsoFromDDMMYYYY('  22/04/2026  ')).toBe('2026-04-22');
  });

  it('returns null for malformed input', () => {
    expect(parseIsoFromDDMMYYYY('2026-04-22')).toBeNull();
    expect(parseIsoFromDDMMYYYY('22-04-2026')).toBeNull();
    expect(parseIsoFromDDMMYYYY('not a date')).toBeNull();
    expect(parseIsoFromDDMMYYYY('')).toBeNull();
  });

  it('returns null for impossible calendar dates', () => {
    expect(parseIsoFromDDMMYYYY('31/02/2026')).toBeNull();
    expect(parseIsoFromDDMMYYYY('00/04/2026')).toBeNull();
    expect(parseIsoFromDDMMYYYY('32/04/2026')).toBeNull();
    expect(parseIsoFromDDMMYYYY('15/13/2026')).toBeNull();
  });

  it('accepts February 29 on a leap year but rejects it otherwise', () => {
    expect(parseIsoFromDDMMYYYY('29/02/2024')).toBe('2024-02-29');
    expect(parseIsoFromDDMMYYYY('29/02/2025')).toBeNull();
  });
});
