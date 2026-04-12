import { describe, it, expect } from 'vitest';
import { getFinancialYearRange, buildFYWhereClause } from '../financial-year.js';

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
