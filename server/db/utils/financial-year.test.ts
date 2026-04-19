import { describe, it, expect } from 'vitest';
import {
  getFinancialYearRange,
  getFinancialYearForDate,
  getPreviousFyStartDate,
  buildFYWhereClause,
  buildFyWhereClauseForColumn,
  listMonthKeysInFinancialYear,
  listFyMonthKeysThroughDate,
  formatFinancialYearMonthLabel,
  getObligationsPageWindow,
} from './financial-year.js';

describe('getFinancialYearRange', () => {
  it('should parse YYYY/YY format correctly', () => {
    const range = getFinancialYearRange('2024/25');
    expect(range.startDate).toBe('2024-05-01');
    expect(range.endDate).toBe('2025-04-30');
    expect(range.label).toBe('2024/25');
  });

  it('should parse YYYY-YY format correctly', () => {
    const range = getFinancialYearRange('2024-25');
    expect(range.startDate).toBe('2024-05-01');
    expect(range.endDate).toBe('2025-04-30');
    expect(range.label).toBe('2024/25');
  });

  it('should throw for invalid format', () => {
    expect(() => getFinancialYearRange('2024')).toThrow('Invalid financial year format');
    expect(() => getFinancialYearRange('invalid')).toThrow('Invalid financial year format');
    expect(() => getFinancialYearRange('2024/2025')).toThrow('Invalid financial year format');
  });

  describe('Financial year boundaries', () => {
    it('should start on May 1st', () => {
      const range = getFinancialYearRange('2025/26');
      expect(range.startDate).toBe('2025-05-01');
    });

    it('should end on April 30th', () => {
      const range = getFinancialYearRange('2025/26');
      expect(range.endDate).toBe('2026-04-30');
    });
  });
});

describe('listMonthKeysInFinancialYear', () => {
  it('returns 12 keys from May through April', () => {
    expect(listMonthKeysInFinancialYear('2025/26')).toEqual([
      '2025-05',
      '2025-06',
      '2025-07',
      '2025-08',
      '2025-09',
      '2025-10',
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
    ]);
  });

  it('accepts hyphen FY label', () => {
    expect(listMonthKeysInFinancialYear('2024-25')[0]).toBe('2024-05');
    expect(listMonthKeysInFinancialYear('2024-25')).toHaveLength(12);
  });
});

describe('formatFinancialYearMonthLabel', () => {
  it('formats YYYY-MM for display', () => {
    expect(formatFinancialYearMonthLabel('2025-05')).toContain('May');
    expect(formatFinancialYearMonthLabel('2025-05')).toContain('2025');
    expect(formatFinancialYearMonthLabel('2026-04')).toContain('April');
    expect(formatFinancialYearMonthLabel('2026-04')).toContain('2026');
  });
});

describe('listFyMonthKeysThroughDate', () => {
  const fy = '2025/26';
  const all = listMonthKeysInFinancialYear(fy);

  it('returns all 12 months when asOf is after the FY ends', () => {
    const asOf = new Date(2026, 6, 1); // Jul 2026 — after 2026-04-30
    expect(listFyMonthKeysThroughDate(fy, asOf)).toEqual(all);
  });

  it('returns empty when FY has not started yet', () => {
    const asOf = new Date(2025, 3, 1); // Apr 2025 — before 2025-05-01
    expect(listFyMonthKeysThroughDate(fy, asOf)).toEqual([]);
  });

  it('returns months from May through current month when inside the FY', () => {
    const asOf = new Date(2025, 11, 15); // Dec 2025 local
    expect(listFyMonthKeysThroughDate(fy, asOf)).toEqual([
      '2025-05',
      '2025-06',
      '2025-07',
      '2025-08',
      '2025-09',
      '2025-10',
      '2025-11',
      '2025-12',
    ]);
  });

  it('caps at April when asOf is in the last month of the FY', () => {
    const asOf = new Date(2026, 3, 28); // Apr 2026
    expect(listFyMonthKeysThroughDate(fy, asOf)).toEqual(all);
  });
});

describe('buildFyWhereClauseForColumn', () => {
  it('returns empty clause when fy is undefined', () => {
    expect(buildFyWhereClauseForColumn(undefined, 'due_date')).toEqual({ clause: '', params: [] });
  });

  it('builds a clause targeting the given column', () => {
    const { clause, params } = buildFyWhereClauseForColumn('2025/26', 'due_date');
    expect(clause).toBe(' AND due_date >= ? AND due_date <= ?');
    expect(params).toEqual(['2025-05-01', '2026-04-30']);
  });

  it('supports arbitrary column names (e.g. `paid_date`)', () => {
    const { clause } = buildFyWhereClauseForColumn('2024/25', 'paid_date');
    expect(clause).toBe(' AND paid_date >= ? AND paid_date <= ?');
  });

  it('buildFYWhereClause remains a thin wrapper over the column helper for `date`', () => {
    const legacy = buildFYWhereClause('2025/26');
    const direct = buildFyWhereClauseForColumn('2025/26', 'date');
    expect(legacy).toEqual(direct);
  });
});

describe('getFinancialYearForDate', () => {
  it('returns correct FY for a date in the second half of the year (May onwards)', () => {
    expect(getFinancialYearForDate(new Date(2025, 5, 15))).toBe('2025/26'); // June 2025
  });

  it('returns correct FY for a date in the first half of the year (before May)', () => {
    expect(getFinancialYearForDate(new Date(2025, 2, 15))).toBe('2024/25'); // March 2025
  });

  it('returns correct FY for May 1st (start of new FY)', () => {
    expect(getFinancialYearForDate(new Date(2025, 4, 1))).toBe('2025/26');
  });

  it('returns correct FY for April 30th (end of FY)', () => {
    expect(getFinancialYearForDate(new Date(2025, 3, 30))).toBe('2024/25');
  });
});

describe('getPreviousFyStartDate', () => {
  it('returns previous FY start when in the second half of the year', () => {
    expect(getPreviousFyStartDate(new Date(2025, 5, 15))).toBe('2024-05-01'); // June 2025 → current FY 2025/26 → prev 2024/25
  });

  it('returns previous FY start when in the first half of the year', () => {
    expect(getPreviousFyStartDate(new Date(2025, 2, 15))).toBe('2023-05-01'); // March 2025 → current FY 2024/25 → prev 2023/24
  });

  it('returns previous FY start on May 1st', () => {
    expect(getPreviousFyStartDate(new Date(2025, 4, 1))).toBe('2024-05-01');
  });

  it('returns previous FY start on April 30th', () => {
    expect(getPreviousFyStartDate(new Date(2025, 3, 30))).toBe('2023-05-01'); // Apr 2025 → current FY 2024/25 → prev 2023/24
  });
});

describe('buildFYWhereClause', () => {
  it('should return empty clause for undefined financial year', () => {
    const result = buildFYWhereClause(undefined);
    expect(result.clause).toBe('');
    expect(result.params).toEqual([]);
  });

  it('should return date range clause for valid financial year', () => {
    const result = buildFYWhereClause('2024/25');
    expect(result.clause).toBe(' AND date >= ? AND date <= ?');
    expect(result.params).toEqual(['2024-05-01', '2025-04-30']);
  });
});

describe('getObligationsPageWindow', () => {
  it('returns a ±12 calendar-month window around the anchor date', () => {
    const anchor = new Date(2026, 3, 16); // 16 Apr 2026 (local)
    const win = getObligationsPageWindow(anchor);
    expect(win.today).toBe('2026-04-16');
    expect(win.startDate).toBe('2025-04-16');
    expect(win.endDate).toBe('2027-04-16');
  });

  it('produces a human label with short month + year on both ends', () => {
    const anchor = new Date(2026, 3, 16);
    const { label } = getObligationsPageWindow(anchor);
    expect(label).toMatch(/^Apr 2025\s+.+\s+Apr 2027$/);
  });

  it('clamps day-of-month when the target month is shorter', () => {
    // 31 Mar anchored → 12 months back (+/-) must not roll into another month.
    const anchor = new Date(2025, 2, 31); // 31 Mar 2025
    const win = getObligationsPageWindow(anchor);
    expect(win.today).toBe('2025-03-31');
    expect(win.startDate).toBe('2024-03-31');
    expect(win.endDate).toBe('2026-03-31');
  });

  it('handles 29 Feb (leap day) by clamping to 28 Feb on non-leap years', () => {
    const anchor = new Date(2024, 1, 29); // 29 Feb 2024 (leap)
    const win = getObligationsPageWindow(anchor);
    expect(win.today).toBe('2024-02-29');
    expect(win.startDate).toBe('2023-02-28');
    expect(win.endDate).toBe('2025-02-28');
  });

  it('crosses year boundaries cleanly', () => {
    const anchor = new Date(2026, 0, 5); // 5 Jan 2026
    const win = getObligationsPageWindow(anchor);
    expect(win.startDate).toBe('2025-01-05');
    expect(win.endDate).toBe('2027-01-05');
  });
});
