import { describe, it, expect } from 'vitest';
import {
  getFinancialYearRange,
  buildFYWhereClause,
  listMonthKeysInFinancialYear,
  listFyMonthKeysThroughDate,
  formatFinancialYearMonthLabel,
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
