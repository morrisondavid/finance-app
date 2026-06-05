/**
 * Client-scoped invoice id sequences.
 *
 * - Delta Capita: `DC-###`
 * - La Fosse (Edwin Group end client): `EG-####`
 */

import type { Invoice } from '../../../shared/api-contracts.js';
import type { InvoiceId } from './schema.js';

const DC_INVOICE_PATTERN = /^DC-(\d+)$/;
const LA_FOSSE_INVOICE_PATTERN = /^EG-(\d+)$/;

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

function maxLaFosseEgIndex(existingInvoices: readonly Invoice[]): number {
  let max = 0;
  for (const inv of existingInvoices) {
    if (inv.client_id !== 'la-fosse') continue;
    for (const field of [inv.id, inv.invoice_number]) {
      const m = LA_FOSSE_INVOICE_PATTERN.exec(field);
      if (m === null) continue;
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return max;
}

/**
 * Next La Fosse `EG-####` (`max + 1`, four-digit padding). One series
 * across Ltd and FZCO engagements (same as Delta Capita's DC series).
 */
export function nextLaFosseInvoiceNumber(
  existingInvoices: readonly Invoice[],
): string {
  const next = maxLaFosseEgIndex(existingInvoices) + 1;
  return `EG-${String(next).padStart(4, '0')}`;
}

export function nextLaFosseInvoiceId(
  existingInvoices: readonly Invoice[],
): InvoiceId {
  return nextLaFosseInvoiceNumber(existingInvoices) as InvoiceId;
}
