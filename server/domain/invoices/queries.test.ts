/**
 * Query purity for the invoices domain.
 *
 * Every query is driven via a fixture registry so the same function
 * over different data produces the expected result. Pure by
 * construction — no global state dependency.
 */

import { describe, it, expect } from 'vitest';
import {
  allInvoices,
  findInvoiceById,
  latestInvoiceForContract,
  listInvoicesByContractId,
  listInvoicesByIssuingEntityId,
  listInvoicesByStatus,
  listUnpaidInvoicesForForecast,
} from './queries.js';
import { makeTestInvoiceRegistry } from './fixtures.js';
import { buildInvoiceRegistryFromData } from './registry.js';
import { buildInvoicePaymentRegistryFromData } from './payments-registry.js';
import { parseInvoiceRow } from './csv-io.js';
import { dcInvoice001, dcInvoice002, fzcoInvoice001 } from './test-helpers.js';

const full = makeTestInvoiceRegistry({
  invoices: [
    parseInvoiceRow(dcInvoice001),
    parseInvoiceRow(dcInvoice002),
    parseInvoiceRow(fzcoInvoice001),
  ],
});

describe('allInvoices', () => {
  it('returns the canonical ordered list', () => {
    expect(allInvoices(full).map(i => i.id)).toEqual(['DC-001', 'DC-002', 'FZ-0001']);
  });

  it('returns an empty list on an empty registry', () => {
    expect(allInvoices(buildInvoiceRegistryFromData([]))).toEqual([]);
  });
});

describe('findInvoiceById', () => {
  it('returns the matching invoice', () => {
    expect(findInvoiceById('DC-001', full)?.contract_id).toBe('dc-sow-2025-jun');
  });

  it('returns null for unknown ids', () => {
    expect(findInvoiceById('DC-999', full)).toBeNull();
  });
});

describe('listInvoicesByContractId', () => {
  it('returns invoices sorted by invoice_date ascending', () => {
    const rows = listInvoicesByContractId('dc-sow-2025-jun', full);
    expect(rows.map(r => r.id)).toEqual(['DC-001', 'DC-002']);
  });

  it('returns an empty list for unknown contract ids', () => {
    expect(listInvoicesByContractId('unknown-contract', full)).toEqual([]);
  });
});

describe('listInvoicesByIssuingEntityId', () => {
  it('partitions by entity', () => {
    expect(listInvoicesByIssuingEntityId('autonize-it-ltd', full).map(r => r.id)).toEqual([
      'DC-001',
      'DC-002',
    ]);
    expect(listInvoicesByIssuingEntityId('autonize-it-fzco', full).map(r => r.id)).toEqual([
      'FZ-0001',
    ]);
  });
});

describe('listInvoicesByStatus', () => {
  it('returns invoices in a given status', () => {
    expect(listInvoicesByStatus('paid', full).map(r => r.id)).toEqual(['DC-001', 'DC-002']);
    expect(listInvoicesByStatus('issued', full).map(r => r.id)).toEqual(['FZ-0001']);
  });

  it('returns an empty list for an unused status', () => {
    expect(listInvoicesByStatus('draft', full)).toEqual([]);
  });
});

describe('listUnpaidInvoicesForForecast', () => {
  it('excludes issued invoices fully covered by payment rows', () => {
    const issued = parseInvoiceRow({
      ...fzcoInvoice001,
      id: 'FZ-0099',
      invoice_number: 'FZ-0099',
      payment_reference: 'FZ-0099',
      status: 'issued',
      total: '2000',
      subtotal: '2000',
      vat_amount: '0',
    });
    const stillDue = parseInvoiceRow(fzcoInvoice001);
    const invoiceReg = buildInvoiceRegistryFromData([issued, stillDue]);
    const paymentReg = buildInvoicePaymentRegistryFromData([
      {
        id: 'ip-fz-paid',
        invoice_id: 'FZ-0099',
        bank_transaction_id: 'tx-1',
        payment_date: '2026-06-01',
        amount_paid: 2000,
        deposit_currency: 'GBP',
        fx_rate_at_payment: null,
        amount_in_invoice_currency: 2000,
        fx_gain_loss: 0,
        residual: 0,
        created_at: '2026-06-01',
        updated_at: null,
      },
    ]);

    expect(listUnpaidInvoicesForForecast(invoiceReg, paymentReg).map(i => i.id)).toEqual([
      'FZ-0001',
    ]);
  });
});

describe('latestInvoiceForContract', () => {
  it('returns the invoice with the greatest invoice_date', () => {
    expect(latestInvoiceForContract('dc-sow-2025-jun', full)?.id).toBe('DC-002');
  });

  it('returns null when the contract has no invoices', () => {
    expect(latestInvoiceForContract('unknown', full)).toBeNull();
  });
});
