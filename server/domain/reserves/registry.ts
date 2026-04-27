/**
 * Reserves registry — `(obligation_type, entity_id) → reserve_account`.
 *
 * Adding a new named question:
 *   1. Add the field to `ReserveRegistry.indexes` below.
 *   2. Populate it in `buildReserveRegistryFromData` via the `_shared` builders.
 *   3. Expose a named query in `queries.ts`.
 *   4. Document the consumer(s) in `registry.manifest.test.ts`.
 */

import { createRegistry } from '../_shared/create-registry.js';
import { indexBy } from '../_shared/index-builders.js';
import { loadReservesData, DEFAULT_RESERVES_DIR } from './data.js';
import { reserveKey, type Reserve } from './schema.js';

export interface ReserveRegistry {
  /** Every configured reserve, in CSV order. */
  readonly all: readonly Reserve[];
  readonly indexes: {
    /** `(obligation_type, entity_id)` composite key → row. */
    readonly byKey: ReadonlyMap<string, Reserve>;
  };
}

export function buildReserveRegistryFromData(
  all: readonly Reserve[],
): ReserveRegistry {
  const byKey = indexBy(
    all,
    r => reserveKey(r.obligation_type, r.entity_id),
    { indexName: 'reserves.byKey' },
  );
  return { all, indexes: { byKey } };
}

export function buildReserveRegistry(
  reservesDir: string = DEFAULT_RESERVES_DIR,
): ReserveRegistry {
  return buildReserveRegistryFromData(loadReservesData(reservesDir));
}

const handle = createRegistry<ReserveRegistry>({
  name: 'reserves',
  build: () => buildReserveRegistry(),
});

export const getReserveRegistry = handle.get;
export const invalidateReserveRegistry = handle.invalidate;
export const __resetReserveRegistryForTests = handle.__resetForTests;
