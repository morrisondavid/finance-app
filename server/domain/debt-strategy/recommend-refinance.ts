/**
 * Product rule: when a balance-transfer + overpay beats keeping the loan (§1.9).
 * Consumer must still see all three plans in UI; this only picks a recommendation primitive.
 */

import type { EvaluateRefinanceTradeoffResult } from './evaluate-refinance-tradeoff.js';

export type RefinanceRecommendationKind =
  | 'prefer_balance_transfer_same_payment'
  | 'prefer_keep'
  | 'no_clear_winner';

export interface RefinanceRecommendation {
  readonly kind: RefinanceRecommendationKind;
  /** When `prefer_balance_transfer_same_payment`, savings vs keep-as-is (can be 0). */
  readonly total_cost_savings_vs_keep: number;
}

const DEFAULT_COST_EPSILON = 1;

/**
 * Prefer Plan B (overpay same monthly as today) when its total cost is
 * meaningfully lower than paying the source debt as-is.
 */
export function recommendRefinanceFromTradeoff(
  result: EvaluateRefinanceTradeoffResult,
  costEpsilon: number = DEFAULT_COST_EPSILON,
): RefinanceRecommendation {
  const keepCost = result.planA_keepAsIs.totalCost;
  const overpayCost = result.planB_overpay.totalCost;

  if (overpayCost < keepCost - costEpsilon) {
    return {
      kind: 'prefer_balance_transfer_same_payment',
      total_cost_savings_vs_keep: Math.round((keepCost - overpayCost) * 100) / 100,
    };
  }
  if (keepCost < overpayCost - costEpsilon) {
    return {
      kind: 'prefer_keep',
      total_cost_savings_vs_keep: 0,
    };
  }
  return {
    kind: 'no_clear_winner',
    total_cost_savings_vs_keep: 0,
  };
}
