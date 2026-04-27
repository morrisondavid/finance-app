/**
 * Movements registry — sibling to the plans registry (§1.9).
 *
 * Indexes:
 *   - `byId`: primary-key lookup.
 *   - `byPlanId`: list movements for a given plan (1+ per plan).
 *
 * The registry is a separate canonical-registry instance. The
 * manifest test asserts every movement's `plan_id` resolves to a
 * row in the plans registry (FK integrity).
 */

import { createRegistry } from '../_shared/create-registry.js';
import { groupBy, indexBy } from '../_shared/index-builders.js';
import { loadMovementsData } from './movements-data.js';
import { DEFAULT_DEBT_STRATEGY_DIR } from './data.js';
import type { Movement } from './movements-schema.js';

export interface MovementRegistry {
  readonly all: readonly Movement[];
  readonly indexes: {
    readonly byId: ReadonlyMap<string, Movement>;
    readonly byPlanId: ReadonlyMap<string, readonly Movement[]>;
  };
}

export function buildMovementRegistryFromData(all: readonly Movement[]): MovementRegistry {
  const byId = indexBy(all, m => m.id, { indexName: 'movements.byId' });
  const byPlanId: ReadonlyMap<string, readonly Movement[]> = groupBy(all, m => m.plan_id);
  return { all, indexes: { byId, byPlanId } };
}

export function buildMovementRegistry(
  debtStrategyDir: string = DEFAULT_DEBT_STRATEGY_DIR,
): MovementRegistry {
  return buildMovementRegistryFromData(loadMovementsData(debtStrategyDir));
}

const handle = createRegistry<MovementRegistry>({
  // Reuse the same domain folder name as the plans registry — both
  // belong to the §1.9 Debt Strategy domain. The canonical-registry
  // discovery is by directory; both registries live under
  // server/domain/debt-strategy/. To keep the "every directory ships
  // ONE registry" rule clean, this registry uses a distinct logical
  // name suffix.
  name: 'debt-strategy-movements',
  build: () => buildMovementRegistry(),
});

export const getMovementRegistry = handle.get;
export const invalidateMovementRegistry = handle.invalidate;
export const __resetMovementRegistryForTests = handle.__resetForTests;
