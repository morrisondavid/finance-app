/**
 * Invoice id generation for supplier-issued and self-bill flows.
 *
 * - `nextSupplierInvoiceId` — Delta Capita drafts use `DC-###`
 *   (client series); other clients use `UK-####` / `FZ-####` from the
 *   issuing entity (`nextInvoiceIdForEntity`).
 * - `nextInvoiceIdForEntity` — strict per-entity `UK-####` / `FZ-####`
 *   sequences (self-bill ingest, and any UK client that is not Delta
 *   Capita).
 *
 * Sequences are not global: FZ and UK (and DC) stay logically separate
 * as described on `InvoiceIdSchema`.
 */

import type { Client, Company, EntityId } from '../../../shared/api-contracts.js';
import type { Invoice, InvoiceId } from './schema.js';
import { nextDeltaCapitaInvoiceId } from './client-invoice-number.js';

/**
 * Invoice-id prefix for an entity. Derived from the company's
 * jurisdiction so a future third jurisdiction can opt into its own
 * prefix by extending this table (and the regex in
 * `InvoiceIdSchema`) without changing any call site.
 */
export function invoiceIdPrefixFor(company: Company): 'UK' | 'FZ' {
  return company.jurisdiction === 'UK' ? 'UK' : 'FZ';
}

/**
 * Return the next `{prefix}-####` for `entityId` given a slice of
 * existing invoices (any slice — this function filters by
 * `issuing_entity_id` and by prefix shape internally so callers can
 * safely pass the full registry).
 *
 * Semantics:
 *   - Empty list → `{prefix}-0001`.
 *   - Max+1 (not count+1) — gaps in the sequence are preserved.
 *   - Other-entity invoices are ignored (FZ rows don't bump the UK
 *     sequence or vice versa).
 *   - Non-conforming ids (shouldn't exist — blocked by
 *     `InvoiceIdSchema`) are skipped defensively.
 */
export function nextInvoiceIdForEntity(
  entityId: EntityId,
  company: Company,
  invoices: readonly Invoice[],
): InvoiceId {
  const prefix = invoiceIdPrefixFor(company);
  const pattern = new RegExp(`^${prefix}-(\\d{4})$`);
  let maxNumber = 0;
  for (const inv of invoices) {
    if (inv.issuing_entity_id !== entityId) continue;
    const match = pattern.exec(inv.id);
    if (match === null) continue;
    const n = Number(match[1]);
    if (Number.isFinite(n) && n > maxNumber) maxNumber = n;
  }
  const next = maxNumber + 1;
  return `${prefix}-${String(next).padStart(4, '0')}` as InvoiceId;
}

/**
 * Next supplier-issued invoice id: Delta Capita uses the `DC-###`
 * series; every other client keeps per-entity `UK-####` / `FZ-####`.
 */
export function nextSupplierInvoiceId(
  client: Client,
  company: Company,
  entityId: EntityId,
  invoices: readonly Invoice[],
): InvoiceId {
  if (client.id === 'delta-capita') {
    return nextDeltaCapitaInvoiceId(invoices);
  }
  return nextInvoiceIdForEntity(entityId, company, invoices);
}
