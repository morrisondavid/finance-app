import { describe, it, expect } from 'vitest';
import { buildMovementRegistryFromData } from './movements-registry.js';
import {
  allMovements,
  movementById,
  listMovementsByPlan,
} from './movements-queries.js';
import type { Movement } from './movements-schema.js';

function makeMov(over: Partial<Movement> & Pick<Movement, 'id' | 'plan_id'>): Movement {
  return {
    id: over.id,
    plan_id: over.plan_id,
    from_account: over.from_account ?? 'natwest',
    to_account: over.to_account ?? 'barclays-current',
    amount: over.amount ?? 400,
    day_of_month: over.day_of_month ?? 1,
    expected_start_date: over.expected_start_date ?? '2026-05-01',
    expected_end_date: over.expected_end_date ?? null,
    acknowledged_at: over.acknowledged_at ?? null,
    dismissed_missed_until: over.dismissed_missed_until ?? null,
    updated_at: over.updated_at ?? '2026-04-25',
  };
}

describe('MovementRegistry', () => {
  const fx: readonly Movement[] = [
    makeMov({ id: 'm1', plan_id: 'plan-a' }),
    makeMov({ id: 'm2', plan_id: 'plan-a', amount: 100, day_of_month: 15 }),
    makeMov({ id: 'm3', plan_id: 'plan-b' }),
  ];
  const reg = buildMovementRegistryFromData(fx);

  it('byId returns the row for a known id', () => {
    expect(reg.indexes.byId.get('m1')?.id).toBe('m1');
  });

  it('byPlanId groups movements per plan (1+ supported)', () => {
    expect(reg.indexes.byPlanId.get('plan-a')?.length).toBe(2);
    expect(reg.indexes.byPlanId.get('plan-b')?.length).toBe(1);
  });

  it('listMovementsByPlan returns the same as the byPlanId index', () => {
    expect(listMovementsByPlan('plan-a', reg).map(m => m.id).sort()).toEqual(['m1', 'm2']);
    expect(listMovementsByPlan('plan-b', reg).map(m => m.id)).toEqual(['m3']);
    expect(listMovementsByPlan('nonexistent', reg)).toEqual([]);
  });

  it('movementById returns null for unknown ids', () => {
    expect(movementById('nonexistent', reg)).toBeNull();
  });

  it('allMovements returns the full list', () => {
    expect(allMovements(reg)).toEqual(fx);
  });

  it('throws on duplicate ids at build time', () => {
    expect(() =>
      buildMovementRegistryFromData([fx[0], { ...fx[0] }]),
    ).toThrow();
  });
});
