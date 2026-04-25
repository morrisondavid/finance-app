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
  InvoicePaymentSchema,
  type Invoice,
  type InvoiceId,
  type InvoicePayment,
  type InvoicePaymentId,
} from '../../../shared/api-contracts.js';
import { todayIsoLocal } from '../../../shared/iso-date.js';
import {
  getInvoicesCsvPath,
  getInvoicePaymentsCsvPath,
  writeInvoicesCsvFile,
  writeInvoicePaymentsCsvFile,
} from './csv-io.js';
import {
  DEFAULT_INVOICES_DIR,
  getInvoiceRegistry,
  invalidateInvoiceRegistry,
  type InvoiceRegistry,
} from './registry.js';
import {
  DEFAULT_INVOICE_PAYMENTS_DIR,
  getInvoicePaymentRegistry,
  invalidateInvoicePaymentRegistry,
} from './payments-registry.js';

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

// ─── Invoice payments (Phase 4 reconciler write seam) ───────────────────────

export interface RecordInvoicePaymentsInput {
  /**
   * Rows produced by `planReconciliation`. Each must be Zod-valid; the
   * mutation re-parses defensively in case a future caller hand-builds
   * one.
   */
  readonly payments: readonly InvoicePayment[];
  /** Override for tests. Defaults to {@link DEFAULT_INVOICE_PAYMENTS_DIR}. */
  readonly invoicesDir?: string;
}

export type RecordInvoicePaymentsResult =
  | { readonly ok: true; readonly payments: readonly InvoicePayment[] }
  | {
      readonly ok: false;
      readonly code: 'duplicate-id';
      readonly invoicePaymentId: InvoicePaymentId;
    }
  | {
      readonly ok: false;
      readonly code: 'duplicate-bank-tx';
      readonly bankTransactionId: string;
    }
  | {
      readonly ok: false;
      readonly code: 'unknown-invoice';
      readonly invoiceId: InvoiceId;
    }
  | {
      readonly ok: false;
      readonly code: 'invalid';
      readonly issues: readonly ZodIssue[];
    };

/**
 * Append a batch of `InvoicePayment` rows.
 *
 * Flow (mirrors `createInvoice`):
 *   1. Re-validate every row with `InvoicePaymentSchema`.
 *   2. Reject any payment whose `invoice_id` is unknown — registry FK
 *      validity is enforced here so an upstream bug can't smuggle an
 *      orphan payment row past the trust boundary.
 *   3. Reject duplicate `id` (re-running a dry-run twice) and duplicate
 *      `bank_transaction_id` (a deposit can only settle one invoice).
 *   4. Atomic-rewrite `invoices/invoice_payments.csv`.
 *   5. Invalidate the payments registry so the next read rebuilds.
 *
 * The whole batch is rejected on the first failure so a partial write
 * never appears on disk.
 */
export function recordInvoicePayments(
  input: RecordInvoicePaymentsInput,
): RecordInvoicePaymentsResult {
  const invoicesDir = input.invoicesDir ?? DEFAULT_INVOICE_PAYMENTS_DIR;
  const invoicesReg = getInvoiceRegistry();
  const paymentsReg = getInvoicePaymentRegistry();

  const seenIds = new Set<InvoicePaymentId>();
  const seenBankTxs = new Set<string>();
  const validated: InvoicePayment[] = [];

  for (const candidate of input.payments) {
    const parsed = InvoicePaymentSchema.safeParse(candidate);
    if (!parsed.success) {
      return { ok: false, code: 'invalid', issues: parsed.error.issues };
    }
    const row = parsed.data;

    if (!invoicesReg.indexes.byId.has(row.invoice_id)) {
      return { ok: false, code: 'unknown-invoice', invoiceId: row.invoice_id };
    }

    if (paymentsReg.indexes.byId.has(row.id) || seenIds.has(row.id)) {
      return { ok: false, code: 'duplicate-id', invoicePaymentId: row.id };
    }
    if (
      paymentsReg.indexes.byBankTransactionId.has(row.bank_transaction_id) ||
      seenBankTxs.has(row.bank_transaction_id)
    ) {
      return {
        ok: false,
        code: 'duplicate-bank-tx',
        bankTransactionId: row.bank_transaction_id,
      };
    }

    seenIds.add(row.id);
    seenBankTxs.add(row.bank_transaction_id);
    validated.push(row);
  }

  if (validated.length === 0) {
    return { ok: true, payments: [] };
  }

  const next: readonly InvoicePayment[] = [...paymentsReg.all, ...validated];
  writeInvoicePaymentsCsvFile(getInvoicePaymentsCsvPath(invoicesDir), next);
  invalidateInvoicePaymentRegistry();

  return { ok: true, payments: validated };
}
