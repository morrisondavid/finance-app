import { describe, it, expect } from 'vitest';
import { listSupplierMonthlyInvoiceGaps } from './supplier-month-gaps.js';
import { parseContractRow } from '../contracts/csv-io.js';
import { parseInvoiceRow } from './csv-io.js';
import { dcSowRow } from '../contracts/test-helpers.js';
import { dcInvoice001 } from './test-helpers.js';

const dc = parseContractRow(dcSowRow);

describe('listSupplierMonthlyInvoiceGaps', () => {
  it('emits a gap for a month with no covering invoice', () => {
    const gaps = listSupplierMonthlyInvoiceGaps({
      today: '2026-04-15',
      contracts: [dc],
      invoices: [],
    });
    expect(gaps.length).toBeGreaterThan(0);
    expect(gaps.some(g => g.month_start === '2026-03-01')).toBe(true);
  });

  it('omits months already covered by a non-draft invoice', () => {
    const inv = parseInvoiceRow({
      ...dcInvoice001,
      contract_id: dc.id,
      period_start: '2026-03-01',
      period_end: '2026-03-31',
      status: 'paid',
    });
    const gaps = listSupplierMonthlyInvoiceGaps({
      today: '2026-04-15',
      contracts: [dc],
      invoices: [inv],
    });
    expect(gaps.some(g => g.month_start === '2026-03-01')).toBe(false);
  });

  it('ignores draft invoices when deciding coverage', () => {
    const inv = parseInvoiceRow({
      ...dcInvoice001,
      contract_id: dc.id,
      period_start: '2026-03-01',
      period_end: '2026-03-31',
      status: 'draft',
    });
    const gaps = listSupplierMonthlyInvoiceGaps({
      today: '2026-04-15',
      contracts: [dc],
      invoices: [inv],
    });
    expect(gaps.some(g => g.month_start === '2026-03-01')).toBe(true);
  });
});
