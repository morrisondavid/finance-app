/**
 * Invoices eligible for bank-deposit reconciliation.
 */

import type { EntityId, Invoice } from '../../../shared/api-contracts.js';
import { allInvoicePayments, listInvoicesByStatus } from './queries.js';

/** Issued, partial, and paid rows with no payment link (status drift). */
export function listReconcilableInvoices(entityId?: EntityId): readonly Invoice[] {
  const paidWithPayment = new Set(allInvoicePayments().map(p => p.invoice_id));
  const byId = new Map<string, Invoice>();

  for (const status of ['issued', 'partial', 'paid'] as const) {
    for (const invoice of listInvoicesByStatus(status)) {
      if (status === 'paid' && paidWithPayment.has(invoice.id)) {
        continue;
      }
      if (entityId !== undefined && invoice.issuing_entity_id !== entityId) {
        continue;
      }
      byId.set(invoice.id, invoice);
    }
  }

  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}
