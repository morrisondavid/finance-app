/**
 * `createInvoice` / `updateInvoice` covers the validate / write /
 * invalidate chain that the §1.3 generate + ingest routes lean on.
 * Every branch of the `Result` unions has a regression test so the
 * route layer can stay a dumb translator from result → HTTP status.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createInvoice, updateInvoice } from './mutations.js';
import {
  __resetInvoiceRegistryForTests,
  buildInvoiceRegistry,
  getInvoiceRegistry,
} from './registry.js';
import {
  getInvoicesCsvPath,
  readInvoicesCsvFile,
  writeInvoicesCsvFile,
  parseInvoiceRow,
} from './csv-io.js';
import { dcInvoice001, dcInvoice002 } from './test-helpers.js';
import type { Invoice } from '../../../shared/api-contracts.js';

let tmpDir: string;

function makeInvoice(overrides: Partial<Invoice>): Invoice {
  const base = parseInvoiceRow(dcInvoice001);
  return { ...base, ...overrides };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'invoices-mutations-'));
  const seeded = [parseInvoiceRow(dcInvoice001), parseInvoiceRow(dcInvoice002)];
  writeInvoicesCsvFile(getInvoicesCsvPath(tmpDir), seeded);
  __resetInvoiceRegistryForTests(buildInvoiceRegistry(tmpDir));
});

afterEach(() => {
  __resetInvoiceRegistryForTests();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const FIXED_NOW = new Date('2026-05-01T09:00:00Z');

describe('createInvoice', () => {
  it('appends a new invoice, rewrites the CSV, and invalidates the registry', () => {
    const fresh = makeInvoice({
      id: 'DC-003',
      invoice_number: 'DC-003',
      payment_reference: 'DC-003',
      invoice_date: '2026-05-01',
      status: 'draft',
    });
    const result = createInvoice({ invoice: fresh, invoicesDir: tmpDir });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.invoice.id).toBe('DC-003');

    // Registry invalidated — rebuilding from tmpDir reflects the new row.
    __resetInvoiceRegistryForTests(buildInvoiceRegistry(tmpDir));
    expect(getInvoiceRegistry().indexes.byId.get('DC-003')?.status).toBe('draft');

    const onDisk = readInvoicesCsvFile(getInvoicesCsvPath(tmpDir));
    expect(onDisk.map(i => i.id)).toEqual(['DC-001', 'DC-002', 'DC-003']);
  });

  it('aligns payment_reference to invoice_number for supplier-issued rows', () => {
    const fresh = makeInvoice({
      id: 'DC-004',
      invoice_number: 'DC-004',
      payment_reference: 'WRONG-REF',
      invoice_date: '2026-05-01',
      status: 'draft',
    });
    const result = createInvoice({ invoice: fresh, invoicesDir: tmpDir });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.invoice.payment_reference).toBe('DC-004');
  });

  it('rejects a duplicate id without touching the CSV', () => {
    const before = fs.readFileSync(getInvoicesCsvPath(tmpDir), 'utf-8');
    const dupe = makeInvoice({ id: 'DC-001' });
    const result = createInvoice({ invoice: dupe, invoicesDir: tmpDir });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('duplicate-id');
    if (result.code !== 'duplicate-id') return;
    expect(result.invoiceId).toBe('DC-001');

    const after = fs.readFileSync(getInvoicesCsvPath(tmpDir), 'utf-8');
    expect(after).toBe(before);
  });

  it('rejects an invoice with an id shape that fails the schema', () => {
    const bad = makeInvoice({
      id: 'INVALID',
      invoice_number: 'INVALID',
      payment_reference: 'INVALID',
    });
    const result = createInvoice({ invoice: bad, invoicesDir: tmpDir });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('invalid');
    if (result.code !== 'invalid') return;
    expect(result.issues.length).toBeGreaterThan(0);
  });
});

describe('updateInvoice', () => {
  it('patches status + pdf_path and stamps updated_at', () => {
    const result = updateInvoice({
      invoiceId: 'DC-001',
      patch: { status: 'issued', pdf_path: 'invoices/generated/DC-001.pdf' },
      invoicesDir: tmpDir,
      now: FIXED_NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.invoice.status).toBe('issued');
    expect(result.invoice.pdf_path).toBe('invoices/generated/DC-001.pdf');
    expect(result.invoice.updated_at).toBe('2026-05-01');

    const onDisk = readInvoicesCsvFile(getInvoicesCsvPath(tmpDir));
    const updated = onDisk.find(i => i.id === 'DC-001');
    expect(updated?.status).toBe('issued');
  });

  it('preserves row order when patching a mid-file row', () => {
    updateInvoice({
      invoiceId: 'DC-002',
      patch: { status: 'partial' },
      invoicesDir: tmpDir,
      now: FIXED_NOW,
    });
    const onDisk = readInvoicesCsvFile(getInvoicesCsvPath(tmpDir));
    expect(onDisk.map(i => i.id)).toEqual(['DC-001', 'DC-002']);
  });

  it('ignores an id field in the patch (cannot rewrite id)', () => {
    const result = updateInvoice({
      invoiceId: 'DC-001',
      patch: { id: 'DC-999', status: 'issued' },
      invoicesDir: tmpDir,
      now: FIXED_NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.invoice.id).toBe('DC-001');
  });

  it('returns not-found for an unknown id', () => {
    const result = updateInvoice({
      invoiceId: 'DC-999',
      patch: { status: 'issued' },
      invoicesDir: tmpDir,
      now: FIXED_NOW,
    });
    expect(result).toEqual({ ok: false, code: 'not-found' });
  });

  it('returns invalid when the merged row fails InvoiceSchema', () => {
    const result = updateInvoice({
      invoiceId: 'DC-001',
      patch: { subtotal: -1 },
      invoicesDir: tmpDir,
      now: FIXED_NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) return;
    expect(result.code).toBe('invalid');
  });

  it('does not rewrite the CSV when validation fails', () => {
    const before = fs.readFileSync(getInvoicesCsvPath(tmpDir), 'utf-8');
    updateInvoice({
      invoiceId: 'DC-001',
      patch: { subtotal: -1 },
      invoicesDir: tmpDir,
      now: FIXED_NOW,
    });
    const after = fs.readFileSync(getInvoicesCsvPath(tmpDir), 'utf-8');
    expect(after).toBe(before);
  });
});
