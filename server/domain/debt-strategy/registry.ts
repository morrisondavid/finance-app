/**
 * Plans registry — primary key on `id`, secondary indexes by status,
 * goal_type, target_id (so the auto-suggest emitter can quickly check
 * "does this debt already have an active plan?").
 *
 * Adding a new named question:
 *   1. Add the field to `PlanRegistry.indexes` below.
 *   2. Populate it in `buildPlanRegistryFromData` via the `_shared` builders.
 *   3. Expose a named query in `queries.ts`.
 *   4. Document the consumer(s) in `registry.manifest.test.ts`.
 */

import { createRegistry } from '../_shared/create-registry.js';
import { groupBy, indexBy } from '../_shared/index-builders.js';
import { loadPlansData, DEFAULT_DEBT_STRATEGY_DIR } from './data.js';
import type { Plan, PlanGoalType, PlanPersistedStatus } from './schema.js';

export interface PlanRegistry {
  /** Every persisted plan, in CSV order. */
  readonly all: readonly Plan[];
  readonly indexes: {
    /** Primary-key lookup. */
    readonly byId: ReadonlyMap<string, Plan>;
    /** All plans for a given persisted status. */
    readonly byStatus: ReadonlyMap<PlanPersistedStatus, readonly Plan[]>;
    /** All plans of a given goal_type. */
    readonly byGoalType: ReadonlyMap<PlanGoalType, readonly Plan[]>;
    /**
     * Plans grouped by their `target_id` (debt id for `pay-off-debt`
     * plans). Used by `auto-suggest-plans` to skip debts already
     * covered by an active plan.
     */
    readonly byTargetId: ReadonlyMap<string, readonly Plan[]>;
  };
}

export function buildPlanRegistryFromData(all: readonly Plan[]): PlanRegistry {
  const byId = indexBy(all, p => p.id, { indexName: 'plans.byId' });
  const byStatus: ReadonlyMap<PlanPersistedStatus, readonly Plan[]> = groupBy(all, p => p.status);
  const byGoalType: ReadonlyMap<PlanGoalType, readonly Plan[]> = groupBy(all, p => p.goal_type);
  // Skip rows whose target_id is null when building the byTargetId map.
  const withTarget = all.filter((p): p is Plan & { target_id: string } => p.target_id !== null);
  const byTargetId: ReadonlyMap<string, readonly Plan[]> = groupBy(withTarget, p => p.target_id);
  return {
    all,
    indexes: { byId, byStatus, byGoalType, byTargetId },
  };
}

export function buildPlanRegistry(
  debtStrategyDir: string = DEFAULT_DEBT_STRATEGY_DIR,
): PlanRegistry {
  return buildPlanRegistryFromData(loadPlansData(debtStrategyDir));
}

const handle = createRegistry<PlanRegistry>({
  name: 'debt-strategy',
  build: () => buildPlanRegistry(),
});

export const getPlanRegistry = handle.get;
export const invalidatePlanRegistry = handle.invalidate;
export const __resetPlanRegistryForTests = handle.__resetForTests;
