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
} from '../../../shared/api-contracts.js';
import type { Invoice, InvoiceId, InvoiceStatus } from './schema.js';
import {
  getInvoiceRegistry,
  type InvoiceRegistry,
} from './registry.js';

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
