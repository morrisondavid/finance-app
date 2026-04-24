/**
 * Delta Capita invoice id / number sequence (`DC-001` …).
 *
 * Supplier invoices for this client use `DC-###` as the canonical
 * `Invoice.id` (and the same string as `invoice_number`).
 */

import type { Invoice } from '../../../shared/api-contracts.js';
import type { InvoiceId } from './schema.js';

const DC_INVOICE_PATTERN = /^DC-(\d+)$/;

function maxDeltaCapitaDcIndex(existingInvoices: readonly Invoice[]): number {
  let max = 0;
  for (const inv of existingInvoices) {
    if (inv.client_id !== 'delta-capita') continue;
    for (const field of [inv.id, inv.invoice_number]) {
      const m = DC_INVOICE_PATTERN.exec(field);
      if (m === null) continue;
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return max;
}

/**
 * Next Delta Capita `DC-###` (`max + 1`, three-digit padding). Scans
 * both `id` and `invoice_number` on rows for `client_id ===
 * 'delta-capita'`.
 */
export function nextDeltaCapitaInvoiceNumber(
  existingInvoices: readonly Invoice[],
): string {
  const next = maxDeltaCapitaDcIndex(existingInvoices) + 1;
  return `DC-${String(next).padStart(3, '0')}`;
}

export function nextDeltaCapitaInvoiceId(
  existingInvoices: readonly Invoice[],
): InvoiceId {
  return nextDeltaCapitaInvoiceNumber(existingInvoices) as InvoiceId;
}
