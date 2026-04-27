/**
 * Lost-contract integration test (§1.9 — locks the killer use case).
 *
 * Scenario: an active plan A (e.g. clear Funding Circle) sits comfortably
 * within the user's headroom while a contract is generating income.
 * The contract ends. On the next `/state` call, the planner detects
 * the income drop, the plan's feasibility goes from `ok` to
 * `degraded` (or `infeasible`), and the §1.8 warnings spine emits
 * `plan-feasibility-degraded` with actionable `suggestedRemedies`.
 *
 * The test runs at the pure-module level (against the planner +
 * emitter directly) so it's deterministic and DB-free. The
 * orchestrator's I/O integration is tested through the route smoke
 * tests; this test locks the BEHAVIOUR of the planner+emitter
 * pipeline given the same inputs that lost-contract would produce.
 */

import { describe, it, expect } from 'vitest';
import { availableHeadroom } from './available-headroom.js';
import { checkPlanFeasibility } from './check-plan-feasibility.js';
import { derivePlanFeasibilityDegradedWarnings } from '../warnings/plan-feasibility-degraded.js';
import type { Plan } from './schema.js';

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
    monthly_allocation: over.monthly_allocation ?? 800,
    status: over.status ?? 'active',
    activated_at: '2026-04-01',
    completed_at: null,
    projected_completion_date: null,
    notes: null,
    updated_at: '2026-04-01',
  };
}

describe('lost-contract scenario — feasibility degrades + emitter fires actionable remedies', () => {
  it('plan goes from ok → degraded when total headroom drops below allocation', () => {
    const plan = makePlan({ id: 'plan-clear-funding-circle', monthly_allocation: 800 });

    // Step 1: contract is running, plenty of headroom.
    const beforeReport = checkPlanFeasibility({
      plan,
      totalHeadroom: 2000,
      allActivePlans: [plan],
    });
    expect(beforeReport.status).toBe('ok');

    // Step 2: contract ends → forecast updates → headroom plummets.
    const afterReport = checkPlanFeasibility({
      plan,
      totalHeadroom: 700, // gap = 100, 100/800 = 12.5% → degraded
      allActivePlans: [plan],
    });
    expect(afterReport.status).toBe('degraded');
    expect(afterReport.gap).toBe(100);
  });

  it('plan goes from ok → infeasible when the headroom drop is severe', () => {
    const plan = makePlan({ id: 'plan-clear-funding-circle', monthly_allocation: 800 });
    const after = checkPlanFeasibility({
      plan,
      totalHeadroom: 200, // gap 600/800 = 75% → infeasible
      allActivePlans: [plan],
    });
    expect(after.status).toBe('infeasible');
  });

  it('emits plan-feasibility-degraded (warn) with non-empty suggestedRemedies when degraded', () => {
    const plan = makePlan({ id: 'plan-clear-funding-circle', monthly_allocation: 800 });
    const otherPlan = makePlan({
      id: 'plan-holiday',
      display_name: 'Holiday Fund',
      monthly_allocation: 200,
    });
    const report = checkPlanFeasibility({
      plan,
      totalHeadroom: 800, // 800 - 200 (other) = 600 available; gap 200
      allActivePlans: [plan, otherPlan],
    });
    expect(report.status).toBe('degraded');

    const warnings = derivePlanFeasibilityDegradedWarnings({
      reports: [{ plan, report }],
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe('plan-feasibility-degraded');
    expect(warnings[0].severity).toBe('warn');
    // Remedies are surfaced as primitives the user can act on:
    expect(warnings[0].context?.pauseSuggestionsCsv).toContain('Holiday Fund');
    expect(warnings[0].context?.switchToIntensity).toBeDefined();
  });

  it('emits plan-infeasible (critical) when the headroom drop is severe', () => {
    const plan = makePlan({ id: 'plan-clear-funding-circle', monthly_allocation: 800 });
    const report = checkPlanFeasibility({
      plan,
      totalHeadroom: 100,
      allActivePlans: [plan],
    });
    const warnings = derivePlanFeasibilityDegradedWarnings({
      reports: [{ plan, report }],
    });
    expect(warnings[0].code).toBe('plan-infeasible');
    expect(warnings[0].severity).toBe('critical');
  });

  it('available-headroom integration: pausing the other plan frees its allocation', () => {
    const planA = makePlan({ id: 'plan-clear-funding-circle', monthly_allocation: 800 });
    const planB = makePlan({ id: 'plan-holiday', monthly_allocation: 300, status: 'active' });

    // availableHeadroom subtracts ALL active plans in the bucket. With
    // both active = 1100 claimed > 1000 → floor at 0.
    const before = availableHeadroom({
      totalHeadroom: 1000,
      currency: 'GBP',
      scope: 'autonize-it-ltd',
      allPlans: [planA, planB],
    });
    expect(before).toBe(0);

    // After pausing planB: only planA's 800 claimed → 200 available for new plans.
    const planBPaused: Plan = { ...planB, status: 'paused' };
    const after = availableHeadroom({
      totalHeadroom: 1000,
      currency: 'GBP',
      scope: 'autonize-it-ltd',
      allPlans: [planA, planBPaused],
    });
    expect(after).toBe(200);
  });
});
