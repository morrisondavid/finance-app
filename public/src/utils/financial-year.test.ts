import { describe, it, expect } from 'vitest';
import { getCurrentFinancialYearLabel, shiftFinancialYear } from './financial-year';

describe('getCurrentFinancialYearLabel', () => {
  it('returns the previous calendar year as FY start for dates in Jan-Apr', () => {
    expect(getCurrentFinancialYearLabel(new Date(2026, 2, 15))).toBe('2025/26'); // March 2026
  });

  it('returns the current calendar year as FY start for dates in May-Dec', () => {
    expect(getCurrentFinancialYearLabel(new Date(2026, 5, 1))).toBe('2026/27'); // June 2026
  });

  it('treats May 1st as the start of a new FY', () => {
    expect(getCurrentFinancialYearLabel(new Date(2026, 4, 1))).toBe('2026/27'); // May 1 2026
  });

  it('treats April 30th as still in the previous FY', () => {
    expect(getCurrentFinancialYearLabel(new Date(2026, 3, 30))).toBe('2025/26');
  });
});

describe('shiftFinancialYear', () => {
  it('shifts forward by +1', () => {
    expect(shiftFinancialYear('2025/26', 1)).toBe('2026/27');
  });

  it('shifts backward by -1', () => {
    expect(shiftFinancialYear('2025/26', -1)).toBe('2024/25');
  });

  it('shifts forward across the century boundary', () => {
    expect(shiftFinancialYear('2099/00', 1)).toBe('2100/01');
  });

  it('shifts by arbitrary deltas', () => {
    expect(shiftFinancialYear('2025/26', 5)).toBe('2030/31');
    expect(shiftFinancialYear('2025/26', -3)).toBe('2022/23');
  });

  it('throws on invalid format', () => {
    expect(() => shiftFinancialYear('2025-26', 1)).toThrow('Invalid financial year label');
    expect(() => shiftFinancialYear('invalid', 1)).toThrow('Invalid financial year label');
  });
});
