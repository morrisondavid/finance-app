/**
 * Merchants domain — public barrel.
 *
 * Consumers should import from this module, not from the internal
 * `registry.ts` / `queries.ts` / `schema.ts` files directly.
 */

export {
  buildMerchantsRegistry,
  getMerchantsRegistry,
  invalidateMerchantsRegistry,
  __resetMerchantsRegistryForTests,
  type MerchantsRegistry,
  type BuildMerchantsRegistryInput,
} from './registry.js';

export {
  MerchantEntrySchema,
  MerchantDataSchema,
  CategoryNameSchema,
  CATEGORY_NAMES,
  type MerchantEntry,
  type MerchantData,
  type CategoryName,
} from './schema.js';

export { STATIC_MERCHANT_DATA } from './data.js';

export {
  allMerchantEntries,
  merchantsByCategory,
  merchantByDisplayName,
  findFirstCategoryMatch,
  findFirstNamedMatch,
} from './queries.js';

export {
  makeTestMerchantsRegistry,
  type TestMerchantsInput,
} from './fixtures.js';
