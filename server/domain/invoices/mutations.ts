/**
 * Invoices domain — write surface.
 *
 * The single seam for writing to `invoices/invoices.csv`. Phase 2's
 * supplier-issued generator, Phase 3's self-bill ingestor, and
 * Phase 4's reconciler (future) all funnel through here so there is
 * exactly one place that re-serialises the CSV, atomically swaps it
 * into place, and invalidates the registry.
 *
 * Results are discriminated unions rather than thrown errors — the
 * HTTP layer maps each variant onto a distinct status code (200 /
 * 400 / 404 / 409) without a try/catch. This mirrors
 * `server/domain/clients/mutations.ts` exactly so callers that learn
 * one API get the other for free.
 */

import type { ZodIssue } from 'zod';
import {
  InvoiceSchema,
  type Invoice,
  type InvoiceId,
} from '../../../shared/api-contracts.js';
import { todayIsoLocal } from '../../../shared/iso-date.js';
import { getInvoicesCsvPath, writeInvoicesCsvFile } from './csv-io.js';
import {
  DEFAULT_INVOICES_DIR,
  getInvoiceRegistry,
  invalidateInvoiceRegistry,
  type InvoiceRegistry,
} from './registry.js';

/** Bank narration should quote the same ref as the printed invoice number. */
function withSupplierPaymentRefAligned(invoice: Invoice): Invoice {
  if (invoice.mechanism !== 'supplier-issued') return invoice;
  if (invoice.payment_reference === invoice.invoice_number) return invoice;
  return { ...invoice, payment_reference: invoice.invoice_number };
}

export interface CreateInvoiceInput {
  readonly invoice: Invoice;
  /** Override for tests. Defaults to {@link DEFAULT_INVOICES_DIR}. */
  readonly invoicesDir?: string;
}

export type CreateInvoiceResult =
  | { readonly ok: true; readonly invoice: Invoice }
  | { readonly ok: false; readonly code: 'duplicate-id'; readonly invoiceId: InvoiceId }
  | {
      readonly ok: false;
      readonly code: 'invalid';
      readonly issues: readonly ZodIssue[];
    };

/**
 * Append a new invoice row.
 *
 * Flow:
 *   1. Re-validate with `InvoiceSchema`. The builder / parser produces
 *      a typed value, but this keeps the write surface safe against
 *      anyone who builds an invoice by hand (e.g. a future admin tool).
 *   2. Reject duplicates up-front so the append can't silently
 *      overwrite a row via the registry index.
 *   3. Rewrite the whole CSV (registry.all + new invoice) atomically
 *      via `writeInvoicesCsvFile` → `atomicWriteCsv`.
 *   4. Invalidate the registry so the next read rebuilds from disk.
 */
export function createInvoice(input: CreateInvoiceInput): CreateInvoiceResult {
  const invoicesDir = input.invoicesDir ?? DEFAULT_INVOICES_DIR;
  const parsed = InvoiceSchema.safeParse(withSupplierPaymentRefAligned(input.invoice));
  if (!parsed.success) {
    return { ok: false, code: 'invalid', issues: parsed.error.issues };
  }

  const registry = getInvoiceRegistry();
  if (registry.indexes.byId.has(parsed.data.id)) {
    return { ok: false, code: 'duplicate-id', invoiceId: parsed.data.id };
  }

  const next: readonly Invoice[] = [...registry.all, parsed.data];
  writeInvoicesCsvFile(getInvoicesCsvPath(invoicesDir), next);
  invalidateInvoiceRegistry();

  return { ok: true, invoice: parsed.data };
}

export interface UpdateInvoiceInput {
  readonly invoiceId: InvoiceId;
  readonly patch: Partial<Invoice>;
  /** Override for tests. Defaults to {@link DEFAULT_INVOICES_DIR}. */
  readonly invoicesDir?: string;
  /** Override for tests. Defaults to `todayIsoLocal()`. */
  readonly now?: Date;
}

export type UpdateInvoiceResult =
  | { readonly ok: true; readonly invoice: Invoice }
  | { readonly ok: false; readonly code: 'not-found' }
  | {
      readonly ok: false;
      readonly code: 'invalid';
      readonly issues: readonly ZodIssue[];
    };

/**
 * Apply a patch to an existing invoice.
 *
 * Used by:
 *   - the generate endpoint to flip `status: 'draft' -> 'issued'`
 *     and set `pdf_path` once the PDF is rendered;
 *   - Phase 4 reconciler future work (partial-payment updates).
 *
 * Stamps `updated_at` server-side (callers can't spoof it) and refuses
 * to let a caller rewrite `id` — the registry splice keys on
 * `invoiceId` so a rewritten id would silently fork the row.
 */
export function updateInvoice(input: UpdateInvoiceInput): UpdateInvoiceResult {
  const invoicesDir = input.invoicesDir ?? DEFAULT_INVOICES_DIR;
  const registry = getInvoiceRegistry();

  const existing = registry.indexes.byId.get(input.invoiceId);
  if (existing === undefined) {
    return { ok: false, code: 'not-found' };
  }

  const merged: Invoice = withSupplierPaymentRefAligned({
    ...existing,
    ...input.patch,
    id: existing.id,
    updated_at: todayIsoLocal(input.now),
  });

  const parsed = InvoiceSchema.safeParse(merged);
  if (!parsed.success) {
    return { ok: false, code: 'invalid', issues: parsed.error.issues };
  }

  const next = replaceInvoice(registry, parsed.data);
  writeInvoicesCsvFile(getInvoicesCsvPath(invoicesDir), next);
  invalidateInvoiceRegistry();

  return { ok: true, invoice: parsed.data };
}

/** Splice the updated invoice back into the registry order. */
function replaceInvoice(
  registry: InvoiceRegistry,
  updated: Invoice,
): readonly Invoice[] {
  return registry.all.map(row => (row.id === updated.id ? updated : row));
}
