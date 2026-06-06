/**
 * CSV round-trip tests for the invoices domain.
 *
 * Parsing produces typed `Invoice` values; serialising them back
 * produces CSV that re-parses to the same in-memory representation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import {
  parseInvoiceRow,
  readInvoicesCsvFile,
  serializeInvoicesCsv,
  writeInvoicesCsvFile,
  getInvoicesCsvPath,
  getInvoicePaymentsCsvPath,
  readInvoicePaymentsCsvFile,
  serializeInvoicePaymentsCsv,
  writeInvoicePaymentsCsvFile,
  INVOICE_CSV_HEADERS,
  INVOICE_PAYMENT_CSV_HEADERS,
} from './csv-io.js';
import {
  mkTmpDir,
  dcInvoice001,
  dcInvoice002,
  fzcoInvoice001,
  seedCsv,
} from './test-helpers.js';

describe('parseInvoiceRow', () => {
  it('parses a supplier-issued UK-entity Delta Capita invoice', () => {
    const inv = parseInvoiceRow(dcInvoice001);
    expect(inv.id).toBe('DC-001');
    expect(inv.mechanism).toBe('supplier-issued');
    expect(inv.issuing_entity_id).toBe('autonize-it-ltd');
    expect(inv.subtotal).toBe(3300);
    expect(inv.vat_amount).toBe(660);
    expect(inv.total).toBe(3960);
  });

  it('parses a self-bill FZCO invoice with zero VAT', () => {
    const inv = parseInvoiceRow(fzcoInvoice001);
    expect(inv.id).toBe('FZ-0001');
    expect(inv.mechanism).toBe('self-bill');
    expect(inv.vat_rate).toBe(0);
    expect(inv.vat_amount).toBe(0);
  });

  it('parses payment_reference as stored (matches invoice_number for DC fixtures)', () => {
    expect(parseInvoiceRow(dcInvoice002).payment_reference).toBe('DC-002');
  });

  it('throws on missing required column', () => {
    const { id: _id, ...rest } = dcInvoice001;
    void _id;
    expect(() => parseInvoiceRow(rest as Record<string, string>)).toThrow(/id is required/);
  });

  it('throws on malformed numeric column', () => {
    expect(() => parseInvoiceRow({ ...dcInvoice001, subtotal: 'not-a-number' })).toThrow(
      /subtotal must be a number/,
    );
  });
});

describe('serializeInvoicesCsv', () => {
  it('round-trips a set of invoices back through parse', () => {
    const parsed = [dcInvoice001, dcInvoice002, fzcoInvoice001].map(parseInvoiceRow);
    const csv = serializeInvoicesCsv(parsed);
    expect(csv.split('\n')[0]).toBe(INVOICE_CSV_HEADERS.join(','));

    // Write + re-read to confirm round-trip equivalence.
    const tmpDir = mkTmpDir();
    try {
      writeInvoicesCsvFile(getInvoicesCsvPath(tmpDir), parsed);
      const roundTripped = readInvoicesCsvFile(getInvoicesCsvPath(tmpDir));
      expect(roundTripped).toEqual(parsed);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('writes header-only on an empty array', () => {
    const csv = serializeInvoicesCsv([]);
    expect(csv).toBe(`${INVOICE_CSV_HEADERS.join(',')}\n`);
  });
});

describe('readInvoicesCsvFile', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = mkTmpDir(); });
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('returns [] for a missing file', () => {
    expect(readInvoicesCsvFile(getInvoicesCsvPath(tmpDir))).toEqual([]);
  });

  it('returns [] for a header-only file', () => {
    fs.writeFileSync(getInvoicesCsvPath(tmpDir), `${INVOICE_CSV_HEADERS.join(',')}\n`);
    expect(readInvoicesCsvFile(getInvoicesCsvPath(tmpDir))).toEqual([]);
  });

  it('parses seeded rows in order', () => {
    seedCsv(tmpDir, [dcInvoice001, dcInvoice002]);
    const parsed = readInvoicesCsvFile(getInvoicesCsvPath(tmpDir));
    expect(parsed.map(i => i.id)).toEqual(['DC-001', 'DC-002']);
  });
});

describe('invoice_payments CSV round-trip', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = mkTmpDir(); });
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('writes a header-only file when given no payments', () => {
    writeInvoicePaymentsCsvFile(getInvoicePaymentsCsvPath(tmpDir), []);
    const content = fs.readFileSync(getInvoicePaymentsCsvPath(tmpDir), 'utf8');
    expect(content).toBe(`${INVOICE_PAYMENT_CSV_HEADERS.join(',')}\n`);
    expect(readInvoicePaymentsCsvFile(getInvoicePaymentsCsvPath(tmpDir))).toEqual([]);
  });

  it('round-trips a payment row', () => {
    const csv = serializeInvoicePaymentsCsv([
      {
        id: 'PMT-0001',
        invoice_id: 'DC-001',
        bank_transaction_id: 'txn-123',
        payment_date: '2025-08-05',
        amount_paid: 3960,
        deposit_currency: 'GBP',
        fx_rate_at_payment: null,
        amount_in_invoice_currency: 3960,
        fx_gain_loss: 0,
        residual: 0,
        created_at: '2025-08-05',
        updated_at: null,
      },
    ]);
    fs.writeFileSync(getInvoicePaymentsCsvPath(tmpDir), csv);
    const parsed = readInvoicePaymentsCsvFile(getInvoicePaymentsCsvPath(tmpDir));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].residual).toBe(0);
  });
});
