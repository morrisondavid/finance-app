/**
 * Stable fingerprint for monthly invoice preview→commit (excludes user-editable line fields).
 */

import { createHash } from 'node:crypto';
import type { Invoice } from './schema.js';

/**
 * Hashes identity + server-composed timing fields; **not** `days_billed`, `description`,
 * `period_end`, money lines, or allocated ids (those may change after preview).
 */
export function previewFingerprintForMonthlyInvoiceDraft(invoice: Invoice): string {
  const canonical: Record<string, unknown> = {
    contract_id: invoice.contract_id,
    client_id: invoice.client_id,
    issuing_entity_id: invoice.issuing_entity_id,
    invoice_date: invoice.invoice_date,
    period_start: invoice.period_start,
    due_date: invoice.due_date,
    currency: invoice.currency,
    vat_rate: invoice.vat_rate,
    fx_rate_at_issue: invoice.fx_rate_at_issue,
    fx_base_currency: invoice.fx_base_currency,
    mechanism: invoice.mechanism,
  };
  const json = JSON.stringify(canonical, Object.keys(canonical).sort());
  return createHash('sha256').update(json).digest('hex');
}
