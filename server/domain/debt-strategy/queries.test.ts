import { describe, it, expect } from 'vitest';
import { buildPlanRegistryFromData } from './registry.js';
import {
  allPlans,
  planById,
  plansByStatus,
  plansByGoalType,
  plansByTargetId,
  livePlans,
  activePlans,
  completedPlans,
  pausedPlans,
} from './queries.js';
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

const fx: readonly Plan[] = [
  makePlan({ id: 'p1', target_id: 'funding-circle', status: 'active' }),
  makePlan({ id: 'p2', target_id: 'novuna', status: 'paused' }),
  makePlan({ id: 'p3', target_id: null, status: 'completed', goal_type: 'save-for-target', target_amount: 5000 }),
];
const reg = buildPlanRegistryFromData(fx);

describe('queries', () => {
  it('allPlans returns the full list', () => {
    expect(allPlans(reg)).toEqual(fx);
  });

  it('planById returns the row for a known id', () => {
    expect(planById('p1', reg)?.id).toBe('p1');
    expect(planById('nonexistent', reg)).toBeNull();
  });

  it('plansByStatus filters by status', () => {
    expect(plansByStatus('active', reg).map(p => p.id)).toEqual(['p1']);
    expect(plansByStatus('paused', reg).map(p => p.id)).toEqual(['p2']);
    expect(plansByStatus('completed', reg).map(p => p.id)).toEqual(['p3']);
  });

  it('plansByGoalType filters by goal_type', () => {
    expect(plansByGoalType('pay-off-debt', reg).map(p => p.id).sort()).toEqual(['p1', 'p2']);
    expect(plansByGoalType('save-for-target', reg).map(p => p.id)).toEqual(['p3']);
  });

  it('plansByTargetId returns plans for a known debt id', () => {
    expect(plansByTargetId('funding-circle', reg).map(p => p.id)).toEqual(['p1']);
    expect(plansByTargetId('nonexistent', reg)).toEqual([]);
  });

  it('livePlans = active + paused', () => {
    expect(livePlans(reg).map(p => p.id).sort()).toEqual(['p1', 'p2']);
  });

  it('activePlans returns only active', () => {
    expect(activePlans(reg).map(p => p.id)).toEqual(['p1']);
  });

  it('completedPlans returns only completed', () => {
    expect(completedPlans(reg).map(p => p.id)).toEqual(['p3']);
  });

  it('pausedPlans returns only paused', () => {
    expect(pausedPlans(reg).map(p => p.id)).toEqual(['p2']);
  });
});
