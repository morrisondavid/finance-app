/**
 * Bill-cover after a debt strategy allocation (§1.9 capital-aware).
 *
 * Layman semantics: how many months of typical bills could you still pay
 * from money left after the plan?
 */

/**
 * Months of bill cover from money available after plan and typical monthly bills.
 * Returns null when `typical_monthly_bills` is not positive (undefined ratio).
 */
export function computeMonthsOfBillCoverAfterPlan(
  moneyAvailableAfterPlan: number,
  typicalMonthlyBills: number,
): number | null {
  if (typicalMonthlyBills <= 0) return null;
  return Math.round((moneyAvailableAfterPlan / typicalMonthlyBills) * 100) / 100;
}

export function isPlanViableAgainstBillCoverFloor(
  monthsOfBillCoverAfterPlan: number | null,
  minimumMonths: number = 2,
): boolean {
  if (monthsOfBillCoverAfterPlan === null) return true;
  return monthsOfBillCoverAfterPlan >= minimumMonths;
}

export function meetsBillCoverComfortTarget(
  monthsOfBillCoverAfterPlan: number | null,
  comfortMonths: number = 3,
): boolean {
  if (monthsOfBillCoverAfterPlan === null) return false;
  return monthsOfBillCoverAfterPlan >= comfortMonths;
}
