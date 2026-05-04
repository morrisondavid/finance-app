import { describe, it, expect } from 'vitest';
import { autoSuggestPlans, bucketKey, type AutoSuggestDebt } from './auto-suggest-plans.js';
import type { Plan } from './schema.js';

function makeDebt(over: Partial<AutoSuggestDebt> & Pick<AutoSuggestDebt, 'id'>): AutoSuggestDebt {
  return {
    id: over.id,
    name: over.name ?? `Debt ${over.id}`,
    apr: over.apr ?? 0.1,
    kind: over.kind ?? 'consumer',
    archived: over.archived ?? false,
    currentBalance: over.currentBalance ?? 5000,
    fromAccount: over.fromAccount ?? 'natwest',
    currency: over.currency ?? 'GBP',
    scope: over.scope ?? 'autonize-it-ltd',
  };
}

/** Neutral holistic context: same behaviour as bucket-only headroom before cross-bucket boost. */
function capitalContext() {
  return {
    holisticMoneyForDebtGbp: 0,
    holisticMoneyForDebtAed: 0,
    strategyPeriodApproxMonths: 1,
  } as const;
}

function makePlan(over: Partial<Plan> & Pick<Plan, 'id'>): Plan {
  return {
    id: over.id,
    display_name: over.display_name ?? `Plan ${over.id}`,
    goal_type: over.goal_type ?? 'pay-off-debt',
    target_id: over.target_id ?? null,
    target_amount: over.target_amount ?? null,
    target_account: over.target_account ?? 'barclays-current',
    target_date_or_asap: over.target_date_or_asap ?? 'ASAP',
    currency: over.currency ?? 'GBP',
    scope: over.scope ?? 'autonize-it-ltd',
    intensity: over.intensity ?? 'medium',
    monthly_allocation: over.monthly_allocation ?? 200,
    status: over.status ?? 'active',
    activated_at: over.activated_at ?? '2026-04-25',
    completed_at: over.completed_at ?? null,
    projected_completion_date: over.projected_completion_date ?? null,
    notes: over.notes ?? null,
    updated_at: over.updated_at ?? '2026-04-25',
  };
}

describe('autoSuggestPlans', () => {
  it('returns one suggestion per active consumer debt without a live plan, in avalanche order', () => {
    const debts: AutoSuggestDebt[] = [
      makeDebt({ id: 'd-low', apr: 0.05 }),
      makeDebt({ id: 'd-high', apr: 0.25 }),
      makeDebt({ id: 'd-mid', apr: 0.15 }),
    ];
    const out = autoSuggestPlans({
      debts,
      persistedPlans: [],
      availableHeadroomByBucket: new Map([[bucketKey('GBP', 'autonize-it-ltd'), 1000]]),
      today: '2026-04-25',
      ...capitalContext(),
    });
    expect(out.map(s => s.target_id)).toEqual(['d-high', 'd-mid', 'd-low']);
    expect(out[0].status).toBe('suggested');
    expect(out[0].intensity).toBe('medium');
  });

  it('skips mortgages', () => {
    const out = autoSuggestPlans({
      debts: [
        makeDebt({ id: 'mortgage', kind: 'mortgage', apr: 0.045 }),
        makeDebt({ id: 'loan', kind: 'consumer' }),
      ],
      persistedPlans: [],
      availableHeadroomByBucket: new Map([[bucketKey('GBP', 'autonize-it-ltd'), 1000]]),
      today: '2026-04-25',
      ...capitalContext(),
    });
    expect(out.map(s => s.target_id)).toEqual(['loan']);
  });

  it('skips archived debts', () => {
    const out = autoSuggestPlans({
      debts: [
        makeDebt({ id: 'old', archived: true }),
        makeDebt({ id: 'live' }),
      ],
      persistedPlans: [],
      availableHeadroomByBucket: new Map([[bucketKey('GBP', 'autonize-it-ltd'), 1000]]),
      today: '2026-04-25',
      ...capitalContext(),
    });
    expect(out.map(s => s.target_id)).toEqual(['live']);
  });

  it('skips debts with currentBalance ≤ 0', () => {
    const out = autoSuggestPlans({
      debts: [
        makeDebt({ id: 'cleared', currentBalance: 0 }),
        makeDebt({ id: 'live', currentBalance: 5000 }),
      ],
      persistedPlans: [],
      availableHeadroomByBucket: new Map([[bucketKey('GBP', 'autonize-it-ltd'), 1000]]),
      today: '2026-04-25',
      ...capitalContext(),
    });
    expect(out.map(s => s.target_id)).toEqual(['live']);
  });

  it('skips debts already covered by an ACTIVE plan', () => {
    const out = autoSuggestPlans({
      debts: [
        makeDebt({ id: 'd1' }),
        makeDebt({ id: 'd2' }),
      ],
      persistedPlans: [makePlan({ id: 'p1', target_id: 'd1', status: 'active' })],
      availableHeadroomByBucket: new Map([[bucketKey('GBP', 'autonize-it-ltd'), 1000]]),
      today: '2026-04-25',
      ...capitalContext(),
    });
    expect(out.map(s => s.target_id)).toEqual(['d2']);
  });

  it('skips debts already covered by a PAUSED plan (still claiming the slot conceptually)', () => {
    const out = autoSuggestPlans({
      debts: [makeDebt({ id: 'd1' })],
      persistedPlans: [makePlan({ id: 'p1', target_id: 'd1', status: 'paused' })],
      availableHeadroomByBucket: new Map([[bucketKey('GBP', 'autonize-it-ltd'), 1000]]),
      today: '2026-04-25',
      ...capitalContext(),
    });
    expect(out).toEqual([]);
  });

  it('DOES re-suggest for a debt with a COMPLETED plan (the prior plan is finished)', () => {
    const out = autoSuggestPlans({
      debts: [makeDebt({ id: 'd1' })],
      persistedPlans: [makePlan({ id: 'p1', target_id: 'd1', status: 'completed' })],
      availableHeadroomByBucket: new Map([[bucketKey('GBP', 'autonize-it-ltd'), 1000]]),
      today: '2026-04-25',
      ...capitalContext(),
    });
    expect(out.map(s => s.target_id)).toEqual(['d1']);
  });

  it('uses the right currency+scope bucket for headroom', () => {
    // Personal debt should pull from the household bucket, NOT the UK Ltd bucket.
    const out = autoSuggestPlans({
      debts: [
        makeDebt({ id: 'business', scope: 'autonize-it-ltd' }),
        makeDebt({ id: 'personal', scope: 'household', fromAccount: 'natwest' }),
      ],
      persistedPlans: [],
      availableHeadroomByBucket: new Map([
        [bucketKey('GBP', 'autonize-it-ltd'), 0],     // no business headroom
        [bucketKey('GBP', 'household'), 800],         // personal slot has £800
      ]),
      today: '2026-04-25',
      ...capitalContext(),
    });
    // 'business' produces zero allocation → suppressed (noise-free).
    // 'personal' produces £400 (50% of £800) → suggested.
    expect(out.map(s => s.target_id)).toEqual(['personal']);
    expect(out[0].monthly_allocation).toBe(400);
  });

  it('suppresses zero-allocation suggestions to avoid noise', () => {
    const out = autoSuggestPlans({
      debts: [makeDebt({ id: 'd1' })],
      persistedPlans: [],
      availableHeadroomByBucket: new Map([[bucketKey('GBP', 'autonize-it-ltd'), 0]]),
      today: '2026-04-25',
      ...capitalContext(),
    });
    expect(out).toEqual([]);
  });

  it('uses holistic money-for-debt when the debt bucket has zero headroom (cross-bucket deployable)', () => {
    const out = autoSuggestPlans({
      debts: [makeDebt({ id: 'ltd', scope: 'autonize-it-ltd' })],
      persistedPlans: [],
      availableHeadroomByBucket: new Map([[bucketKey('GBP', 'autonize-it-ltd'), 0]]),
      today: '2026-04-25',
      holisticMoneyForDebtGbp: 12_000,
      holisticMoneyForDebtAed: 0,
      strategyPeriodApproxMonths: 12,
    });
    expect(out).toHaveLength(1);
    expect(out[0].target_id).toBe('ltd');
    expect(out[0].monthly_allocation).toBeGreaterThan(0);
  });
});
