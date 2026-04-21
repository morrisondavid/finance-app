import { describe, it, expect } from 'vitest';
import {
  toIsoDate,
  shiftIsoDate,
  daysBetween,
  daysUntil,
  daysLabel,
  todayIsoLocal,
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
