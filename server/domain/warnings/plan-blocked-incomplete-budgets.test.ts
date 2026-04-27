import { describe, it, expect } from 'vitest';
import {
  derivePlanBlockedIncompleteBudgetsWarnings,
  PLANNER_REQUIRED_BUDGETED_CATEGORIES,
} from './plan-blocked-incomplete-budgets.js';

describe('plan-blocked-incomplete-budgets', () => {
  it('does NOT fire when there are no plans needing budgets', () => {
    const out = derivePlanBlockedIncompleteBudgetsWarnings({
      hasPlansNeedingBudgets: false,
      budgetedCategories: new Set(),
    });
    expect(out).toEqual([]);
  });

  it('does NOT fire when plans exist but all required categories have budgets', () => {
    const out = derivePlanBlockedIncompleteBudgetsWarnings({
      hasPlansNeedingBudgets: true,
      budgetedCategories: new Set(PLANNER_REQUIRED_BUDGETED_CATEGORIES),
    });
    expect(out).toEqual([]);
  });

  it('fires when plans exist and some required categories are missing budgets', () => {
    const out = derivePlanBlockedIncompleteBudgetsWarnings({
      hasPlansNeedingBudgets: true,
      budgetedCategories: new Set(['Groceries']),
    });
    expect(out).toHaveLength(1);
    expect(out[0].code).toBe('plan-blocked-incomplete-budgets');
    expect(out[0].severity).toBe('warn');
    const missing = out[0].context?.missingCategories as string;
    expect(missing).not.toContain('Groceries');
    expect(missing).toContain('Eating Out');
  });

  it('PLANNER_REQUIRED_BUDGETED_CATEGORIES includes every budgetable category', () => {
    // 11 budgetable categories per the seed config.
    expect(PLANNER_REQUIRED_BUDGETED_CATEGORIES.length).toBeGreaterThan(0);
    expect(PLANNER_REQUIRED_BUDGETED_CATEGORIES).toContain('Groceries');
    expect(PLANNER_REQUIRED_BUDGETED_CATEGORIES).toContain('Eating Out');
    expect(PLANNER_REQUIRED_BUDGETED_CATEGORIES).toContain('Shopping');
    expect(PLANNER_REQUIRED_BUDGETED_CATEGORIES).not.toContain('Housing'); // mandatory
    expect(PLANNER_REQUIRED_BUDGETED_CATEGORIES).not.toContain('Tax'); // mandatory
  });
});
