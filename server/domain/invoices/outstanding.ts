/**
 * Outstanding invoice amounts (issued + partial) in GBP for AI / dashboards.
 */

import type { Invoice, InvoicePayment } from './schema.js';
import { convertAmountSync } from '../../config/exchange-rates.js';
import { round2 } from '../../utils/math.js';

function residualByInvoiceId(
  invoices: readonly Invoice[],
  payments: readonly InvoicePayment[],
): Map<string, number> {
  const out = new Map<string, number>();
  for (const inv of invoices) {
    out.set(inv.id, inv.total);
  }
  for (const p of payments) {
    const current = out.get(p.invoice_id);
    if (current === undefined) continue;
    out.set(p.invoice_id, round2(current - p.amount_in_invoice_currency));
  }
  return out;
}

/** Count and GBP total of invoices with positive residual after payments. */
export function outstandingInvoicesGbpSummary(
  invoices: readonly Invoice[],
  payments: readonly InvoicePayment[],
): { count: number; totalOutstandingGbp: number } {
  const residual = residualByInvoiceId(invoices, payments);
  let totalGbp = 0;
  let count = 0;
  for (const inv of invoices) {
    const res = residual.get(inv.id) ?? 0;
    if (res <= 0) continue;
    count += 1;
    totalGbp += convertAmountSync(res, inv.currency, 'GBP');
  }
  return { count, totalOutstandingGbp: round2(totalGbp) };
}
