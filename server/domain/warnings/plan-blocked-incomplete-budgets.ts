/**
 * Surfaces missing category budgets when there are §1.9 plans
 * (suggested or active). The planner refuses to model headroom
 * accurately when QoL/Malleable categories don't have explicit caps,
 * so this warning gives the user a path to fill the gap.
 *
 * The list of "required" categories is the union of QoL + Malleable
 * (i.e., everything `budgetable: true` in `CATEGORY_CONFIG`). Mandatory
 * categories don't need budgets — they're modelled via `obligations.csv`
 * and the recurring pipeline.
 *
 * Pure: caller passes the active/suggested-plan-state + the budgeted
 * categories.
 */

import type { EntityFoundationWarning } from '../../../shared/api-contracts.js';
import { CATEGORY_CONFIG } from '../../utils/categorizer.js';

export interface DerivePlanBlockedIncompleteBudgetsInput {
  /** True when there's at least one suggested or active plan (the trigger). */
  readonly hasPlansNeedingBudgets: boolean;
  /** Categories that DO have explicit budget rows. */
  readonly budgetedCategories: ReadonlySet<string>;
}

/**
 * The categories the planner expects to find a budget for. Computed
 * once at module load from the `CATEGORY_CONFIG` shape.
 */
export const PLANNER_REQUIRED_BUDGETED_CATEGORIES: readonly string[] = Object.entries(
  CATEGORY_CONFIG,
)
  .filter(([, cfg]) => cfg.budgetable)
  .map(([name]) => name);

export function derivePlanBlockedIncompleteBudgetsWarnings(
  input: DerivePlanBlockedIncompleteBudgetsInput,
): EntityFoundationWarning[] {
  if (!input.hasPlansNeedingBudgets) return [];
  const missing = PLANNER_REQUIRED_BUDGETED_CATEGORIES.filter(
    c => !input.budgetedCategories.has(c),
  );
  if (missing.length === 0) return [];
  return [
    {
      id: 'plan-blocked-incomplete-budgets',
      code: 'plan-blocked-incomplete-budgets',
      severity: 'warn',
      title: `${missing.length} budgetable categories have no explicit cap`,
      detail:
        `The §1.9 Debt Strategy planner needs every QoL/Malleable category to have an ` +
        `explicit cap set in the Budgets tab so headroom math is honest. ` +
        `Missing: ${missing.join(', ')}. Plans cannot be activated until these are filled in.`,
      recommended_action:
        `Open the Budgets tab and add a cap for each of: ${missing.join(', ')}. The planner ` +
        `does NOT auto-derive defaults from your historical spending — your budgets are the truth.`,
      sources: ['category-budgets', 'plan-blocked-incomplete-budgets'],
      context: {
        missingCategories: missing.join(','),
        missingCount: missing.length,
        totalRequired: PLANNER_REQUIRED_BUDGETED_CATEGORIES.length,
      },
    },
  ];
}
