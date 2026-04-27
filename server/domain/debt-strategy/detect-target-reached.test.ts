import { describe, it, expect } from 'vitest';
import { detectTargetReached } from './detect-target-reached.js';
import type { Plan } from './schema.js';

function makePlan(over: Partial<Plan> & Pick<Plan, 'id'>): Plan {
  return {
    id: over.id,
    display_name: over.display_name ?? `Plan ${over.id}`,
    goal_type: over.goal_type ?? 'pay-off-debt',
    target_id: over.target_id ?? 'funding-circle',
    target_amount: over.target_amount ?? null,
    target_account: over.target_account ?? 'barclays-current',
    target_date_or_asap: over.target_date_or_asap ?? 'ASAP',
    currency: over.currency ?? 'GBP',
    scope: over.scope ?? 'autonize-it-ltd',
    intensity: over.intensity ?? 'medium',
    monthly_allocation: over.monthly_allocation ?? 500,
    status: over.status ?? 'active',
    activated_at: over.activated_at ?? '2026-04-25',
    completed_at: over.completed_at ?? null,
    projected_completion_date: over.projected_completion_date ?? null,
    notes: over.notes ?? null,
    updated_at: over.updated_at ?? '2026-04-25',
  };
}

describe('detectTargetReached — pay-off-debt', () => {
  it('reached: true when currentBalance <= 0', () => {
    const out = detectTargetReached({
      plan: makePlan({ id: 'p1', goal_type: 'pay-off-debt' }),
      debtCurrentBalance: 0,
    });
    expect(out.reached).toBe(true);
    expect(out.evidence.kind).toBe('debt-cleared');
  });

  it('reached: true when currentBalance is slightly negative (overpayment)', () => {
    const out = detectTargetReached({
      plan: makePlan({ id: 'p1', goal_type: 'pay-off-debt' }),
      debtCurrentBalance: -50,
    });
    expect(out.reached).toBe(true);
    expect(out.evidence.currentBalance).toBe(-50);
  });

  it('reached: false when currentBalance > 0', () => {
    const out = detectTargetReached({
      plan: makePlan({ id: 'p1', goal_type: 'pay-off-debt' }),
      debtCurrentBalance: 1000,
    });
    expect(out.reached).toBe(false);
    expect(out.evidence.currentBalance).toBe(1000);
  });

  it('reached: false when debt is missing (null balance)', () => {
    const out = detectTargetReached({
      plan: makePlan({ id: 'p1', goal_type: 'pay-off-debt' }),
      debtCurrentBalance: null,
    });
    expect(out.reached).toBe(false);
    expect(out.evidence.kind).toBe('not-reached');
  });

  it('catches balloon payments naturally — once getDebtSummary picks up the £5k balloon, currentBalance drops below 0', () => {
    // Simulating: balance was £5000, balloon of £5000 paid → 
    // getDebtSummary returns currentBalance = 0 (or slightly negative)
    const out = detectTargetReached({
      plan: makePlan({ id: 'p1', goal_type: 'pay-off-debt' }),
      debtCurrentBalance: 0,
    });
    expect(out.reached).toBe(true);
  });
});

describe('detectTargetReached — save-for-target', () => {
  const savePlan = (over: Partial<Plan> = {}) =>
    makePlan({
      id: 'p1',
      goal_type: 'save-for-target',
      target_id: null,
      target_amount: 8000,
      target_account: 'natwest-savings',
      ...over,
    });

  it('reached: true when net inflow ≥ target_amount', () => {
    const out = detectTargetReached({
      plan: savePlan(),
      netInflowSinceActivation: 8000,
    });
    expect(out.reached).toBe(true);
    expect(out.evidence.kind).toBe('savings-target-reached');
  });

  it('reached: true when net inflow exceeds target_amount', () => {
    const out = detectTargetReached({
      plan: savePlan(),
      netInflowSinceActivation: 8500,
    });
    expect(out.reached).toBe(true);
    expect(out.evidence.netInflowSinceActivation).toBe(8500);
  });

  it('reached: false when net inflow < target_amount', () => {
    const out = detectTargetReached({
      plan: savePlan(),
      netInflowSinceActivation: 5000,
    });
    expect(out.reached).toBe(false);
    expect(out.evidence.kind).toBe('not-reached');
    expect(out.evidence.netInflowSinceActivation).toBe(5000);
    expect(out.evidence.targetAmount).toBe(8000);
  });

  it('reached: false when target_amount is null (defensive)', () => {
    const out = detectTargetReached({
      plan: savePlan({ target_amount: null }),
      netInflowSinceActivation: 100,
    });
    expect(out.reached).toBe(false);
  });
});
