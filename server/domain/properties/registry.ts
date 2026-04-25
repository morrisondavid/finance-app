/**
 * Properties registry — the rent ↔ mortgage join legibility layer (§1.7).
 *
 * Every question about a property is answered through a precomputed
 * index. Callers read `registry.indexes.<name>` — no consumer
 * re-filters `all`.
 *
 * Adding a new named question:
 *   1. Add the field to `PropertyRegistry.indexes` below.
 *   2. Populate it in `buildPropertyRegistryFromData` via the `_shared` builders.
 *   3. Expose a named query in `queries.ts`.
 *   4. Document the consumer(s) in `registry.manifest.test.ts`.
 */

import { createRegistry } from '../_shared/create-registry.js';
import { indexBy } from '../_shared/index-builders.js';
import { loadPropertiesData, DEFAULT_PROPERTIES_DIR } from './data.js';
import type { Property, PropertyId } from './schema.js';

export interface PropertyRegistry {
  /** Every configured property, in CSV order. */
  readonly all: readonly Property[];
  /** Every property id, in declaration order. */
  readonly allIds: readonly PropertyId[];
  readonly indexes: {
    /** Primary-key lookup by property id. */
    readonly byId: ReadonlyMap<PropertyId, Property>;
    /** Lookup by exact-match address (display string). */
    readonly byAddress: ReadonlyMap<string, Property>;
  };
}

export function buildPropertyRegistryFromData(
  all: readonly Property[],
): PropertyRegistry {
  const byId = indexBy(all, p => p.id, { indexName: 'properties.byId' });
  const byAddress = indexBy(all, p => p.address, { indexName: 'properties.byAddress' });
  return {
    all,
    allIds: all.map(p => p.id),
    indexes: { byId, byAddress },
  };
}

export function buildPropertyRegistry(
  propertiesDir: string = DEFAULT_PROPERTIES_DIR,
): PropertyRegistry {
  return buildPropertyRegistryFromData(loadPropertiesData(propertiesDir));
}

const handle = createRegistry<PropertyRegistry>({
  name: 'properties',
  build: () => buildPropertyRegistry(),
});

export const getPropertyRegistry = handle.get;
export const invalidatePropertyRegistry = handle.invalidate;
export const __resetPropertyRegistryForTests = handle.__resetForTests;
