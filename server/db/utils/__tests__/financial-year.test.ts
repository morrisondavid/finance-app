import { describe, it, expect } from 'vitest';
import { getFinancialYearRange, buildFYWhereClause } from '../financial-year.js';

describe('getFinancialYearRange', () => {
  it('should parse YYYY/YY format correctly', () => {
    const range = getFinancialYearRange('2024/25');
    expect(range.startDate).toBe('2024-03-01');
    expect(range.endDate).toBe('2025-02-28');
    expect(range.label).toBe('2024/25');
  });

  it('should parse YYYY-YY format correctly', () => {
    const range = getFinancialYearRange('2024-25');
    expect(range.startDate).toBe('2024-03-01');
    expect(range.endDate).toBe('2025-02-28');
    expect(range.label).toBe('2024/25');
  });

  it('should handle leap years correctly', () => {
    // 2024 is a leap year, so 2023/24 ends on Feb 29, 2024
    const range = getFinancialYearRange('2023/24');
    expect(range.startDate).toBe('2023-03-01');
    expect(range.endDate).toBe('2024-02-29');
  });

  it('should handle non-leap years correctly', () => {
    // 2025 is not a leap year, so 2024/25 ends on Feb 28, 2025
    const range = getFinancialYearRange('2024/25');
    expect(range.endDate).toBe('2025-02-28');
  });

  it('should handle century years correctly', () => {
    // 2000 was a leap year (divisible by 400)
    const range = getFinancialYearRange('1999/00');
    expect(range.endDate).toBe('2000-02-29');
  });

  it('should throw for invalid format', () => {
    expect(() => getFinancialYearRange('2024')).toThrow('Invalid financial year format');
    expect(() => getFinancialYearRange('invalid')).toThrow('Invalid financial year format');
    expect(() => getFinancialYearRange('2024/2025')).toThrow('Invalid financial year format');
  });

  describe('Financial year boundaries', () => {
    it('should start on March 1st', () => {
      const range = getFinancialYearRange('2025/26');
      expect(range.startDate).toBe('2025-03-01');
    });

    it('should end on last day of February', () => {
      const range = getFinancialYearRange('2025/26');
      expect(range.endDate).toBe('2026-02-28');
    });
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
    expect(result.params).toEqual(['2024-03-01', '2025-02-28']);
  });
});
