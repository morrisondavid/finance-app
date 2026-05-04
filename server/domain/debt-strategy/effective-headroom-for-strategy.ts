/**
 * Single source for “how much monthly capacity can intensity options use?”
 * Shared by {@link generatePlan} and {@link autoSuggestPlans}.
 */

export function effectiveHeadroomForStrategyPlanning(input: {
  readonly availableHeadroom: number;
  readonly moneyForDebtStrategy?: number;
  readonly strategyPeriodApproxMonths?: number;
}): number {
  const { availableHeadroom, moneyForDebtStrategy, strategyPeriodApproxMonths } = input;
  const capitalMonthlyBoost =
    moneyForDebtStrategy !== undefined &&
    strategyPeriodApproxMonths !== undefined &&
    strategyPeriodApproxMonths > 0
      ? moneyForDebtStrategy / strategyPeriodApproxMonths
      : 0;
  return Math.max(availableHeadroom, capitalMonthlyBoost);
}
