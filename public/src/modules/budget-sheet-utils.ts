import type { BudgetPeriod, BudgetRow } from '../../../shared/api-contracts.js';

/**
 * Categories available for adding a budget in `period`, excluding categories
 * that already have a budget in the other period (mutually exclusive per category).
 */
export function eligibleCategoriesForPeriod(
  allCategories: readonly string[],
  budgets: readonly BudgetRow[],
  period: BudgetPeriod,
): string[] {
  const blocked = new Set(
    budgets.filter(b => b.period !== period).map(b => b.category),
  );
  return allCategories.filter(c => !blocked.has(c));
}
