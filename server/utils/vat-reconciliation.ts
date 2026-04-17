import type { VatQuarterRange } from '../config/tax-rates.js';
import type { HmrcPaymentMatch } from '../db/repositories/tax.js';
import { round2 } from './math.js';

export type VatReconciliationStatus = 'paid' | 'unpaid' | 'underpaid' | 'not-yet-due' | 'no-income' | 'insufficient-data';

export interface VatQuarterReconciliation {
  quarter: VatQuarterRange;
  expectedAmount: number;
  paidAmount: number;
  paidDate: string | null;
  paidFromAccount: string | null;
  status: VatReconciliationStatus;
}

/**
 * Reconcile a single VAT quarter against a single HMRC payment.
 *
 * VAT is one settling transaction per quarter, so callers are expected to
 * pre-match payments to quarters using `matchPaymentsToQuarters` and pass the
 * resolved match (or null) here. Passing multiple payments is not supported —
 * the matcher owns that concern.
 *
 * @param dataCutoffDate Quarters ending before this date are treated as having
 *   insufficient transaction coverage. Callers should set this to the start of
 *   the *previous* financial year so both the current and prior FY are trusted.
 */
export function reconcileVatQuarter(
  quarter: VatQuarterRange,
  quarterIncome: number,
  vatFraction: number,
  match: HmrcPaymentMatch | null,
  referenceDate: Date = new Date(),
  dataCutoffDate: string | null = null,
): VatQuarterReconciliation {
  const expectedAmount = round2(quarterIncome * vatFraction);

  if (quarterIncome <= 0) {
    return { quarter, expectedAmount: 0, paidAmount: 0, paidDate: null, paidFromAccount: null, status: 'no-income' };
  }

  const paidAmount = match ? round2(Math.abs(match.amount)) : 0;
  const paidDate = match?.date ?? null;
  const paidFromAccount = match?.account ?? null;

  const dueDate = new Date(`${quarter.dueDate}T23:59:59`);
  if (referenceDate < dueDate) {
    const status: VatReconciliationStatus = paidAmount >= expectedAmount * 0.95 ? 'paid' : 'not-yet-due';
    return { quarter, expectedAmount, paidAmount, paidDate, paidFromAccount, status };
  }

  if (!match) {
    const isOutsideTrustedRange = dataCutoffDate !== null && quarter.endDate < dataCutoffDate;
    const status: VatReconciliationStatus = isOutsideTrustedRange ? 'insufficient-data' : 'unpaid';
    return { quarter, expectedAmount, paidAmount: 0, paidDate: null, paidFromAccount: null, status };
  }

  const status: VatReconciliationStatus = paidAmount >= expectedAmount * 0.95 ? 'paid' : 'underpaid';

  return { quarter, expectedAmount, paidAmount, paidDate, paidFromAccount, status };
}
