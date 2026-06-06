import { describe, expect, it } from 'vitest';
import {
  corporationTaxDueDateForFy,
  listVatQuarterLabelsInFinancialYear,
  mostRecentlyEndedFyLabel,
  mostRecentlyEndedVatQuarterLabel,
  resolveReportingPeriod,
  vatQuarterLabel,
} from './period.js';

describe('resolveReportingPeriod', () => {
  it('resolves VAT Q2-2025 to Feb–Apr month keys', () => {
    const period = resolveReportingPeriod('vat', 'Q2-2025');
    expect(period.monthKeys).toEqual(['2025-02', '2025-03', '2025-04']);
    expect(period.startDate).toBe('2025-02-01');
    expect(period.endDate).toBe('2025-04-30');
    expect(period.label).toBe('Q2-2025');
  });

  it('resolves CT 2025/26 to 12 May–Apr month keys', () => {
    const period = resolveReportingPeriod('corporation_tax', '2025/26');
    expect(period.monthKeys).toHaveLength(12);
    expect(period.monthKeys[0]).toBe('2025-05');
    expect(period.monthKeys[11]).toBe('2026-04');
    expect(period.startDate).toBe('2025-05-01');
    expect(period.endDate).toBe('2026-04-30');
    expect(period.label).toBe('2025/26');
  });

  it('throws on invalid VAT label', () => {
    expect(() => resolveReportingPeriod('vat', 'bad')).toThrow(/Invalid VAT period/);
  });

  it('throws on invalid CT label', () => {
    expect(() => resolveReportingPeriod('corporation_tax', '2025')).toThrow(
      /Invalid corporation tax period/,
    );
  });
});

describe('vatQuarterLabel', () => {
  it('maps tax-rates range to Q2-2025', () => {
    expect(vatQuarterLabel({ quarter: 2, endDate: '2025-04-30' })).toBe('Q2-2025');
  });
});

describe('mostRecentlyEnded period helpers', () => {
  it('mostRecentlyEndedVatQuarterLabel returns a Q{n}-YYYY string', () => {
    const label = mostRecentlyEndedVatQuarterLabel(new Date('2026-06-03'));
    expect(label).toMatch(/^Q[1-4]-\d{4}$/);
  });

  it('mostRecentlyEndedFyLabel returns a YYYY/YY string', () => {
    const label = mostRecentlyEndedFyLabel(new Date('2026-06-03'));
    expect(label).toMatch(/^\d{4}\/\d{2}$/);
  });
});

describe('listVatQuarterLabelsInFinancialYear', () => {
  it('returns the four Stagger-2 quarters overlapping FY 2025/26', () => {
    expect(listVatQuarterLabelsInFinancialYear('2025/26')).toEqual([
      'Q3-2025',
      'Q4-2025',
      'Q1-2026',
      'Q2-2026',
    ]);
  });
});

describe('corporationTaxDueDateForFy', () => {
  it('is FY end + 9 months + 1 day', () => {
    expect(corporationTaxDueDateForFy('2025/26')).toBe('2027-01-31');
  });
});
