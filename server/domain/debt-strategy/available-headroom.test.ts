import { describe, it, expect } from 'vitest';
import { availableHeadroom } from './available-headroom.js';
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
    monthly_allocation: over.monthly_allocation ?? 100,
    status: over.status ?? 'active',
    activated_at: over.activated_at ?? '2026-01-01',
    completed_at: over.completed_at ?? null,
    projected_completion_date: over.projected_completion_date ?? null,
    notes: over.notes ?? null,
    updated_at: over.updated_at ?? '2026-01-01',
  };
}

describe('availableHeadroom', () => {
  it('returns total when there are no plans', () => {
    expect(
      availableHeadroom({
        totalHeadroom: 1000,
        currency: 'GBP',
        scope: 'autonize-it-ltd',
        allPlans: [],
      }),
    ).toBe(1000);
  });

  it('subtracts a single active plan in matching currency+scope', () => {
    expect(
      availableHeadroom({
        totalHeadroom: 1000,
        currency: 'GBP',
        scope: 'autonize-it-ltd',
        allPlans: [makePlan({ id: 'p1', monthly_allocation: 400 })],
      }),
    ).toBe(600);
  });

  it('subtracts multiple active plans (sum)', () => {
    expect(
      availableHeadroom({
        totalHeadroom: 1000,
        currency: 'GBP',
        scope: 'autonize-it-ltd',
        allPlans: [
          makePlan({ id: 'p1', monthly_allocation: 400 }),
          makePlan({ id: 'p2', monthly_allocation: 300 }),
        ],
      }),
    ).toBe(300);
  });

  it('ignores non-active plans (paused / completed do NOT consume headroom)', () => {
    expect(
      availableHeadroom({
        totalHeadroom: 1000,
        currency: 'GBP',
        scope: 'autonize-it-ltd',
        allPlans: [
          makePlan({ id: 'p1', monthly_allocation: 400, status: 'paused' }),
          makePlan({ id: 'p2', monthly_allocation: 200, status: 'completed' }),
        ],
      }),
    ).toBe(1000);
  });

  it('ignores plans in a different currency', () => {
    expect(
      availableHeadroom({
        totalHeadroom: 1000,
        currency: 'GBP',
        scope: 'autonize-it-ltd',
        allPlans: [makePlan({ id: 'p1', monthly_allocation: 400, currency: 'AED' })],
      }),
    ).toBe(1000);
  });

  it('ignores plans in a different scope', () => {
    expect(
      availableHeadroom({
        totalHeadroom: 1000,
        currency: 'GBP',
        scope: 'autonize-it-ltd',
        allPlans: [makePlan({ id: 'p1', monthly_allocation: 400, scope: 'household' })],
      }),
    ).toBe(1000);
  });

  it('floors at 0 when allocations exceed headroom', () => {
    expect(
      availableHeadroom({
        totalHeadroom: 500,
        currency: 'GBP',
        scope: 'autonize-it-ltd',
        allPlans: [
          makePlan({ id: 'p1', monthly_allocation: 400 }),
          makePlan({ id: 'p2', monthly_allocation: 200 }),
        ],
      }),
    ).toBe(0);
  });
});
