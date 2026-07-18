/**
 * Invoices domain — public query surface.
 *
 * Every function answers one named question by reading a precomputed
 * index on the registry. If you find yourself writing `.filter(...)`
 * over `registry.all`, the answer belongs as a new index in
 * `registry.ts` first, then surfaced here.
 */

import type {
  ContractId,
  EntityId,
  InvoicePayment,
} from '../../../shared/api-contracts.js';
import { round2 } from '../../utils/math.js';
import type { Invoice, InvoiceId, InvoiceStatus } from './schema.js';
import {
  getInvoiceRegistry,
  type InvoiceRegistry,
} from './registry.js';
import {
  getInvoicePaymentRegistry,
  type InvoicePaymentRegistry,
} from './payments-registry.js';

/** Every invoice, in CSV order. */
export function allInvoices(
  reg: InvoiceRegistry = getInvoiceRegistry(),
): readonly Invoice[] {
  return reg.all;
}

/** Primary-key lookup. Returns null for unknown ids. */
export function findInvoiceById(
  invoiceId: InvoiceId,
  reg: InvoiceRegistry = getInvoiceRegistry(),
): Invoice | null {
  return reg.indexes.byId.get(invoiceId) ?? null;
}

/**
 * Every invoice for a contract, sorted by `invoice_date` ascending.
 * Returns an empty list for unknown contract ids.
 */
export function listInvoicesByContractId(
  contractId: ContractId,
  reg: InvoiceRegistry = getInvoiceRegistry(),
): readonly Invoice[] {
  return reg.indexes.byContractId.get(contractId) ?? [];
}

/**
 * Every invoice issued by a specific entity, in CSV order. Used by
 * the Phase 2 sequence generator to derive the next invoice id.
 */
export function listInvoicesByIssuingEntityId(
  entityId: EntityId,
  reg: InvoiceRegistry = getInvoiceRegistry(),
): readonly Invoice[] {
  return reg.indexes.byIssuingEntityId.get(entityId) ?? [];
}

/** Every invoice in a given lifecycle status. */
export function listInvoicesByStatus(
  status: InvoiceStatus,
  reg: InvoiceRegistry = getInvoiceRegistry(),
): readonly Invoice[] {
  return reg.indexes.byStatus.get(status) ?? [];
}

/**
 * Invoices that still have forecastable receipt balance — payment-aware,
 * not status-only. Excludes rows fully covered by `invoice_payments` even
 * when CSV status is still `issued`.
 */
export function listUnpaidInvoicesForForecast(
  invoiceReg: InvoiceRegistry = getInvoiceRegistry(),
  paymentReg: InvoicePaymentRegistry = getInvoicePaymentRegistry(),
): readonly Invoice[] {
  const paidByInvoice = new Map<string, number>();
  for (const payment of paymentReg.all) {
    const current = paidByInvoice.get(payment.invoice_id) ?? 0;
    paidByInvoice.set(
      payment.invoice_id,
      round2(current + payment.amount_in_invoice_currency),
    );
  }

  const unpaid: Invoice[] = [];
  for (const invoice of invoiceReg.all) {
    if (invoice.status !== 'issued' && invoice.status !== 'partial') continue;
    const paid = paidByInvoice.get(invoice.id) ?? 0;
    const residual = round2(invoice.total - paid);
    if (residual > 0.01) {
      unpaid.push(invoice);
    }
  }
  return unpaid;
}

/**
 * Latest (most recent `invoice_date`) invoice for a contract, or
 * `null` when the contract has no invoices yet. Leans on the fact
 * that `byContractId` is pre-sorted by `invoice_date` asc, so this
 * is a constant-time read of the last element.
 */
export function latestInvoiceForContract(
  contractId: ContractId,
  reg: InvoiceRegistry = getInvoiceRegistry(),
): Invoice | null {
  const rows = reg.indexes.byContractId.get(contractId);
  if (rows === undefined || rows.length === 0) return null;
  return rows[rows.length - 1] ?? null;
}

// ─── Invoice payments ───────────────────────────────────────────────────────

/** Every recorded invoice payment, in CSV order. */
export function allInvoicePayments(
  reg: InvoicePaymentRegistry = getInvoicePaymentRegistry(),
): readonly InvoicePayment[] {
  return reg.all;
}

/** Every payment row keyed back to a specific invoice. */
export function listPaymentsForInvoice(
  invoiceId: InvoiceId,
  reg: InvoicePaymentRegistry = getInvoicePaymentRegistry(),
): readonly InvoicePayment[] {
  return reg.indexes.byInvoiceId.get(invoiceId) ?? [];
}

/**
 * Every payment row that claims a given bank transaction. Batched
 * remittances may return several rows for one deposit id.
 */
export function findPaymentsByBankTransaction(
  bankTransactionId: string,
  reg: InvoicePaymentRegistry = getInvoicePaymentRegistry(),
): readonly InvoicePayment[] {
  return reg.indexes.byBankTransactionId.get(bankTransactionId) ?? [];
}

/** @deprecated Prefer {@link findPaymentsByBankTransaction}. */
export function findPaymentByBankTransaction(
  bankTransactionId: string,
  reg: InvoicePaymentRegistry = getInvoicePaymentRegistry(),
): InvoicePayment | null {
  const rows = findPaymentsByBankTransaction(bankTransactionId, reg);
  return rows[0] ?? null;
}
