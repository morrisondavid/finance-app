import { describe, expect, it } from 'vitest';
import type { ReportingReadinessResponse } from '../../../shared/api-contracts.js';
import { deriveAccountantPackIncompleteWarnings } from './accountant-pack-incomplete.js';

function makeReadiness(overrides: Partial<ReportingReadinessResponse> = {}): ReportingReadinessResponse {
  return {
    entityId: 'autonize-it-ltd',
    regime: 'vat',
    periodLabel: 'Q2-2025',
    periodStartDate: '2025-02-01',
    periodEndDate: '2025-04-30',
    ready: false,
    accountsOverview: [
      {
        account: 'barclays-current',
        accountLabel: 'Barclays Current',
        ready: false,
        missingDocCount: 1,
      },
    ],
    present: [],
    missing: [
      {
        account: 'barclays-current',
        accountLabel: 'Barclays Current',
        monthKey: '2025-03',
        docType: 'pdf',
      },
    ],
    invoices: {
      requiredCount: 1,
      presentCount: 0,
      missingInvoiceNumbers: ['DC-011'],
    },
    generatedAt: '2026-06-03T00:00:00.000Z',
    ...overrides,
  };
}

describe('deriveAccountantPackIncompleteWarnings', () => {
  it('emits no warning before grace period ends', () => {
    const warnings = deriveAccountantPackIncompleteWarnings([
      {
        entityId: 'autonize-it-ltd',
        regime: 'vat',
        periodLabel: 'Q2-2025',
        readiness: makeReadiness(),
        graceDays: 7,
        today: '2025-05-05',
      },
    ]);
    expect(warnings).toHaveLength(0);
  });

  it('emits no warning when pack is ready', () => {
    const warnings = deriveAccountantPackIncompleteWarnings([
      {
        entityId: 'autonize-it-ltd',
        regime: 'vat',
        periodLabel: 'Q2-2025',
        readiness: makeReadiness({
          ready: true,
          missing: [],
          accountsOverview: [
            {
              account: 'barclays-current',
              accountLabel: 'Barclays Current',
              ready: true,
              missingDocCount: 0,
            },
          ],
          invoices: { requiredCount: 0, presentCount: 0, missingInvoiceNumbers: [] },
        }),
        graceDays: 7,
        today: '2025-05-10',
      },
    ]);
    expect(warnings).toHaveLength(0);
  });

  it('emits VAT warning after grace with explicit per-document detail', () => {
    const warnings = deriveAccountantPackIncompleteWarnings([
      {
        entityId: 'autonize-it-ltd',
        regime: 'vat',
        periodLabel: 'Q2-2025',
        readiness: makeReadiness(),
        graceDays: 7,
        today: '2025-05-10',
      },
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe('accountant-pack-incomplete-vat');
    expect(warnings[0].detail).toContain('Barclays Current');
    expect(warnings[0].detail).toContain('Mar 2025');
    expect(warnings[0].detail).toContain('PDF statement');
    expect(warnings[0].detail).toContain('DC-011');
    expect(warnings[0].context?.missingSummary).toContain('Barclays Current');
    expect(warnings[0].context?.missingSummary).toContain('DC-011');
  });

  it('emits CT warning for corporation_tax regime', () => {
    const warnings = deriveAccountantPackIncompleteWarnings([
      {
        entityId: 'autonize-it-ltd',
        regime: 'corporation_tax',
        periodLabel: '2024/25',
        readiness: makeReadiness({
          regime: 'corporation_tax',
          periodLabel: '2024/25',
          periodEndDate: '2025-04-30',
        }),
        graceDays: 7,
        today: '2025-05-10',
      },
    ]);
    expect(warnings[0].code).toBe('accountant-pack-incomplete-ct');
  });

  it('does not emit a filing warning for date_range', () => {
    const warnings = deriveAccountantPackIncompleteWarnings([
      {
        entityId: 'autonize-it-ltd',
        regime: 'date_range',
        periodLabel: '2025-01_2026-02',
        readiness: makeReadiness({
          regime: 'date_range',
          periodLabel: '2025-01_2026-02',
          periodStartDate: '2025-01-01',
          periodEndDate: '2026-02-28',
        }),
        graceDays: 7,
        today: '2026-04-01',
      },
    ]);
    expect(warnings).toHaveLength(0);
  });
});
