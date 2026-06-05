import { describe, it, expect } from 'vitest';
import type { Invoice, UkCompany } from '../../../shared/api-contracts.js';
import { parseInvoiceRow } from './csv-io.js';
import { dcInvoice001 } from './test-helpers.js';
import {
  resolveVatObligationAmounts,
  sumInvoiceOutputVatForQuarter,
} from './output-vat.js';
import type { VatQuarterRange } from '../../config/tax-rates.js';

const quarter: VatQuarterRange = {
  startDate: '2026-02-01',
  endDate: '2026-04-30',
  dueDate: '2026-06-07',
  label: 'Feb-Apr 2026',
  quarter: 2,
};

function makeInvoice(overrides: Partial<Invoice>): Invoice {
  return { ...parseInvoiceRow(dcInvoice001), ...overrides };
}

const ukCompany: UkCompany = {
  id: 'autonize-it-ltd',
  legal_name: 'Autonize IT Limited',
  trading_name: 'Autonize IT Ltd',
  kind: 'ltd',
  jurisdiction: 'UK',
  regulator: 'Companies House',
  company_number: '08842112',
  vat_number: '292 1465 96',
  license_number: null,
  registration_number: null,
  formation_date: '2014-01-13',
  address: '53 Heath Park Road',
  currency: 'GBP',
  bank_sort_code: '20-25-19',
  bank_account_number: '63648923',
  iban: null,
  swift_bic: null,
  email: 'dmorrison@autonize-it.com',
  logo_path: null,
  accountant_name: null,
  accountant_email: null,
  ct_registered: true,
  qfzp_elected: null,
  vat_registered: true,
  vat_scheme: 'standard',
  active: true,
  updated_at: '2026-04-22',
};

describe('sumInvoiceOutputVatForQuarter', () => {
  it('sums vat_amount for non-draft invoices with invoice_date in quarter', () => {
    const invoices: Invoice[] = [
      makeInvoice({
        id: 'UK-1',
        invoice_date: '2026-02-11',
        vat_amount: 500,
        status: 'issued',
        issuing_entity_id: 'autonize-it-ltd',
      }),
      makeInvoice({
        id: 'UK-2',
        invoice_date: '2026-03-01',
        vat_amount: 2200,
        status: 'paid',
        issuing_entity_id: 'autonize-it-ltd',
      }),
      makeInvoice({
        id: 'UK-3',
        invoice_date: '2026-01-31',
        vat_amount: 999,
        status: 'issued',
        issuing_entity_id: 'autonize-it-ltd',
      }),
    ];

    expect(
      sumInvoiceOutputVatForQuarter({
        entityId: 'autonize-it-ltd',
        startDate: quarter.startDate,
        endDate: quarter.endDate,
        invoices,
      }),
    ).toBe(2700);
  });

  it('excludes draft invoices and other entities', () => {
    const invoices: Invoice[] = [
      makeInvoice({
        id: 'UK-draft',
        invoice_date: '2026-02-15',
        vat_amount: 400,
        status: 'draft',
        issuing_entity_id: 'autonize-it-ltd',
      }),
      makeInvoice({
        id: 'FZ-1',
        invoice_date: '2026-03-01',
        vat_amount: 0,
        status: 'issued',
        issuing_entity_id: 'autonize-it-fzco',
      }),
    ];

    expect(
      sumInvoiceOutputVatForQuarter({
        entityId: 'autonize-it-ltd',
        startDate: quarter.startDate,
        endDate: quarter.endDate,
        invoices,
      }),
    ).toBe(0);
  });
});

describe('resolveVatObligationAmounts', () => {
  it('standard scheme uses invoice VAT for expectedAmount and bank proxy for naiveAmount', () => {
    const invoices: Invoice[] = [
      makeInvoice({
        id: 'UK-1',
        invoice_date: '2026-02-11',
        vat_amount: 500,
        status: 'issued',
      }),
      makeInvoice({
        id: 'UK-2',
        invoice_date: '2026-03-01',
        vat_amount: 2200,
        status: 'paid',
      }),
    ];

    const resolved = resolveVatObligationAmounts({
      quarter,
      quarterIncomeGross: 60000,
      entityId: 'autonize-it-ltd',
      vatScheme: 'standard',
      invoices,
      company: ukCompany,
    });

    expect(resolved.expectedAmount).toBe(2700);
    expect(resolved.naiveAmount).toBe(10000);
    expect(resolved.adjustmentSource).toBe('invoices');
    expect(resolved.adjustmentBasis).toBe('invoice output VAT (accrual basis)');
  });

  it('cash scheme keeps bank-based expectedAmount', () => {
    const resolved = resolveVatObligationAmounts({
      quarter,
      quarterIncomeGross: 60000,
      entityId: 'autonize-it-ltd',
      vatScheme: 'cash',
      invoices: [],
      company: ukCompany,
    });

    expect(resolved.expectedAmount).toBe(10000);
    expect(resolved.naiveAmount).toBe(10000);
    expect(resolved.adjustmentSource).not.toBe('invoices');
  });
});
