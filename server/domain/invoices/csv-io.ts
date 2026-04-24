/**
 * CSV I/O for `invoices/invoices.csv` and `invoices/invoice_payments.csv`.
 *
 * The schema follows ROADMAP §1.3 verbatim. The parser preserves
 * semantic errors in the historical DC seed rows byte-for-byte so the
 * Phase 4 reconciler can flag them — the parser validates **structure**
 * (a date is an ISO date, a number is a number), not business
 * correctness (period spans, due-date year typos).
 */

import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import {
  InvoiceSchema,
  InvoicePaymentSchema,
  type Invoice,
  type InvoicePayment,
} from '../../../shared/api-contracts.js';
import { escapeCsvField, atomicWriteCsv } from '../../utils/csv-helpers.js';

export const INVOICES_CSV_FILENAME = 'invoices.csv';
export const INVOICE_PAYMENTS_CSV_FILENAME = 'invoice_payments.csv';

export const INVOICE_CSV_HEADERS = [
  'id',
  'contract_id',
  'client_id',
  'issuing_entity_id',
  'invoice_number',
  'payment_reference',
  'invoice_date',
  'period_start',
  'period_end',
  'days_billed',
  'description',
  'currency',
  'subtotal',
  'vat_rate',
  'vat_amount',
  'total',
  'fx_rate_at_issue',
  'fx_base_currency',
  'mechanism',
  'pdf_path',
  'status',
  'due_date',
  'created_at',
  'updated_at',
] as const;

export const INVOICE_PAYMENT_CSV_HEADERS = [
  'id',
  'invoice_id',
  'bank_transaction_id',
  'payment_date',
  'amount_paid',
  'deposit_currency',
  'fx_rate_at_payment',
  'amount_in_invoice_currency',
  'fx_gain_loss',
  'residual',
  'created_at',
  'updated_at',
] as const;

export function getInvoicesCsvPath(invoicesDir: string): string {
  return path.join(invoicesDir, INVOICES_CSV_FILENAME);
}

export function getInvoicePaymentsCsvPath(invoicesDir: string): string {
  return path.join(invoicesDir, INVOICE_PAYMENTS_CSV_FILENAME);
}

// ─── Cell decoders ──────────────────────────────────────────────────────────

function nullIfEmpty(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function requireNonEmpty(value: string | undefined, field: string, rowId: string): string {
  const v = nullIfEmpty(value);
  if (v === null) {
    throw new Error(`Invoice ${rowId}: ${field} is required`);
  }
  return v;
}

function decodeNumber(value: string | undefined, field: string, rowId: string): number {
  const raw = requireNonEmpty(value, field, rowId);
  const n = Number(raw);
  if (Number.isNaN(n)) {
    throw new Error(`Invoice ${rowId}: ${field} must be a number, got '${raw}'`);
  }
  return n;
}

function decodeNullableNumber(value: string | undefined, field: string, rowId: string): number | null {
  const raw = nullIfEmpty(value);
  if (raw === null) return null;
  const n = Number(raw);
  if (Number.isNaN(n)) {
    throw new Error(`Invoice ${rowId}: ${field} must be a number, got '${raw}'`);
  }
  return n;
}

function decodeIsoDate(value: string | undefined, field: string, rowId: string): string {
  const raw = requireNonEmpty(value, field, rowId);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new Error(`Invoice ${rowId}: ${field} must be yyyy-mm-dd, got '${raw}'`);
  }
  return raw;
}

function decodeNullableIsoDate(value: string | undefined, field: string, rowId: string): string | null {
  const raw = nullIfEmpty(value);
  if (raw === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new Error(`Invoice ${rowId}: ${field} must be yyyy-mm-dd, got '${raw}'`);
  }
  return raw;
}

// ─── Row parsers ────────────────────────────────────────────────────────────

export function parseInvoiceRow(row: Record<string, string>): Invoice {
  const rowId = nullIfEmpty(row.id) ?? '<missing-id>';
  return InvoiceSchema.parse({
    id: requireNonEmpty(row.id, 'id', rowId),
    contract_id: requireNonEmpty(row.contract_id, 'contract_id', rowId),
    client_id: requireNonEmpty(row.client_id, 'client_id', rowId),
    issuing_entity_id: requireNonEmpty(row.issuing_entity_id, 'issuing_entity_id', rowId),
    invoice_number: requireNonEmpty(row.invoice_number, 'invoice_number', rowId),
    payment_reference: requireNonEmpty(row.payment_reference, 'payment_reference', rowId),
    invoice_date: decodeIsoDate(row.invoice_date, 'invoice_date', rowId),
    period_start: decodeIsoDate(row.period_start, 'period_start', rowId),
    period_end: decodeIsoDate(row.period_end, 'period_end', rowId),
    days_billed: decodeNumber(row.days_billed, 'days_billed', rowId),
    description: requireNonEmpty(row.description, 'description', rowId),
    currency: requireNonEmpty(row.currency, 'currency', rowId),
    subtotal: decodeNumber(row.subtotal, 'subtotal', rowId),
    vat_rate: decodeNumber(row.vat_rate, 'vat_rate', rowId),
    vat_amount: decodeNumber(row.vat_amount, 'vat_amount', rowId),
    total: decodeNumber(row.total, 'total', rowId),
    fx_rate_at_issue: decodeNullableNumber(row.fx_rate_at_issue, 'fx_rate_at_issue', rowId),
    fx_base_currency: nullIfEmpty(row.fx_base_currency),
    mechanism: requireNonEmpty(row.mechanism, 'mechanism', rowId),
    pdf_path: nullIfEmpty(row.pdf_path),
    status: requireNonEmpty(row.status, 'status', rowId),
    due_date: decodeIsoDate(row.due_date, 'due_date', rowId),
    created_at: decodeIsoDate(row.created_at, 'created_at', rowId),
    updated_at: decodeNullableIsoDate(row.updated_at, 'updated_at', rowId),
  });
}

export function parseInvoicePaymentRow(row: Record<string, string>): InvoicePayment {
  const rowId = nullIfEmpty(row.id) ?? '<missing-id>';
  return InvoicePaymentSchema.parse({
    id: requireNonEmpty(row.id, 'id', rowId),
    invoice_id: requireNonEmpty(row.invoice_id, 'invoice_id', rowId),
    bank_transaction_id: requireNonEmpty(row.bank_transaction_id, 'bank_transaction_id', rowId),
    payment_date: decodeIsoDate(row.payment_date, 'payment_date', rowId),
    amount_paid: decodeNumber(row.amount_paid, 'amount_paid', rowId),
    deposit_currency: requireNonEmpty(row.deposit_currency, 'deposit_currency', rowId),
    fx_rate_at_payment: decodeNullableNumber(row.fx_rate_at_payment, 'fx_rate_at_payment', rowId),
    amount_in_invoice_currency: decodeNumber(row.amount_in_invoice_currency, 'amount_in_invoice_currency', rowId),
    fx_gain_loss: decodeNumber(row.fx_gain_loss, 'fx_gain_loss', rowId),
    residual: decodeNumber(row.residual, 'residual', rowId),
    created_at: decodeIsoDate(row.created_at, 'created_at', rowId),
    updated_at: decodeNullableIsoDate(row.updated_at, 'updated_at', rowId),
  });
}

// ─── File readers ───────────────────────────────────────────────────────────

function readCsvRecords(csvPath: string): Record<string, string>[] {
  if (!fs.existsSync(csvPath)) return [];
  const content = fs.readFileSync(csvPath, 'utf8').trim();
  if (content === '') return [];
  return parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as Record<string, string>[];
}

export function readInvoicesCsvFile(csvPath: string): Invoice[] {
  const rows: Invoice[] = [];
  for (const row of readCsvRecords(csvPath)) {
    if (!nullIfEmpty(row.id)) continue;
    rows.push(parseInvoiceRow(row));
  }
  return rows;
}

export function readInvoicePaymentsCsvFile(csvPath: string): InvoicePayment[] {
  const rows: InvoicePayment[] = [];
  for (const row of readCsvRecords(csvPath)) {
    if (!nullIfEmpty(row.id)) continue;
    rows.push(parseInvoicePaymentRow(row));
  }
  return rows;
}

// ─── Cell encoders ──────────────────────────────────────────────────────────

function encodeOptional(value: string | null): string {
  return value ?? '';
}

function encodeNumber(value: number): string {
  return String(value);
}

function encodeNullableNumber(value: number | null): string {
  return value === null ? '' : String(value);
}

export function serializeInvoiceRow(invoice: Invoice): string {
  const cells: string[] = INVOICE_CSV_HEADERS.map(header => {
    switch (header) {
      case 'id': return invoice.id;
      case 'contract_id': return invoice.contract_id;
      case 'client_id': return invoice.client_id;
      case 'issuing_entity_id': return invoice.issuing_entity_id;
      case 'invoice_number': return invoice.invoice_number;
      case 'payment_reference': return invoice.payment_reference;
      case 'invoice_date': return invoice.invoice_date;
      case 'period_start': return invoice.period_start;
      case 'period_end': return invoice.period_end;
      case 'days_billed': return encodeNumber(invoice.days_billed);
      case 'description': return invoice.description;
      case 'currency': return invoice.currency;
      case 'subtotal': return encodeNumber(invoice.subtotal);
      case 'vat_rate': return encodeNumber(invoice.vat_rate);
      case 'vat_amount': return encodeNumber(invoice.vat_amount);
      case 'total': return encodeNumber(invoice.total);
      case 'fx_rate_at_issue': return encodeNullableNumber(invoice.fx_rate_at_issue);
      case 'fx_base_currency': return encodeOptional(invoice.fx_base_currency);
      case 'mechanism': return invoice.mechanism;
      case 'pdf_path': return encodeOptional(invoice.pdf_path);
      case 'status': return invoice.status;
      case 'due_date': return invoice.due_date;
      case 'created_at': return invoice.created_at;
      case 'updated_at': return encodeOptional(invoice.updated_at);
    }
  });
  return cells.map(escapeCsvField).join(',');
}

export function serializeInvoicesCsv(invoices: readonly Invoice[]): string {
  const header = INVOICE_CSV_HEADERS.join(',');
  const body = invoices.map(serializeInvoiceRow).join('\n');
  return body === '' ? `${header}\n` : `${header}\n${body}\n`;
}

export function writeInvoicesCsvFile(csvPath: string, invoices: readonly Invoice[]): void {
  atomicWriteCsv(csvPath, serializeInvoicesCsv(invoices));
}

export function serializeInvoicePaymentRow(payment: InvoicePayment): string {
  const cells: string[] = INVOICE_PAYMENT_CSV_HEADERS.map(header => {
    switch (header) {
      case 'id': return payment.id;
      case 'invoice_id': return payment.invoice_id;
      case 'bank_transaction_id': return payment.bank_transaction_id;
      case 'payment_date': return payment.payment_date;
      case 'amount_paid': return encodeNumber(payment.amount_paid);
      case 'deposit_currency': return payment.deposit_currency;
      case 'fx_rate_at_payment': return encodeNullableNumber(payment.fx_rate_at_payment);
      case 'amount_in_invoice_currency': return encodeNumber(payment.amount_in_invoice_currency);
      case 'fx_gain_loss': return encodeNumber(payment.fx_gain_loss);
      case 'residual': return encodeNumber(payment.residual);
      case 'created_at': return payment.created_at;
      case 'updated_at': return encodeOptional(payment.updated_at);
    }
  });
  return cells.map(escapeCsvField).join(',');
}

export function serializeInvoicePaymentsCsv(payments: readonly InvoicePayment[]): string {
  const header = INVOICE_PAYMENT_CSV_HEADERS.join(',');
  const body = payments.map(serializeInvoicePaymentRow).join('\n');
  return body === '' ? `${header}\n` : `${header}\n${body}\n`;
}

export function writeInvoicePaymentsCsvFile(
  csvPath: string,
  payments: readonly InvoicePayment[],
): void {
  atomicWriteCsv(csvPath, serializeInvoicePaymentsCsv(payments));
}
