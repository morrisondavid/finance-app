import { describe, it, expect } from 'vitest';
import { derivePlanFeasibilityDegradedWarnings } from './plan-feasibility-degraded.js';
import type { Plan } from '../debt-strategy/schema.js';
import type { FeasibilityReport } from '../debt-strategy/check-plan-feasibility.js';

function makePlan(over: Partial<Plan> & Pick<Plan, 'id'>): Plan {
  return {
    id: over.id,
    display_name: over.display_name ?? `Plan ${over.id}`,
    goal_type: 'pay-off-debt',
    target_id: 'funding-circle',
    target_amount: null,
    target_account: 'barclays-current',
    target_date_or_asap: 'ASAP',
    currency: 'GBP',
    scope: 'autonize-it-ltd',
    intensity: 'medium',
    monthly_allocation: 500,
    status: 'active',
    activated_at: '2026-04-01',
    completed_at: null,
    projected_completion_date: null,
    notes: null,
    updated_at: '2026-04-01',
  };
}

const okReport: FeasibilityReport = {
  status: 'ok',
  gap: 0,
  requiredAllocation: 500,
  currentAvailable: 1000,
  suggestedRemedies: [],
  months_of_bill_cover_after_plan: null,
  bill_cover_viable: true,
};

const degradedReport: FeasibilityReport = {
  status: 'degraded',
  gap: 100,
  requiredAllocation: 500,
  currentAvailable: 400,
  months_of_bill_cover_after_plan: 4,
  bill_cover_viable: true,
  suggestedRemedies: [
    {
      kind: 'pause-other-plan',
      freesMonthly: 200,
      otherPlanId: 'p2',
      otherPlanDisplayName: 'Holiday Fund',
    },
    { kind: 'switch-intensity', freesMonthly: 250, newIntensity: 'passive' },
  ],
};

const infeasibleReport: FeasibilityReport = {
  status: 'infeasible',
  gap: 400,
  requiredAllocation: 500,
  currentAvailable: 100,
  months_of_bill_cover_after_plan: null,
  bill_cover_viable: true,
  suggestedRemedies: [
    {
      kind: 'pause-other-plan',
      freesMonthly: 300,
      otherPlanId: 'p3',
      otherPlanDisplayName: 'Big Other Plan',
    },
  ],
};

describe('plan-feasibility warnings', () => {
  it('does NOT fire for ok status', () => {
    const out = derivePlanFeasibilityDegradedWarnings({
      reports: [{ plan: makePlan({ id: 'p1' }), report: okReport }],
    });
    expect(out).toEqual([]);
  });

  it('fires plan-feasibility-degraded (warn) for degraded status', () => {
    const out = derivePlanFeasibilityDegradedWarnings({
      reports: [{ plan: makePlan({ id: 'p1' }), report: degradedReport }],
    });
    expect(out).toHaveLength(1);
    expect(out[0].code).toBe('plan-feasibility-degraded');
    expect(out[0].severity).toBe('warn');
    expect(out[0].context?.gapGbp).toBe(100);
  });

  it('fires plan-infeasible (critical) for infeasible status', () => {
    const out = derivePlanFeasibilityDegradedWarnings({
      reports: [{ plan: makePlan({ id: 'p1' }), report: infeasibleReport }],
    });
    expect(out).toHaveLength(1);
    expect(out[0].code).toBe('plan-infeasible');
    expect(out[0].severity).toBe('critical');
  });

  it('flattens suggestedRemedies into context primitives', () => {
    const out = derivePlanFeasibilityDegradedWarnings({
      reports: [{ plan: makePlan({ id: 'p1' }), report: degradedReport }],
    });
    expect(out[0].context?.remedyKinds).toContain('pause-other-plan');
    expect(out[0].context?.remedyKinds).toContain('switch-intensity');
    expect(out[0].context?.pauseSuggestionsCsv).toContain('Holiday Fund@£200');
    expect(out[0].context?.switchToIntensity).toBe('passive');
  });
});
