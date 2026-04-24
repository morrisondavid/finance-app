import { describe, it, expect } from 'vitest';
import {
  round2,
  formatCurrency,
  currencySymbol,
  formatAccountName,
  formatMonthYear,
  formatQuarterName,
  formatIsoDateUk,
  formatIsoDateUkLong,
} from './formatting.js';
import * as sharedFormatting from '../../../shared/formatting.js';

// Tests for `formatCurrency`, `currencySymbol`, `formatMonthYear`,
// `formatIsoDateUk`, and `formatIsoDateUkLong` live in
// `shared/formatting.test.ts` — those helpers have been lifted to the
// shared module. The shim identity tests below ensure the re-exports in
// this file do not silently diverge from the shared originals.

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
    expect(round2(-99_999_999.995)).toBe(-99_999_999.99);
    expect(round2(-1_234_567.891)).toBe(-1_234_567.89);
  });

  it('applies Math.round at the scaled hundredths boundary (asymmetric for ±0.125)', () => {
    expect(round2(0.125)).toBe(0.13);
    expect(round2(-0.125)).toBe(-0.12);
  });

  it('documents floating-point limits around binary representation (not true bank rounding)', () => {
    expect(round2(1.005)).toBe(1);
    expect(round2(2.675)).toBe(2.68);
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

describe('shared re-export shim', () => {
  it('re-exports currency + date helpers that reference-equal the shared originals', () => {
    expect(formatCurrency).toBe(sharedFormatting.formatCurrency);
    expect(currencySymbol).toBe(sharedFormatting.currencySymbol);
    expect(formatMonthYear).toBe(sharedFormatting.formatMonthYear);
    expect(formatIsoDateUk).toBe(sharedFormatting.formatIsoDateUk);
    expect(formatIsoDateUkLong).toBe(sharedFormatting.formatIsoDateUkLong);
  });
});
