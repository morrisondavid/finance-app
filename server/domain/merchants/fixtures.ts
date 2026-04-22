/**
 * Merchants domain — test fixtures.
 *
 * `makeTestMerchantsRegistry(overrides?)` produces a fresh registry
 * built through the production `buildMerchantsRegistry` loader. When
 * no override is supplied the default static data + the configured
 * people are used; otherwise the caller can swap in a curated list
 * of entries or a reduced set of people to keep a unit test focused.
 *
 * Consumer tests get every index automatically — new indexes added
 * to the real registry appear in fixtures without a sweep of every
 * test file.
 */

import { allPeople, type Person } from '../people/index.js';
import { STATIC_MERCHANT_DATA } from './data.js';
import {
  buildMerchantsRegistry,
  type BuildMerchantsRegistryInput,
  type MerchantsRegistry,
} from './registry.js';
import { defineFixtureBuilder, shallowMergeFixture } from '../_shared/fixture-builder.js';
import type { MerchantEntry } from './schema.js';

export interface TestMerchantsInput {
  readonly staticEntries: readonly MerchantEntry[];
  readonly people: readonly Person[];
}

export const makeTestMerchantsRegistry = defineFixtureBuilder<
  TestMerchantsInput,
  MerchantsRegistry
>((overrides) => {
  const defaults: TestMerchantsInput = {
    staticEntries: STATIC_MERCHANT_DATA,
    people: allPeople(),
  };
  const merged = shallowMergeFixture(defaults, overrides);
  const input: BuildMerchantsRegistryInput = {
    staticEntries: merged.staticEntries,
    people: merged.people,
  };
  return buildMerchantsRegistry(input);
});
