/**
 * Plans domain — public query surface.
 */

import { getPlanRegistry, type PlanRegistry } from './registry.js';
import type { Plan, PlanGoalType, PlanPersistedStatus } from './schema.js';

export function allPlans(reg: PlanRegistry = getPlanRegistry()): readonly Plan[] {
  return reg.all;
}

export function planById(id: string, reg: PlanRegistry = getPlanRegistry()): Plan | null {
  return reg.indexes.byId.get(id) ?? null;
}

export function plansByStatus(
  status: PlanPersistedStatus,
  reg: PlanRegistry = getPlanRegistry(),
): readonly Plan[] {
  return reg.indexes.byStatus.get(status) ?? [];
}

export function plansByGoalType(
  goalType: PlanGoalType,
  reg: PlanRegistry = getPlanRegistry(),
): readonly Plan[] {
  return reg.indexes.byGoalType.get(goalType) ?? [];
}

export function plansByTargetId(
  targetId: string,
  reg: PlanRegistry = getPlanRegistry(),
): readonly Plan[] {
  return reg.indexes.byTargetId.get(targetId) ?? [];
}

/** Active + paused are the "live" plans the planner cares about for headroom. */
export function livePlans(reg: PlanRegistry = getPlanRegistry()): readonly Plan[] {
  return [
    ...(reg.indexes.byStatus.get('active') ?? []),
    ...(reg.indexes.byStatus.get('paused') ?? []),
  ];
}

export function activePlans(reg: PlanRegistry = getPlanRegistry()): readonly Plan[] {
  return reg.indexes.byStatus.get('active') ?? [];
}

export function completedPlans(reg: PlanRegistry = getPlanRegistry()): readonly Plan[] {
  return reg.indexes.byStatus.get('completed') ?? [];
}

export function pausedPlans(reg: PlanRegistry = getPlanRegistry()): readonly Plan[] {
  return reg.indexes.byStatus.get('paused') ?? [];
}
