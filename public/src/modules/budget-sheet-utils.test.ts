import { describe, it, expect } from 'vitest';
import { eligibleCategoriesForPeriod } from './budget-sheet-utils';
import type { BudgetRow } from '../../../shared/api-contracts.js';

describe('eligibleCategoriesForPeriod', () => {
  const all = ['Groceries', 'Travel', 'Other'];

  it('excludes categories that have a budget in the other period', () => {
    const budgets: BudgetRow[] = [
      { id: 1, account: 'natwest', category: 'Groceries', amount: 100, period: 'monthly' },
    ];
    expect(eligibleCategoriesForPeriod(all, budgets, 'yearly')).toEqual(['Travel', 'Other']);
    expect(eligibleCategoriesForPeriod(all, budgets, 'monthly')).toEqual(['Groceries', 'Travel', 'Other']);
  });

  it('allows all categories when no budgets exist', () => {
    expect(eligibleCategoriesForPeriod(all, [], 'monthly')).toEqual(all);
    expect(eligibleCategoriesForPeriod(all, [], 'yearly')).toEqual(all);
  });
});
