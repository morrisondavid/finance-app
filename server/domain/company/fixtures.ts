/**
 * Company domain — fixture builders for consumer tests.
 *
 * `makeTestCompanyRegistry(overrides?)` produces a real registry built
 * through the production `buildCompanyRegistryFromData` so fixtures can
 * never silently drift from the production index shape.
 *
 * Overrides accept either an explicit `companies` array (to substitute
 * the whole list) or an `autonizeItDir` override (to point the default
 * CSV loader at a different directory — useful for CSV-specific
 * round-trip tests).
 */

import type { Company } from './schema.js';
import { defineFixtureBuilder, shallowMergeFixture } from '../_shared/fixture-builder.js';
import {
  buildCompanyRegistry,
  buildCompanyRegistryFromData,
  type CompanyRegistry,
} from './registry.js';

export interface CompanyRegistryFixtureInput {
  readonly companies?: readonly Company[];
  readonly autonizeItDir?: string;
}

const DEFAULT_FIXTURE_INPUT: CompanyRegistryFixtureInput = {};

export const makeTestCompanyRegistry = defineFixtureBuilder<
  CompanyRegistryFixtureInput,
  CompanyRegistry
>((overrides?: Partial<CompanyRegistryFixtureInput>) => {
  const input = shallowMergeFixture(DEFAULT_FIXTURE_INPUT, overrides);
  if (input.companies !== undefined) {
    return buildCompanyRegistryFromData(input.companies);
  }
  if (input.autonizeItDir !== undefined) {
    return buildCompanyRegistry(input.autonizeItDir);
  }
  return buildCompanyRegistry();
});
