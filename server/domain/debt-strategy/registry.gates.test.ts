import { describe, it, expect } from 'vitest';
import { buildPlanRegistryFromData } from './registry.js';
import type { Plan } from './schema.js';

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
    monthly_allocation: over.monthly_allocation ?? 100,
    status: over.status ?? 'active',
    activated_at: over.activated_at ?? '2026-01-01',
    completed_at: over.completed_at ?? null,
    projected_completion_date: over.projected_completion_date ?? null,
    notes: over.notes ?? null,
    updated_at: over.updated_at ?? '2026-01-01',
  };
}

describe('PlanRegistry indexes', () => {
  const fx: readonly Plan[] = [
    makePlan({ id: 'p1', target_id: 'funding-circle', status: 'active', goal_type: 'pay-off-debt' }),
    makePlan({ id: 'p2', target_id: 'novuna', status: 'paused', goal_type: 'pay-off-debt' }),
    makePlan({ id: 'p3', target_id: null, status: 'completed', goal_type: 'save-for-target', target_amount: 5000 }),
    makePlan({ id: 'p4', target_id: 'funding-circle', status: 'completed', goal_type: 'pay-off-debt' }),
  ];
  const reg = buildPlanRegistryFromData(fx);

  it('byId returns the row for a known id', () => {
    expect(reg.indexes.byId.get('p1')?.id).toBe('p1');
    expect(reg.indexes.byId.get('nonexistent')).toBeUndefined();
  });

  it('byStatus groups by status', () => {
    expect(reg.indexes.byStatus.get('active')?.length).toBe(1);
    expect(reg.indexes.byStatus.get('paused')?.length).toBe(1);
    expect(reg.indexes.byStatus.get('completed')?.length).toBe(2);
  });

  it('byGoalType groups by goal_type', () => {
    expect(reg.indexes.byGoalType.get('pay-off-debt')?.length).toBe(3);
    expect(reg.indexes.byGoalType.get('save-for-target')?.length).toBe(1);
  });

  it('byTargetId groups plans sharing the same debt target (active + completed both appear)', () => {
    const fc = reg.indexes.byTargetId.get('funding-circle');
    expect(fc?.length).toBe(2);
    expect(fc?.map(p => p.id).sort()).toEqual(['p1', 'p4']);
  });

  it('byTargetId omits plans with null target_id (save-for-target plans)', () => {
    expect(reg.indexes.byTargetId.has(null as unknown as string)).toBe(false);
  });

  it('byId throws on duplicate ids at build time', () => {
    const dup: readonly Plan[] = [fx[0], { ...fx[0] }];
    expect(() => buildPlanRegistryFromData(dup)).toThrow();
  });
});
