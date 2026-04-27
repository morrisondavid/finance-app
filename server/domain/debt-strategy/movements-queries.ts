/**
 * Movement queries (§1.9). Read-side only — mutations live behind
 * `mutate-movements.ts` so the route can apply a single CSV write per
 * change.
 */

import { getMovementRegistry, type MovementRegistry } from './movements-registry.js';
import type { Movement } from './movements-schema.js';

export function allMovements(reg: MovementRegistry = getMovementRegistry()): readonly Movement[] {
  return reg.all;
}

export function movementById(
  id: string,
  reg: MovementRegistry = getMovementRegistry(),
): Movement | null {
  return reg.indexes.byId.get(id) ?? null;
}

export function listMovementsByPlan(
  planId: string,
  reg: MovementRegistry = getMovementRegistry(),
): readonly Movement[] {
  return reg.indexes.byPlanId.get(planId) ?? [];
}
