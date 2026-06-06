/**
 * Shared test helpers for the invoices-domain test files.
 *
 * Seed rows mirror the production `invoices/invoices.csv` closely
 * enough that gate / invariant tests can exercise the index shape
 * without depending on the real committed file.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Invoice } from './schema.js';
import {
  writeInvoicesCsvFile,
  parseInvoiceRow,
  getInvoicesCsvPath,
  INVOICE_CSV_HEADERS,
} from './csv-io.js';

export function mkTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'invoices-registry-'));
}

export function rowFromHeaders(
  values: Partial<Record<(typeof INVOICE_CSV_HEADERS)[number], string>>,
): Record<string, string> {
  const row: Record<string, string> = {};
  for (const h of INVOICE_CSV_HEADERS) {
    row[h] = values[h] ?? '';
  }
  return row;
}

/** A clean, structurally-valid DC row used as a default fixture. */
export const dcInvoice001 = rowFromHeaders({
  id: 'DC-001',
  contract_id: 'dc-sow-2025-jun',
  client_id: 'delta-capita',
  issuing_entity_id: 'autonize-it-ltd',
  invoice_number: 'DC-001',
  payment_reference: 'DC-001',
  invoice_date: '2025-07-09',
  period_start: '2025-06-23',
  period_end: '2025-06-30',
  days_billed: '6',
  description: 'David Morrison - Consultant Services, Software Development',
  currency: 'GBP',
  subtotal: '3300',
  vat_rate: '0.2',
  vat_amount: '660',
  total: '3960',
  fx_rate_at_issue: '',
  fx_base_currency: '',
  mechanism: 'supplier-issued',
  status: 'paid',
  due_date: '2025-08-09',
  created_at: '2025-07-09',
  updated_at: '2025-07-09',
});

/** A second DC row for the same contract, for sort-order assertions. */
export const dcInvoice002 = rowFromHeaders({
  id: 'DC-002',
  contract_id: 'dc-sow-2025-jun',
  client_id: 'delta-capita',
  issuing_entity_id: 'autonize-it-ltd',
  invoice_number: 'DC-002',
  payment_reference: 'DC-002',
  invoice_date: '2025-08-11',
  period_start: '2025-07-01',
  period_end: '2025-07-29',
  days_billed: '19',
  description: 'David Morrison - Consultant Services, Software Development',
  currency: 'GBP',
  subtotal: '10450',
  vat_rate: '0.2',
  vat_amount: '2090',
  total: '12540',
  fx_rate_at_issue: '',
  fx_base_currency: '',
  mechanism: 'supplier-issued',
  status: 'paid',
  due_date: '2025-09-11',
  created_at: '2025-08-11',
  updated_at: '2025-08-11',
});

/** A hypothetical FZCO row, for per-entity sequence / no-VAT assertions. */
export const fzcoInvoice001 = rowFromHeaders({
  id: 'FZ-0001',
  contract_id: 'lf-2026-mar',
  client_id: 'la-fosse',
  issuing_entity_id: 'autonize-it-fzco',
  invoice_number: 'FZ-0001',
  payment_reference: 'FZ-0001',
  invoice_date: '2026-04-01',
  period_start: '2026-03-02',
  period_end: '2026-03-31',
  days_billed: '22',
  description: 'David Morrison - Consultant Services, Software Development',
  currency: 'GBP',
  subtotal: '11000',
  vat_rate: '0',
  vat_amount: '0',
  total: '11000',
  fx_rate_at_issue: '',
  fx_base_currency: '',
  mechanism: 'self-bill',
  status: 'issued',
  due_date: '2026-05-01',
  created_at: '2026-04-01',
  updated_at: '2026-04-01',
});

export function seedCsv(tmpDir: string, rows: readonly Record<string, string>[]): void {
  const invoices: Invoice[] = rows.map(parseInvoiceRow);
  writeInvoicesCsvFile(getInvoicesCsvPath(tmpDir), invoices);
}
