import { describe, it, expect } from 'vitest';
import { buildDebtStrategyProposal } from './debt-strategy-proposal.js';
import { generatePlan } from './generate-plan.js';

describe('buildDebtStrategyProposal vs generatePlan', () => {
  it('agrees on pay-off-debt totals and movement (single proposal source)', () => {
    const common = {
      goal: {
        goalType: 'pay-off-debt' as const,
        targetId: 'x',
        targetAmount: 20_000,
        targetDateOrAsap: 'ASAP' as const,
        currency: 'GBP' as const,
        scope: 'autonize-it-ltd' as const,
        fromAccount: 'natwest' as const,
        targetAccount: 'barclays-current' as const,
      },
      intensity: 'medium' as const,
      availableHeadroom: 1000,
      today: '2026-04-25',
      budgetedCategories: new Set<string>(),
      requiredBudgetedCategories: new Set<string>(),
      baselineMonthlyTowardTarget: 399,
    };
    const prop = buildDebtStrategyProposal(common);
    const gen = generatePlan({
      goal: {
        goalType: 'pay-off-debt',
        displayName: 'Test',
        targetId: 'x',
        targetAmount: 20_000,
        targetDateOrAsap: 'ASAP',
        currency: 'GBP',
        scope: 'autonize-it-ltd',
        fromAccount: 'natwest',
        targetAccount: 'barclays-current',
        notes: null,
      },
      intensity: 'medium',
      availableHeadroom: 1000,
      today: '2026-04-25',
      planId: 'p',
      movementId: 'm',
      dayOfMonth: 1,
      budgetedCategories: new Set(),
      requiredBudgetedCategories: new Set(),
      baselineMonthlyTowardTarget: 399,
    });
    expect(prop.ok).toBe(true);
    expect(gen.blocked).toBe(false);
    if (!prop.ok || gen.blocked) return;
    expect(gen.plan.monthly_allocation).toBe(prop.totalMonthly);
    expect(gen.movements[0].amount).toBe(prop.movementAmount);
  });
});
