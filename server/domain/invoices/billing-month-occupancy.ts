/**
 * Billing calendar month occupancy for supplier-issued invoicing —
 * rejects a second invoice row when any existing row overlaps that month.
 */

import { monthRange } from '../../../shared/iso-date.js';
import type { Invoice } from './schema.js';
import { isoPeriodRangesOverlap } from './period-range-overlap.js';

/** Normalise `YYYY-MM` or `YYYY-MM-DD` to `YYYY-MM-01` before `monthRange`. */
export function normaliseBillingMonthStart(billingMonth: string): string {
  const trimmed = billingMonth.trim();
  const asFirst =
    trimmed.length === 7 ? `${trimmed}-01` : trimmed.length >= 10 ? trimmed.slice(0, 10) : trimmed;
  return monthRange(asFirst).start;
}

export function existingInvoicesOccupyingContractBillingMonth(
  contractId: string,
  billingMonth: string,
  invoices: readonly Invoice[],
): readonly Invoice[] {
  const monthStart = normaliseBillingMonthStart(billingMonth);
  const { start: mStart, end: mEnd } = monthRange(monthStart);
  return invoices.filter(
    inv =>
      inv.contract_id === contractId
      && isoPeriodRangesOverlap(inv.period_start, inv.period_end, mStart, mEnd),
  );
}
