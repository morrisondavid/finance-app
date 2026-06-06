import { describe, expect, it } from 'vitest';
import type { Invoice } from '../../../shared/api-contracts.js';
import { computeReportingReadiness } from './readiness.js';

function allMonthsForUkLtdVatQ2(): (account: string, docType: 'pdf' | 'csv') => Set<string> {
  const keys = new Set(['2025-02', '2025-03', '2025-04']);
  return () => keys;
}

describe('computeReportingReadiness', () => {
  it('returns ready when all docs and no invoices required in period', () => {
    const result = computeReportingReadiness(
      { entityId: 'autonize-it-ltd', regime: 'vat', periodLabel: 'Q2-2025' },
      { monthsOnDisk: allMonthsForUkLtdVatQ2(), invoicesForEntity: () => [] },
    );
    expect(result.ready).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  it('flags missing CSV for barclays-current', () => {
    const result = computeReportingReadiness(
      { entityId: 'autonize-it-ltd', regime: 'vat', periodLabel: 'Q2-2025' },
      {
        monthsOnDisk: (account, docType) => {
          if (account === 'barclays-current' && docType === 'csv') {
            return new Set(['2025-02', '2025-03']);
          }
          return new Set(['2025-02', '2025-03', '2025-04']);
        },
        invoicesForEntity: () => [],
      },
    );
    expect(result.ready).toBe(false);
    expect(
      result.missing.some(
        m =>
          m.account === 'barclays-current' &&
          m.docType === 'csv' &&
          m.monthKey === '2025-04',
      ),
    ).toBe(true);
  });

  it('flags missing PDF for barclaycard', () => {
    const result = computeReportingReadiness(
      { entityId: 'autonize-it-ltd', regime: 'vat', periodLabel: 'Q2-2025' },
      {
        monthsOnDisk: (account, docType) => {
          if (account === 'barclaycard' && docType === 'pdf') {
            return new Set();
          }
          return new Set(['2025-02', '2025-03', '2025-04']);
        },
        invoicesForEntity: () => [],
      },
    );
    expect(result.ready).toBe(false);
    expect(
      result.missing.some(
        m =>
          m.account === 'barclaycard' &&
          m.docType === 'pdf' &&
          m.monthKey === '2025-02',
      ),
    ).toBe(true);
    const barclaycardOverview = result.accountsOverview.find(
      o => o.account === 'barclaycard',
    );
    expect(barclaycardOverview?.ready).toBe(false);
    expect(barclaycardOverview?.missingDocCount).toBeGreaterThan(0);
  });

  it('flags missing invoice PDF in period', () => {
    const invoice: Invoice = {
      id: 'DC-011',
      contract_id: 'dc-sow-2026',
      client_id: 'delta-capita',
      issuing_entity_id: 'autonize-it-ltd',
      invoice_number: 'DC-011',
      payment_reference: 'DC-011',
      invoice_date: '2025-03-15',
      period_start: '2025-03-01',
      period_end: '2025-03-31',
      days_billed: 20,
      description: 'test',
      currency: 'GBP',
      subtotal: 100,
      vat_rate: 0.2,
      vat_amount: 20,
      total: 120,
      fx_rate_at_issue: null,
      fx_base_currency: null,
      mechanism: 'supplier-issued',
      status: 'issued',
      due_date: '2025-04-15',
      created_at: '2025-03-01',
      updated_at: null,
    };

    const result = computeReportingReadiness(
      { entityId: 'autonize-it-ltd', regime: 'vat', periodLabel: 'Q2-2025' },
      {
        monthsOnDisk: allMonthsForUkLtdVatQ2(),
        invoicesForEntity: () => [invoice],
        invoicePdfExists: () => false,
      },
    );
    expect(result.ready).toBe(false);
    expect(result.invoices.missingInvoiceNumbers).toContain('DC-011');
  });

  it('does not flag Wise for months before bankOpenedDate in a VAT quarter', () => {
    const result = computeReportingReadiness(
      { entityId: 'autonize-it-ltd', regime: 'vat', periodLabel: 'Q3-2025' },
      { monthsOnDisk: () => new Set(), invoicesForEntity: () => [] },
    );
    const wiseMissing = result.missing.filter(m => m.account === 'wise-ltd');
    expect(wiseMissing).toHaveLength(0);
    expect(result.missing.some(m => m.account === 'barclays-current')).toBe(true);
  });

  it('requires Wise statements only from bankOpenedDate month in a CT financial year', () => {
    const result = computeReportingReadiness(
      { entityId: 'autonize-it-ltd', regime: 'corporation_tax', periodLabel: '2025/26' },
      { monthsOnDisk: () => new Set(), invoicesForEntity: () => [] },
    );
    const wiseMissing = result.missing.filter(m => m.account === 'wise-ltd');
    expect(wiseMissing.some(m => m.monthKey === '2025-05')).toBe(false);
    expect(wiseMissing.some(m => m.monthKey === '2025-11')).toBe(false);
    expect(wiseMissing.some(m => m.monthKey === '2025-12')).toBe(true);
    expect(wiseMissing.some(m => m.monthKey === '2026-04')).toBe(true);
  });
});
