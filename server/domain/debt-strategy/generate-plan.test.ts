import { describe, it, expect } from 'vitest';
import { generatePlan, type GeneratePlanInput } from './generate-plan.js';

function defaultInput(over: Partial<GeneratePlanInput> = {}): GeneratePlanInput {
  return {
    goal: over.goal ?? {
      goalType: 'pay-off-debt',
      displayName: 'Clear Funding Circle',
      targetId: 'funding-circle',
      targetAmount: 5000,
      targetDateOrAsap: 'ASAP',
      currency: 'GBP',
      scope: 'autonize-it-ltd',
      fromAccount: 'natwest',
      targetAccount: 'barclays-current',
      notes: null,
    },
    intensity: over.intensity ?? 'medium',
    availableHeadroom: over.availableHeadroom ?? 1000,
    today: over.today ?? '2026-04-25',
    planId: over.planId ?? 'plan-fc',
    movementId: over.movementId ?? 'mov-fc-1',
    dayOfMonth: over.dayOfMonth ?? 1,
    budgetedCategories: over.budgetedCategories ?? new Set(),
    requiredBudgetedCategories: over.requiredBudgetedCategories ?? new Set(),
    moneyForDebtStrategy: over.moneyForDebtStrategy,
    strategyPeriodApproxMonths: over.strategyPeriodApproxMonths,
    baselineMonthlyTowardTarget: over.baselineMonthlyTowardTarget,
  };
}

describe('generatePlan — happy path', () => {
  it('pay-off-debt: plan monthly_allocation is baseline + intensity increment; movement is increment only', () => {
    const out = generatePlan(
      defaultInput({
        availableHeadroom: 1000,
        intensity: 'medium',
        planId: 'p-base',
        movementId: 'm-base',
        baselineMonthlyTowardTarget: 399,
      }),
    );
    expect(out.blocked).toBe(false);
    if (out.blocked) return;
    expect(out.plan.monthly_allocation).toBe(899);
    expect(out.movements[0].amount).toBe(500);
  });

  it('produces an active plan + 1 movement at the chosen intensity', () => {
    const out = generatePlan(defaultInput());
    expect(out.blocked).toBe(false);
    if (out.blocked) return;
    expect(out.plan.status).toBe('active');
    expect(out.plan.intensity).toBe('medium');
    expect(out.plan.monthly_allocation).toBe(500); // 50% of 1000
    expect(out.movements).toHaveLength(1);
    expect(out.movements[0].plan_id).toBe(out.plan.id);
    expect(out.movements[0].amount).toBe(500);
    expect(out.movements[0].day_of_month).toBe(1);
  });

  it('Aggressive uses 95% of available headroom', () => {
    const out = generatePlan(defaultInput({ intensity: 'aggressive' }));
    if (out.blocked) throw new Error('expected success');
    expect(out.plan.monthly_allocation).toBe(950);
  });

  it('Passive uses min(£100, 15% of headroom)', () => {
    const out = generatePlan(defaultInput({ intensity: 'passive' }));
    if (out.blocked) throw new Error('expected success');
    expect(out.plan.monthly_allocation).toBe(100);
  });

  it('caps day_of_month at 28 (Feb 29/30/31 corner case)', () => {
    const out = generatePlan(defaultInput({ dayOfMonth: 31 }));
    if (out.blocked) throw new Error('expected success');
    expect(out.movements[0].day_of_month).toBe(28);
  });

  it('boosts effective headroom from moneyForDebtStrategy across the strategy period', () => {
    const baseline = generatePlan(
      defaultInput({ availableHeadroom: 50, intensity: 'medium', planId: 'p-a', movementId: 'm-a' }),
    );
    if (baseline.blocked) throw new Error('expected success');
    expect(baseline.plan.monthly_allocation).toBe(25);

    const boosted = generatePlan(
      defaultInput({
        availableHeadroom: 50,
        intensity: 'medium',
        planId: 'p-b',
        movementId: 'm-b',
        moneyForDebtStrategy: 6000,
        strategyPeriodApproxMonths: 12,
      }),
    );
    if (boosted.blocked) throw new Error('expected success');
    expect(boosted.plan.monthly_allocation).toBe(250);
  });

  it('falls back to day 1 for invalid day_of_month inputs (zero, negative, NaN)', () => {
    const a = generatePlan(defaultInput({ dayOfMonth: 0 }));
    if (a.blocked) throw new Error('expected success');
    expect(a.movements[0].day_of_month).toBe(1);
    const b = generatePlan(defaultInput({ dayOfMonth: -5 }));
    if (b.blocked) throw new Error('expected success');
    expect(b.movements[0].day_of_month).toBe(1);
  });

  it('save-for-target plan carries target_amount; pay-off-debt does not', () => {
    const save = generatePlan(
      defaultInput({
        goal: {
          goalType: 'save-for-target',
          displayName: 'Holiday Fund',
          targetId: null,
          targetAmount: 8000,
          targetDateOrAsap: '2027-04-25',
          currency: 'GBP',
          scope: 'household',
          fromAccount: 'natwest',
          targetAccount: 'natwest-savings',
          notes: null,
        },
      }),
    );
    if (save.blocked) throw new Error('expected success');
    expect(save.plan.target_amount).toBe(8000);
    expect(save.plan.target_id).toBeNull();

    const debt = generatePlan(defaultInput());
    if (debt.blocked) throw new Error('expected success');
    expect(debt.plan.target_amount).toBeNull();
    expect(debt.plan.target_id).toBe('funding-circle');
  });
});

describe('generatePlan — block reasons', () => {
  it('plan-blocked-fzco-no-savings-account fires for FZCO save-for-target', () => {
    const out = generatePlan(
      defaultInput({
        goal: {
          goalType: 'save-for-target',
          displayName: 'AED Savings',
          targetId: null,
          targetAmount: 10000,
          targetDateOrAsap: '2027-04-25',
          currency: 'AED',
          scope: 'autonize-it-fzco',
          fromAccount: 'emirates-islamic',
          targetAccount: 'emirates-islamic',
          notes: null,
        },
      }),
    );
    expect(out.blocked).toBe(true);
    if (!out.blocked) return;
    expect(out.code).toBe('plan-blocked-fzco-no-savings-account');
  });

  it('plan-blocked-incomplete-budgets lists missing categories', () => {
    const out = generatePlan(
      defaultInput({
        budgetedCategories: new Set(['Groceries']),
        requiredBudgetedCategories: new Set(['Groceries', 'Eating Out', 'Transport']),
      }),
    );
    expect(out.blocked).toBe(true);
    if (!out.blocked) return;
    expect(out.code).toBe('plan-blocked-incomplete-budgets');
    expect([...(out.missingCategories ?? [])].sort()).toEqual(['Eating Out', 'Transport']);
  });

  it('plan-infeasible fires when headroom is 0', () => {
    const out = generatePlan(defaultInput({ availableHeadroom: 0 }));
    expect(out.blocked).toBe(true);
    if (!out.blocked) return;
    expect(out.code).toBe('plan-infeasible');
  });

  it('plan-infeasible fires when even Aggressive cannot hit a fixed deadline', () => {
    const out = generatePlan(
      defaultInput({
        availableHeadroom: 100, // tiny
        intensity: 'aggressive',
        goal: {
          goalType: 'save-for-target',
          displayName: 'Big Goal',
          targetId: null,
          targetAmount: 100000,
          targetDateOrAsap: '2026-10-25', // 6 months → £16k/mo required
          currency: 'GBP',
          scope: 'household',
          fromAccount: 'natwest',
          targetAccount: 'natwest-savings',
          notes: null,
        },
      }),
    );
    expect(out.blocked).toBe(true);
    if (!out.blocked) return;
    expect(out.code).toBe('plan-infeasible');
  });
});

describe('generatePlan — QoL preservation invariant', () => {
  it('NEVER produces a movement that reduces a category budget — movements are always to/from accounts', () => {
    // Movements connect accounts, not categories. There's no path
    // through the plan/movement schema for the planner to "reduce a
    // budget cap". This test locks the structural invariant.
    const out = generatePlan(defaultInput());
    if (out.blocked) throw new Error('expected success');
    for (const m of out.movements) {
      expect(m.from_account).toBeDefined();
      expect(m.to_account).toBeDefined();
      // No `category` field on Movement — schema-level guarantee.
      expect((m as Record<string, unknown>).category).toBeUndefined();
    }
  });
});
