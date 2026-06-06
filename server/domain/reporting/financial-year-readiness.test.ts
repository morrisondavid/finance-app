import { describe, it, expect } from 'vitest';
import { computeFinancialYearReadinessOverview } from './financial-year-readiness.js';
import type { ReadinessDeps } from './readiness.js';

function allMonthsForUkLtdFy202526(): ReadinessDeps['monthsOnDisk'] {
  const keys = new Set([
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
  return () => keys;
}

const allPresentDeps: ReadinessDeps = {
  monthsOnDisk: allMonthsForUkLtdFy202526(),
  invoicesForEntity: () => [],
  invoicePdfExists: () => true,
};

describe('computeFinancialYearReadinessOverview', () => {
  it('includes CT FY + four VAT quarters', () => {
    const overview = computeFinancialYearReadinessOverview(
      { entityId: 'autonize-it-ltd', financialYear: '2025/26' },
      allPresentDeps,
    );
    expect(overview.financialYear).toBe('2025/26');
    expect(overview.corporationTax.regime).toBe('corporation_tax');
    expect(overview.vatQuarters.map(q => q.periodLabel)).toEqual([
      'Q3-2025',
      'Q4-2025',
      'Q1-2026',
      'Q2-2026',
    ]);
    expect(overview.aggregate).toHaveProperty('ready');
  });
});
