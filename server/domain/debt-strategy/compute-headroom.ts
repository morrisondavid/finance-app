/**
 * Pure: compute headroom for a given currency + scope (§1.9).
 *
 * Headroom = forecastedMonthlyIncome
 *          − mandatoryMonthly
 *          − Σ(categoryBudgets[*].monthlyCap)
 *
 * The planner subtracts ALL category budgets — both QoL and malleable.
 * Both are inviolable at this layer; the malleable distinction only
 * matters in the activation UI where the user manually edits to free
 * more allocation.
 *
 * Currency- and scope-aware: callers filter their inputs to the
 * relevant currency / scope BEFORE calling. This keeps the function
 * side-effect free and trivially testable.
 *
 * Floor at 0 — negative headroom is meaningless for planning purposes
 * (the user is already in trouble; that's a feasibility-degraded
 * warning's job).
 */

import type { CurrencyCode } from '../../../shared/api-contracts.js';

export interface CategoryBudgetInput {
  /** The category name (used only for diagnostics; the budget cap is what matters here). */
  readonly category: string;
  /** Monthly cap in the same currency the headroom is computed in. */
  readonly monthlyCap: number;
}

export interface ComputeHeadroomInput {
  /** Currency this headroom slice exists in. Caller filters inputs accordingly. */
  readonly currency: CurrencyCode;
  /** Forecasted monthly income for this currency + scope. */
  readonly forecastedMonthlyIncome: number;
  /** Total mandatory monthly bills for this currency + scope. */
  readonly mandatoryMonthly: number;
  /** All category budgets (QoL + malleable) the user has set for this slice. */
  readonly categoryBudgets: readonly CategoryBudgetInput[];
}

export function computeHeadroom(input: ComputeHeadroomInput): number {
  const totalBudgets = input.categoryBudgets.reduce((sum, b) => sum + b.monthlyCap, 0);
  const headroom = input.forecastedMonthlyIncome - input.mandatoryMonthly - totalBudgets;
  return Math.max(0, headroom);
}
