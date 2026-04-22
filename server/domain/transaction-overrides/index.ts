/**
 * Transaction-overrides domain — public barrel.
 *
 * Consumers should import from this file rather than reaching into
 * `registry.ts` / `queries.ts` directly so the domain boundary stays
 * stable.
 */

export {
  TransactionCategoryOverrideRowSchema,
  type TransactionCategoryOverrideRow,
  type CategoryName,
} from './schema.js';

export {
  buildOverrideRegistry,
  getOverrideRegistry,
  invalidateOverrideRegistry,
  getOverridesDir,
  __resetOverrideRegistryForTests,
  type OverrideRegistry,
} from './registry.js';

export {
  lookupOverride,
  allOverrides,
  overrideCount,
} from './queries.js';

export {
  makeTestOverrideRegistry,
  type OverrideRegistryFixtureInput,
} from './fixtures.js';
