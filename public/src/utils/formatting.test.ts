import { describe, it, expect } from 'vitest';
import {
  round2,
  formatCurrency,
  formatAccountName,
  formatMonthYear,
  formatQuarterName,
  formatIsoDateUk,
} from './formatting';

describe('round2', () => {
  it('rounds to two decimal places for typical fractional values', () => {
    expect(round2(2.345)).toBe(2.35);
    expect(round2(1.234)).toBe(1.23);
    expect(round2(9.876)).toBe(9.88);
  });

  it('leaves values that are already at two decimals unchanged', () => {
    expect(round2(0)).toBe(0);
    expect(round2(10)).toBe(10);
    expect(round2(3.14)).toBe(3.14);
  });

  it('handles negative numbers symmetrically with Math.round semantics', () => {
    expect(round2(-2.345)).toBe(-2.35);
    expect(round2(-1.234)).toBe(-1.23);
    expect(round2(-0.005)).toBe(-0);
  });

  it('handles large magnitudes', () => {
    expect(round2(1_234_567.896)).toBe(1_234_567.9);
    // IEEE-754: -99_999_999.995 * 100 is not exactly half, so rounding stays just below -100M
    expect(round2(-99_999_999.995)).toBe(-99_999_999.99);
    expect(round2(-1_234_567.891)).toBe(-1_234_567.89);
  });

  it('applies Math.round at the scaled hundredths boundary (asymmetric for ±0.125)', () => {
    // Positive half rounds up; negative half rounds toward +∞ per ECMA-262 (e.g. -12.5 → -12)
    expect(round2(0.125)).toBe(0.13);
    expect(round2(-0.125)).toBe(-0.12);
  });

  it('documents floating-point limits around binary representation (not true bank rounding)', () => {
    // 1.005 * 100 is not exactly 100.5 in IEEE-754; result follows multiply-then-round
    expect(round2(1.005)).toBe(1);
    expect(round2(2.675)).toBe(2.68);
  });
});

describe('formatCurrency', () => {
  it('formats positive amounts as en-GB GBP', () => {
    expect(formatCurrency(0)).toBe('£0.00');
    expect(formatCurrency(1)).toBe('£1.00');
    expect(formatCurrency(1234.56)).toBe('£1,234.56');
  });

  it('formats negative amounts with a leading minus before the symbol', () => {
    expect(formatCurrency(-1)).toBe('-£1.00');
    expect(formatCurrency(-1234.56)).toBe('-£1,234.56');
  });

  it('formats large values with grouping separators', () => {
    expect(formatCurrency(1_000_000.01)).toBe('£1,000,000.01');
  });
});

describe('formatAccountName', () => {
  it('converts kebab-case to title case with spaces', () => {
    expect(formatAccountName('barclays-current')).toBe('Barclays Current');
    expect(formatAccountName('hsbc-business')).toBe('Hsbc Business');
    expect(formatAccountName('monzo-personal-joint')).toBe('Monzo Personal Joint');
  });

  it('handles single-segment names', () => {
    expect(formatAccountName('savings')).toBe('Savings');
  });
});

describe('formatMonthYear', () => {
  it('maps YYYY-MM to short month and year', () => {
    expect(formatMonthYear('2024-11')).toBe('Nov 2024');
    expect(formatMonthYear('2025-03')).toBe('Mar 2025');
  });

  it('handles January and December', () => {
    expect(formatMonthYear('2024-01')).toBe('Jan 2024');
    expect(formatMonthYear('2026-12')).toBe('Dec 2026');
  });

  it('handles months with single-digit string parts', () => {
    expect(formatMonthYear('2024-06')).toBe('Jun 2024');
  });
});

describe('formatQuarterName', () => {
  it('formats Q1 with cross-year Nov–Jan span and short end year', () => {
    expect(formatQuarterName('Q1-2025')).toBe('VAT-Q1-Nov-Jan-2024-25');
  });

  it('formats Q2, Q3, and Q4 with in-year month ranges', () => {
    expect(formatQuarterName('Q2-2025')).toBe('VAT-Q2-Feb-Apr-2025');
    expect(formatQuarterName('Q3-2025')).toBe('VAT-Q3-May-Jul-2025');
    expect(formatQuarterName('Q4-2025')).toBe('VAT-Q4-Aug-Oct-2025');
  });

  it('returns the original string when the pattern does not match', () => {
    expect(formatQuarterName('')).toBe('');
    expect(formatQuarterName('Q1')).toBe('Q1');
    expect(formatQuarterName('Q1-25')).toBe('Q1-25');
    expect(formatQuarterName('Q5-2025')).toBe('Q5-2025');
    expect(formatQuarterName('q1-2025')).toBe('q1-2025');
    expect(formatQuarterName('Q1-2025-extra')).toBe('Q1-2025-extra');
  });
});

describe('formatIsoDateUk', () => {
  it('formats YYYY-MM-DD as en-GB day-first', () => {
    expect(formatIsoDateUk('2025-03-07')).toMatch(/7\/3\/2025|07\/03\/2025/);
  });

  it('returns the input unchanged when not a plain ISO date or calendar-invalid', () => {
    expect(formatIsoDateUk('')).toBe('');
    expect(formatIsoDateUk('2025-02-30')).toBe('2025-02-30');
    expect(formatIsoDateUk('n/a')).toBe('n/a');
  });
});
