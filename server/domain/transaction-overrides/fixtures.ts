/**
 * Transaction-overrides domain — fixture builders for consumer tests.
 *
 * `makeTestOverrideRegistry(overrides?)` produces a real registry
 * built through the production `buildOverrideRegistry` so fixtures
 * cannot silently drift from the production index shape.
 */

import type { CategoryName } from './schema.js';
import { defineFixtureBuilder, shallowMergeFixture } from '../_shared/fixture-builder.js';
import {
  buildOverrideRegistry,
  type OverrideRegistry,
} from './registry.js';

export interface OverrideRegistryFixtureInput {
  readonly entries?: ReadonlyArray<readonly [string, CategoryName]>;
  readonly autonizeItDir?: string;
}

const DEFAULT_FIXTURE_INPUT: OverrideRegistryFixtureInput = { entries: [] };

export const makeTestOverrideRegistry = defineFixtureBuilder<
  OverrideRegistryFixtureInput,
  OverrideRegistry
>((overrides?: Partial<OverrideRegistryFixtureInput>) => {
  const input = shallowMergeFixture(DEFAULT_FIXTURE_INPUT, overrides);
  if (input.autonizeItDir !== undefined) {
    return buildOverrideRegistry(input.autonizeItDir);
  }
  const byHash = new Map<string, CategoryName>();
  for (const [hash, cat] of input.entries ?? []) byHash.set(hash, cat);
  return { indexes: { byHash } };
});
