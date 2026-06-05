import { describe, it, expect, afterAll, vi, beforeEach } from 'vitest';
import { createInMemoryTestDb } from '../test-harness/in-memory-db.js';
import type { UkCompany } from '../../../shared/api-contracts.js';
import type { Invoice } from '../../domain/invoices/schema.js';
import { parseInvoiceRow } from '../../domain/invoices/csv-io.js';
import { dcInvoice001 } from '../../domain/invoices/test-helpers.js';

const harness = createInMemoryTestDb();

vi.mock('../connection.js', () => ({
  getDb: () => harness.db,
  OBLIGATIONS_DIR: harness.obligationsDir,
}));

const ukCompanyStandard: UkCompany = {
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

const ukCompanyCash: UkCompany = { ...ukCompanyStandard, vat_scheme: 'cash' };

const testInvoices: Invoice[] = [
  {
    ...parseInvoiceRow(dcInvoice001),
    id: 'UK-Q',
    invoice_date: '2026-03-01',
    vat_amount: 2200,
    status: 'issued',
    issuing_entity_id: 'autonize-it-ltd',
  },
];

let mockCompany: UkCompany = ukCompanyStandard;

vi.mock('../../domain/company/index.js', () => ({
  ukLtdCompanyOrNull: () => mockCompany,
}));

vi.mock('../../domain/invoices/index.js', async () => {
  const actual = await vi.importActual<typeof import('../../domain/invoices/index.js')>(
    '../../domain/invoices/index.js',
  );
  return {
    ...actual,
    allInvoices: () => testInvoices,
  };
});

vi.mock('./tax.js', () => ({
  findHmrcPayments: () => [],
}));

let hashSeq = 0;
function insertIncome(date: string, amount: number): void {
  hashSeq++;
  harness.db.prepare(`
    INSERT INTO transactions (hash, date, description, amount, account, type)
    VALUES (?, ?, 'Client payment', ?, 'barclays-current', 'income')
  `).run(`hash-${hashSeq}`, date, amount);
}

afterAll(() => {
  harness.cleanup();
});

beforeEach(() => {
  harness.db.exec('DELETE FROM transactions');
  harness.db.exec('DELETE FROM financial_obligations');
  hashSeq = 0;
  mockCompany = ukCompanyStandard;
  insertIncome('2026-02-15', 60000);
});

describe('deriveAndInsertAutoObligations — vat_scheme', () => {
  it('standard scheme uses invoice VAT for expectedAmount and bank proxy for naiveAmount', async () => {
    const { deriveAndInsertAutoObligations } = await import('./vat-auto-seed.js');
    deriveAndInsertAutoObligations();

    const row = harness.db.prepare(`
      SELECT expected_amount, naive_amount, adjustment_source, adjustment_basis
      FROM financial_obligations
      WHERE id = 'auto-vat-2026-02-01'
    `).get() as {
      expected_amount: number;
      naive_amount: number;
      adjustment_source: string;
      adjustment_basis: string;
    };

    expect(row.expected_amount).toBe(2200);
    expect(row.naive_amount).toBe(10000);
    expect(row.adjustment_source).toBe('invoices');
    expect(row.adjustment_basis).toBe('invoice output VAT (accrual basis)');
  });

  it('cash scheme keeps bank-based expectedAmount', async () => {
    mockCompany = ukCompanyCash;
    const { deriveAndInsertAutoObligations } = await import('./vat-auto-seed.js');
    deriveAndInsertAutoObligations();

    const row = harness.db.prepare(`
      SELECT expected_amount, naive_amount, adjustment_source
      FROM financial_obligations
      WHERE id = 'auto-vat-2026-02-01'
    `).get() as {
      expected_amount: number;
      naive_amount: number;
      adjustment_source: string;
    };

    expect(row.expected_amount).toBe(10000);
    expect(row.naive_amount).toBe(10000);
    expect(row.adjustment_source).not.toBe('invoices');
  });
});
