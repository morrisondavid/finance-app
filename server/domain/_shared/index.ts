/**
 * Shared primitives for the canonical domain-registry pattern.
 *
 * Registries built on this module get memoisation, invalidation, test
 * reset, declarative index construction, standard fixture helpers, and
 * a single manifest-test helper — written once and shared.
 *
 * See `docs/config-registries.md` for the full pattern.
 */

export { createRegistry, type RegistryHandle, type CreateRegistryOpts } from './create-registry.js';
export {
  groupBy,
  indexBy,
  filterToIndex,
  mapToIndex,
  type CollisionPolicy,
} from './index-builders.js';
export { shallowMergeFixture, defineFixtureBuilder } from './fixture-builder.js';
export {
  assertManifestConsumers,
  type ManifestConsumer,
  type ManifestConsumersMap,
  type ManifestAssertOpts,
} from './manifest-test.js';
