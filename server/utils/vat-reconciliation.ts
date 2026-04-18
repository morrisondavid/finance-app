import type { VatQuarterRange } from '../config/tax-rates.js';
import type { HmrcPaymentMatch } from '../db/repositories/tax.js';
import { round2 } from './math.js';

/**
 * Simplified VAT quarter status.
 *
 * - `paid`            — a VAT payment has been attributed to this quarter.
 *                       Amount match is irrelevant; the presence of a payment
 *                       proves HMRC considers the quarter settled.
 * - `not-yet-due`     — due date has not passed and no match was found.
 * - `unpaid`          — due date has passed, the quarter is inside our trusted
 *                       data window, and no payment could be attributed.
 * - `insufficient-data` — due date has passed but the quarter ended before our
 *                       trusted data cutoff; we have no basis to claim it is
 *                       actually unpaid.
 */
export type VatReconciliationStatus = 'paid' | 'unpaid' | 'not-yet-due' | 'insufficient-data';

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
 * The VAT estimate this codebase calculates is a best-effort figure from our
 * ledger — the real figure is whatever HMRC actually billed. Therefore:
 *
 *   match present  => paid (regardless of amount)
 *   match absent   => not-yet-due / unpaid / insufficient-data
 *
 * We no longer flag "underpaid" or "no-income" states; `expectedAmount` is
 * returned purely for informational display.
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
  const expectedAmount = round2(Math.max(0, quarterIncome) * vatFraction);

  if (match) {
    return {
      quarter,
      expectedAmount,
      paidAmount: round2(Math.abs(match.amount)),
      paidDate: match.date,
      paidFromAccount: match.account,
      status: 'paid',
    };
  }

  const dueDate = new Date(`${quarter.dueDate}T23:59:59`);
  if (referenceDate < dueDate) {
    return { quarter, expectedAmount, paidAmount: 0, paidDate: null, paidFromAccount: null, status: 'not-yet-due' };
  }

  const isOutsideTrustedRange = dataCutoffDate !== null && quarter.endDate < dataCutoffDate;
  const status: VatReconciliationStatus = isOutsideTrustedRange ? 'insufficient-data' : 'unpaid';
  return { quarter, expectedAmount, paidAmount: 0, paidDate: null, paidFromAccount: null, status };
}
