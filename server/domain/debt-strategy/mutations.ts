/**
 * Plans + movements mutations (§1.9). Single-write entry point for
 * the route — every mutation rewrites the canonical CSV atomically
 * and invalidates the in-memory registry so the next read reflects
 * the change.
 *
 * Anti-corruption: ALL state changes flow through here so the route
 * doesn't accidentally drift from the canonical write protocol.
 */

import {
  getPlansCsvPath,
  writePlansCsvFile,
  readPlansCsvFile,
} from './csv-io.js';
import {
  getMovementsCsvPath,
  writeMovementsCsvFile,
  readMovementsCsvFile,
} from './movements-csv-io.js';
import { DEFAULT_DEBT_STRATEGY_DIR } from './data.js';
import { invalidatePlanRegistry } from './registry.js';
import { invalidateMovementRegistry } from './movements-registry.js';
import type { Plan } from './schema.js';
import type { Movement } from './movements-schema.js';

export function persistPlan(
  plan: Plan,
  debtStrategyDir: string = DEFAULT_DEBT_STRATEGY_DIR,
): void {
  const path = getPlansCsvPath(debtStrategyDir);
  const existing = readPlansCsvFile(path);
  const next = [...existing.filter(p => p.id !== plan.id), plan];
  writePlansCsvFile(path, next);
  invalidatePlanRegistry();
}

export function deletePlan(
  planId: string,
  debtStrategyDir: string = DEFAULT_DEBT_STRATEGY_DIR,
): void {
  const path = getPlansCsvPath(debtStrategyDir);
  const existing = readPlansCsvFile(path);
  writePlansCsvFile(
    path,
    existing.filter(p => p.id !== planId),
  );
  invalidatePlanRegistry();

  // Cascade: drop movements pointing at the deleted plan.
  const movPath = getMovementsCsvPath(debtStrategyDir);
  const movs = readMovementsCsvFile(movPath);
  writeMovementsCsvFile(
    movPath,
    movs.filter(m => m.plan_id !== planId),
  );
  invalidateMovementRegistry();
}

export function persistMovement(
  movement: Movement,
  debtStrategyDir: string = DEFAULT_DEBT_STRATEGY_DIR,
): void {
  const path = getMovementsCsvPath(debtStrategyDir);
  const existing = readMovementsCsvFile(path);
  const next = [...existing.filter(m => m.id !== movement.id), movement];
  writeMovementsCsvFile(path, next);
  invalidateMovementRegistry();
}

export function deleteMovement(
  movementId: string,
  debtStrategyDir: string = DEFAULT_DEBT_STRATEGY_DIR,
): void {
  const path = getMovementsCsvPath(debtStrategyDir);
  const existing = readMovementsCsvFile(path);
  writeMovementsCsvFile(
    path,
    existing.filter(m => m.id !== movementId),
  );
  invalidateMovementRegistry();
}
