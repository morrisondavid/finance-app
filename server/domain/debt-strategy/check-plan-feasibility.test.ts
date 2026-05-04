import { describe, it, expect } from 'vitest';
import { checkPlanFeasibility } from './check-plan-feasibility.js';
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

describe('checkPlanFeasibility — status bands', () => {
  it('ok when current available ≥ allocation', () => {
    const plan = makePlan({ id: 'p1', monthly_allocation: 500 });
    const out = checkPlanFeasibility({
      plan,
      totalHeadroom: 1000,
      allActivePlans: [plan],
    });
    expect(out.status).toBe('ok');
    expect(out.gap).toBe(0);
  });

  it('degraded when gap is ≤ 25% of allocation', () => {
    const plan = makePlan({ id: 'p1', monthly_allocation: 500 });
    const out = checkPlanFeasibility({
      plan,
      totalHeadroom: 400, // gap = 100, 100/500 = 20% → degraded
      allActivePlans: [plan],
    });
    expect(out.status).toBe('degraded');
    expect(out.gap).toBe(100);
  });

  it('infeasible when gap > 25% of allocation', () => {
    const plan = makePlan({ id: 'p1', monthly_allocation: 500 });
    const out = checkPlanFeasibility({
      plan,
      totalHeadroom: 200, // gap = 300, 300/500 = 60% → infeasible
      allActivePlans: [plan],
    });
    expect(out.status).toBe('infeasible');
    expect(out.gap).toBe(300);
  });

  it('correctly accounts for OTHER active plans claiming headroom', () => {
    const plan = makePlan({ id: 'p1', monthly_allocation: 500 });
    const other = makePlan({ id: 'p2', monthly_allocation: 400 });
    const out = checkPlanFeasibility({
      plan,
      totalHeadroom: 1000,
      allActivePlans: [plan, other],
    });
    // Other claims 400, so current available for p1 = 600; p1 needs 500 → ok.
    expect(out.status).toBe('ok');
    expect(out.currentAvailable).toBe(600);
  });
});

describe('checkPlanFeasibility — suggested remedies', () => {
  it('suggests switch-intensity to a lower intensity when status is not ok', () => {
    const plan = makePlan({ id: 'p1', monthly_allocation: 950, intensity: 'aggressive' });
    const out = checkPlanFeasibility({
      plan,
      totalHeadroom: 800, // gap = 150, 150/950 ≈ 15.7% → degraded
      allActivePlans: [plan],
    });
    expect(out.status).toBe('degraded');
    const switches = out.suggestedRemedies.filter(r => r.kind === 'switch-intensity');
    expect(switches.length).toBeGreaterThan(0);
    expect(switches.map(s => s.newIntensity).sort()).toEqual(['medium', 'passive']);
  });

  it('suggests pause-other-plan with the largest other allocation first', () => {
    const plan = makePlan({ id: 'p1', monthly_allocation: 600 });
    const other1 = makePlan({ id: 'p2', monthly_allocation: 100, display_name: 'Small other' });
    const other2 = makePlan({ id: 'p3', monthly_allocation: 300, display_name: 'Big other' });
    const out = checkPlanFeasibility({
      plan,
      totalHeadroom: 700, // 100 + 300 + 600 needed; only 700 available
      allActivePlans: [plan, other1, other2],
    });
    expect(out.status).not.toBe('ok');
    const pauses = out.suggestedRemedies.filter(r => r.kind === 'pause-other-plan');
    expect(pauses[0].otherPlanId).toBe('p3');
    expect(pauses[0].freesMonthly).toBe(300);
    expect(pauses[1].otherPlanId).toBe('p2');
  });

  it('suggests extend-deadline only for fixed-date plans', () => {
    const asap = makePlan({ id: 'p1', monthly_allocation: 500, target_date_or_asap: 'ASAP' });
    const fixed = makePlan({ id: 'p2', monthly_allocation: 500, target_date_or_asap: '2027-04-25' });

    const asapOut = checkPlanFeasibility({
      plan: asap,
      totalHeadroom: 200,
      allActivePlans: [asap],
    });
    expect(asapOut.suggestedRemedies.find(r => r.kind === 'extend-deadline')).toBeUndefined();

    const fixedOut = checkPlanFeasibility({
      plan: fixed,
      totalHeadroom: 200,
      allActivePlans: [fixed],
    });
    expect(fixedOut.suggestedRemedies.find(r => r.kind === 'extend-deadline')).toBeDefined();
  });

  it('suggests reduce-target-amount only for save-for-target plans', () => {
    const debt = makePlan({ id: 'p1', goal_type: 'pay-off-debt', monthly_allocation: 500 });
    const save = makePlan({
      id: 'p2',
      goal_type: 'save-for-target',
      target_id: null,
      target_amount: 5000,
      monthly_allocation: 500,
    });

    const debtOut = checkPlanFeasibility({
      plan: debt,
      totalHeadroom: 200,
      allActivePlans: [debt],
    });
    expect(debtOut.suggestedRemedies.find(r => r.kind === 'reduce-target-amount')).toBeUndefined();

    const saveOut = checkPlanFeasibility({
      plan: save,
      totalHeadroom: 200,
      allActivePlans: [save],
    });
    expect(saveOut.suggestedRemedies.find(r => r.kind === 'reduce-target-amount')).toBeDefined();
  });

  it('returns no remedies when status is ok', () => {
    const plan = makePlan({ id: 'p1', monthly_allocation: 500 });
    const out = checkPlanFeasibility({
      plan,
      totalHeadroom: 1000,
      allActivePlans: [plan],
    });
    expect(out.status).toBe('ok');
    expect(out.suggestedRemedies).toEqual([]);
  });
});

describe('checkPlanFeasibility — bill cover floor', () => {
  it('forces infeasible when months_of_bill_cover_after_plan is below 2', () => {
    const plan = makePlan({ id: 'p1', monthly_allocation: 500 });
    const out = checkPlanFeasibility({
      plan,
      totalHeadroom: 2000,
      allActivePlans: [plan],
      monthsOfBillCoverAfterPlan: 1.5,
    });
    expect(out.status).toBe('infeasible');
    expect(out.months_of_bill_cover_after_plan).toBe(1.5);
    expect(out.bill_cover_viable).toBe(false);
  });

  it('allows ok when bill cover is at least 2 months', () => {
    const plan = makePlan({ id: 'p1', monthly_allocation: 500 });
    const out = checkPlanFeasibility({
      plan,
      totalHeadroom: 2000,
      allActivePlans: [plan],
      monthsOfBillCoverAfterPlan: 2,
    });
    expect(out.status).toBe('ok');
    expect(out.bill_cover_viable).toBe(true);
  });

  it('treats missing bill-cover data as viable (null)', () => {
    const plan = makePlan({ id: 'p1', monthly_allocation: 500 });
    const out = checkPlanFeasibility({
      plan,
      totalHeadroom: 2000,
      allActivePlans: [plan],
    });
    expect(out.months_of_bill_cover_after_plan).toBeNull();
    expect(out.bill_cover_viable).toBe(true);
  });
});
