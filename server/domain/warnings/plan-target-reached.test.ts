import { describe, it, expect } from 'vitest';
import { derivePlanTargetReachedWarnings } from './plan-target-reached.js';
import type { Plan } from '../debt-strategy/schema.js';
import type { Movement } from '../debt-strategy/movements-schema.js';
import type { DetectTargetReachedResult } from '../debt-strategy/detect-target-reached.js';

function makePlan(over: Partial<Plan> & Pick<Plan, 'id'>): Plan {
  return {
    id: over.id,
    display_name: over.display_name ?? `Plan ${over.id}`,
    goal_type: over.goal_type ?? 'pay-off-debt',
    target_id: over.target_id ?? 'funding-circle',
    target_amount: over.target_amount ?? null,
    target_account: 'barclays-current',
    target_date_or_asap: 'ASAP',
    currency: 'GBP',
    scope: 'autonize-it-ltd',
    intensity: 'medium',
    monthly_allocation: 400,
    status: 'active',
    activated_at: '2026-01-01',
    completed_at: null,
    projected_completion_date: null,
    notes: null,
    updated_at: '2026-04-01',
  };
}

function makeMov(over: Partial<Movement> & Pick<Movement, 'id' | 'plan_id'>): Movement {
  return {
    from_account: 'natwest',
    to_account: 'barclays-current',
    amount: 400,
    day_of_month: 1,
    expected_start_date: '2026-01-01',
    expected_end_date: null,
    acknowledged_at: '2026-01-05',
    dismissed_missed_until: null,
    updated_at: '2026-04-01',
    ...over,
  };
}

const debtClearedReport: DetectTargetReachedResult = {
  reached: true,
  evidence: { kind: 'debt-cleared', currentBalance: 0 },
};

const savingsReachedReport: DetectTargetReachedResult = {
  reached: true,
  evidence: { kind: 'savings-target-reached', netInflowSinceActivation: 8200, targetAmount: 8000 },
};

const notReachedReport: DetectTargetReachedResult = {
  reached: false,
  evidence: { kind: 'not-reached', currentBalance: 1000 },
};

describe('plan-target-reached', () => {
  it('fires plan-target-reached + plan-standing-order-can-be-stopped per acknowledged movement', () => {
    const plan = makePlan({ id: 'p1' });
    const out = derivePlanTargetReachedWarnings({
      today: '2026-04-25',
      items: [
        {
          plan,
          report: debtClearedReport,
          acknowledgedMovements: [
            makeMov({ id: 'm1', plan_id: 'p1' }),
            makeMov({ id: 'm2', plan_id: 'p1', amount: 100 }),
          ],
        },
      ],
    });
    expect(out).toHaveLength(3);
    expect(out[0].code).toBe('plan-target-reached');
    expect(out[1].code).toBe('plan-standing-order-can-be-stopped');
    expect(out[2].code).toBe('plan-standing-order-can-be-stopped');
  });

  it('does NOT fire when not reached', () => {
    const out = derivePlanTargetReachedWarnings({
      today: '2026-04-25',
      items: [
        {
          plan: makePlan({ id: 'p1' }),
          report: notReachedReport,
          acknowledgedMovements: [makeMov({ id: 'm1', plan_id: 'p1' })],
        },
      ],
    });
    expect(out).toEqual([]);
  });

  it('fires correctly for savings-target-reached evidence', () => {
    const plan = makePlan({ id: 'p2', goal_type: 'save-for-target', target_amount: 8000 });
    const out = derivePlanTargetReachedWarnings({
      today: '2026-04-25',
      items: [
        {
          plan,
          report: savingsReachedReport,
          acknowledgedMovements: [],
        },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0].code).toBe('plan-target-reached');
    expect(out[0].context?.evidenceKind).toBe('savings-target-reached');
    expect(out[0].context?.targetAmount).toBe(8000);
  });

  it('emits zero stop-warnings when there are no acknowledged movements', () => {
    const plan = makePlan({ id: 'p1' });
    const out = derivePlanTargetReachedWarnings({
      today: '2026-04-25',
      items: [
        {
          plan,
          report: debtClearedReport,
          acknowledgedMovements: [],
        },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0].code).toBe('plan-target-reached');
  });

  it('catches balloon-payment scenarios — currentBalance dropped to 0 from a one-off payment', () => {
    // Even though the balance dropped via a balloon payment (not a
    // planned standing order), currentBalance <= 0 → reached → fires.
    const plan = makePlan({ id: 'p1' });
    const out = derivePlanTargetReachedWarnings({
      today: '2026-04-25',
      items: [
        {
          plan,
          report: { reached: true, evidence: { kind: 'debt-cleared', currentBalance: -500 } },
          acknowledgedMovements: [],
        },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0].code).toBe('plan-target-reached');
  });
});
