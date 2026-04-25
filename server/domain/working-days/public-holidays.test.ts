import { describe, it, expect, beforeEach } from 'vitest';
import {
  getPublicHolidays,
  holidayDatesForEntity,
  __resetPublicHolidayCacheForTests,
} from './public-holidays.js';

beforeEach(() => {
  __resetPublicHolidayCacheForTests();
});

describe('getPublicHolidays', () => {
  it('returns 8 UK bank holidays for 2025', () => {
    const holidays = getPublicHolidays('UK', 2025);
    expect(holidays).toHaveLength(8);
    const dates = holidays.map(h => h.date);
    expect(dates).toContain('2025-01-01');
    expect(dates).toContain('2025-04-18');
    expect(dates).toContain('2025-04-21');
    expect(dates).toContain('2025-05-05');
    expect(dates).toContain('2025-05-26');
    expect(dates).toContain('2025-08-25');
    expect(dates).toContain('2025-12-25');
    expect(dates).toContain('2025-12-26');
  });

  it('includes the Summer bank holiday supplement for 2026', () => {
    const holidays = getPublicHolidays('UK', 2026);
    const summer = holidays.find(h => h.name === 'Summer bank holiday');
    expect(summer).toBeDefined();
    expect(summer!.date).toBe('2026-08-31');
  });

  it('returns holidays sorted by date', () => {
    const holidays = getPublicHolidays('UK', 2025);
    for (let i = 1; i < holidays.length; i++) {
      expect(holidays[i].date >= holidays[i - 1].date).toBe(true);
    }
  });

  it('returns UAE public holidays for 2026', () => {
    const holidays = getPublicHolidays('UAE', 2026);
    expect(holidays.length).toBeGreaterThanOrEqual(5);
    const dates = holidays.map(h => h.date);
    expect(dates).toContain('2026-01-01');
    expect(dates).toContain('2026-12-02');
  });

  it('excludes observances (Mother\'s Day etc.)', () => {
    const holidays = getPublicHolidays('UK', 2025);
    const names = holidays.map(h => h.name);
    expect(names).not.toContain("Mother's Day");
    expect(names).not.toContain("Father's Day");
  });

  it('memoises results across calls', () => {
    const first = getPublicHolidays('UK', 2025);
    const second = getPublicHolidays('UK', 2025);
    expect(first).toBe(second);
  });
});

describe('holidayDatesForEntity', () => {
  it('returns UK holidays for autonize-it-ltd within a window', () => {
    const dates = holidayDatesForEntity('autonize-it-ltd', '2025-08-01', '2025-12-31');
    expect(dates.has('2025-08-25')).toBe(true);
    expect(dates.has('2025-12-25')).toBe(true);
    expect(dates.has('2025-12-26')).toBe(true);
    expect(dates.has('2025-01-01')).toBe(false);
  });

  it('returns UAE holidays for autonize-it-fzco within a window', () => {
    const dates = holidayDatesForEntity('autonize-it-fzco', '2026-01-01', '2026-06-30');
    expect(dates.has('2026-01-01')).toBe(true);
    expect(dates.size).toBeGreaterThanOrEqual(1);
  });

  it('spans multiple years when the window crosses a year boundary', () => {
    const dates = holidayDatesForEntity('autonize-it-ltd', '2025-12-01', '2026-01-31');
    expect(dates.has('2025-12-25')).toBe(true);
    expect(dates.has('2025-12-26')).toBe(true);
    expect(dates.has('2026-01-01')).toBe(true);
  });

  it('returns empty set for an empty window', () => {
    const dates = holidayDatesForEntity('autonize-it-ltd', '2025-06-01', '2025-06-30');
    expect(dates.size).toBe(0);
  });
});
