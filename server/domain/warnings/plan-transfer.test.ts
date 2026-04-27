import { describe, it, expect } from 'vitest';
import { derivePlanTransferWarnings } from './plan-transfer.js';
import type { Plan } from '../debt-strategy/schema.js';
import type { Movement } from '../debt-strategy/movements-schema.js';

const today = '2026-04-25';

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
    monthly_allocation: over.monthly_allocation ?? 400,
    status: over.status ?? 'active',
    activated_at: over.activated_at ?? '2026-04-01',
    completed_at: over.completed_at ?? null,
    projected_completion_date: over.projected_completion_date ?? null,
    notes: over.notes ?? null,
    updated_at: over.updated_at ?? '2026-04-01',
  };
}

function makeMov(over: Partial<Movement> & Pick<Movement, 'id' | 'plan_id'>): Movement {
  return {
    id: over.id,
    plan_id: over.plan_id,
    from_account: over.from_account ?? 'natwest',
    to_account: over.to_account ?? 'barclays-current',
    amount: over.amount ?? 400,
    day_of_month: over.day_of_month ?? 1,
    expected_start_date: over.expected_start_date ?? '2026-04-01',
    expected_end_date: over.expected_end_date ?? null,
    acknowledged_at: over.acknowledged_at ?? null,
    dismissed_missed_until: over.dismissed_missed_until ?? null,
    updated_at: over.updated_at ?? '2026-04-01',
  };
}

describe('plan-transfer-not-set-up', () => {
  it('fires when >7d since expected_start, no acknowledgment, no match', () => {
    const plan = makePlan({ id: 'p1' });
    // Use a date that's between 7-21 days old to test the warn band.
    const mov = makeMov({ id: 'm1', plan_id: 'p1', expected_start_date: '2026-04-15' });
    const out = derivePlanTransferWarnings({
      today, // 2026-04-25 → 10 days old → warn (not critical yet)
      movementMatches: [{ plan, movement: mov, lastMatchedDate: null }],
    });
    expect(out).toHaveLength(1);
    expect(out[0].code).toBe('plan-transfer-not-set-up');
    expect(out[0].severity).toBe('warn');
  });

  it('upgrades to critical at >=21 days old', () => {
    const plan = makePlan({ id: 'p1' });
    const mov = makeMov({ id: 'm1', plan_id: 'p1', expected_start_date: '2026-04-01' });
    const out = derivePlanTransferWarnings({
      today: '2026-04-25', // 24 days >= 21 critical threshold
      movementMatches: [{ plan, movement: mov, lastMatchedDate: null }],
    });
    expect(out[0].severity).toBe('critical');
  });

  it('does NOT fire when <7 days since expected_start', () => {
    const plan = makePlan({ id: 'p1' });
    const mov = makeMov({ id: 'm1', plan_id: 'p1', expected_start_date: '2026-04-23' });
    const out = derivePlanTransferWarnings({
      today,
      movementMatches: [{ plan, movement: mov, lastMatchedDate: null }],
    });
    expect(out).toEqual([]);
  });

  it('does NOT fire when a recent match exists (the standing order works, just not yet acknowledged)', () => {
    const plan = makePlan({ id: 'p1' });
    const mov = makeMov({ id: 'm1', plan_id: 'p1', expected_start_date: '2026-03-01' });
    const out = derivePlanTransferWarnings({
      today,
      movementMatches: [{ plan, movement: mov, lastMatchedDate: '2026-04-01' }],
    });
    expect(out).toEqual([]);
  });
});

describe('plan-transfer-missed', () => {
  it('fires when acknowledged but no recent match', () => {
    const plan = makePlan({ id: 'p1' });
    const mov = makeMov({
      id: 'm1',
      plan_id: 'p1',
      expected_start_date: '2026-01-01',
      acknowledged_at: '2026-01-01',
    });
    const out = derivePlanTransferWarnings({
      today,
      movementMatches: [{ plan, movement: mov, lastMatchedDate: null }],
    });
    expect(out).toHaveLength(1);
    expect(out[0].code).toBe('plan-transfer-missed');
  });

  it('does NOT fire when there IS a recent match', () => {
    const plan = makePlan({ id: 'p1' });
    const mov = makeMov({
      id: 'm1',
      plan_id: 'p1',
      acknowledged_at: '2026-01-01',
    });
    const out = derivePlanTransferWarnings({
      today,
      movementMatches: [{ plan, movement: mov, lastMatchedDate: '2026-04-01' }],
    });
    expect(out).toEqual([]);
  });

  it('does NOT fire while dismissed_missed_until is in the future', () => {
    const plan = makePlan({ id: 'p1' });
    const mov = makeMov({
      id: 'm1',
      plan_id: 'p1',
      expected_start_date: '2026-01-01',
      acknowledged_at: '2026-01-01',
      dismissed_missed_until: '2026-05-01', // 6 days in the future
    });
    const out = derivePlanTransferWarnings({
      today,
      movementMatches: [{ plan, movement: mov, lastMatchedDate: null }],
    });
    expect(out).toEqual([]);
  });

  it('FIRES again when dismissed_missed_until is in the past (silence expired)', () => {
    const plan = makePlan({ id: 'p1' });
    const mov = makeMov({
      id: 'm1',
      plan_id: 'p1',
      expected_start_date: '2026-01-01',
      acknowledged_at: '2026-01-01',
      dismissed_missed_until: '2026-04-01', // expired
    });
    const out = derivePlanTransferWarnings({
      today,
      movementMatches: [{ plan, movement: mov, lastMatchedDate: null }],
    });
    expect(out).toHaveLength(1);
  });
});

describe('plan-transfer — non-active plans', () => {
  it('skips paused plans entirely', () => {
    const plan = makePlan({ id: 'p1', status: 'paused' });
    const mov = makeMov({ id: 'm1', plan_id: 'p1' });
    const out = derivePlanTransferWarnings({
      today,
      movementMatches: [{ plan, movement: mov, lastMatchedDate: null }],
    });
    expect(out).toEqual([]);
  });

  it('skips completed plans entirely', () => {
    const plan = makePlan({ id: 'p1', status: 'completed' });
    const mov = makeMov({ id: 'm1', plan_id: 'p1' });
    const out = derivePlanTransferWarnings({
      today,
      movementMatches: [{ plan, movement: mov, lastMatchedDate: null }],
    });
    expect(out).toEqual([]);
  });
});
