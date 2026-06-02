import { describe, it, expect } from 'vitest';
import {
  ordinal,
  formatCurrency,
  currencySymbol,
  formatMonthYear,
  formatIsoDateUk,
  formatIsoDateUkLong,
  formatQuarterName,
  formatFinancialYearPackName,
  formatReportingMissingDocLabel,
} from './formatting.js';

describe('ordinal', () => {
  it('returns standard ordinal suffixes for 1..21', () => {
    expect(ordinal(1)).toBe('1st');
    expect(ordinal(2)).toBe('2nd');
    expect(ordinal(3)).toBe('3rd');
    expect(ordinal(4)).toBe('4th');
    expect(ordinal(11)).toBe('11th');
    expect(ordinal(12)).toBe('12th');
    expect(ordinal(13)).toBe('13th');
    expect(ordinal(21)).toBe('21st');
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

  it('formats AED amounts when currency is AED', () => {
    const result = formatCurrency(4200, 'AED');
    expect(result).toContain('4,200');
    expect(result).toContain('AED');
  });

  it('defaults to GBP when no currency is specified', () => {
    expect(formatCurrency(100)).toBe('£100.00');
  });
});

describe('currencySymbol', () => {
  it('returns £ for GBP', () => {
    expect(currencySymbol('GBP')).toBe('£');
  });

  it('returns AED for AED', () => {
    expect(currencySymbol('AED')).toBe('AED');
  });

  it('defaults to £ when no argument is provided', () => {
    expect(currencySymbol()).toBe('£');
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

describe('formatReportingMissingDocLabel', () => {
  it('formats PDF and CSV with readable months', () => {
    expect(formatReportingMissingDocLabel('pdf', '2025-03')).toBe('PDF statement — Mar 2025');
    expect(formatReportingMissingDocLabel('csv', '2025-02')).toBe('Transaction CSV — Feb 2025');
  });
});

describe('formatQuarterName', () => {
  it('formats Q1-2025 with cross-year label', () => {
    expect(formatQuarterName('Q1-2025')).toBe('VAT-Q1-Nov-Jan-2024-25');
  });

  it('formats Q2-2025', () => {
    expect(formatQuarterName('Q2-2025')).toBe('VAT-Q2-Feb-Apr-2025');
  });

  it('returns input unchanged for invalid quarter', () => {
    expect(formatQuarterName('bad')).toBe('bad');
  });
});

describe('formatFinancialYearPackName', () => {
  it('formats 2025/26', () => {
    expect(formatFinancialYearPackName('2025/26')).toBe('CorporationTax-FY-2025-26');
  });

  it('accepts hyphenated FY label', () => {
    expect(formatFinancialYearPackName('2024-25')).toBe('CorporationTax-FY-2024-25');
  });

  it('returns passthrough for invalid label', () => {
    expect(formatFinancialYearPackName('bad')).toBe('CorporationTax-FY-bad');
  });
});

describe('formatIsoDateUkLong', () => {
  it('formats YYYY-MM-DD as "DD Mmm YYYY"', () => {
    expect(formatIsoDateUkLong('2026-06-07')).toBe('07 Jun 2026');
    expect(formatIsoDateUkLong('2025-01-01')).toBe('01 Jan 2025');
    expect(formatIsoDateUkLong('2024-12-31')).toBe('31 Dec 2024');
  });

  it('zero-pads single-digit days', () => {
    expect(formatIsoDateUkLong('2025-05-04')).toBe('04 May 2025');
  });

  it('returns the input unchanged when not a plain ISO date or calendar-invalid', () => {
    expect(formatIsoDateUkLong('')).toBe('');
    expect(formatIsoDateUkLong('2025-02-30')).toBe('2025-02-30');
    expect(formatIsoDateUkLong('n/a')).toBe('n/a');
  });
});
