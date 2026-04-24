/**
 * Leave domain — fixture builder for consumer tests.
 *
 * The registry joins the contracts registry at build time, so the
 * fixture builder accepts (or default-fetches) it. Tests that don't
 * care about FK validation can pass a stub contracts registry with
 * whatever contract ids their leave rows reference.
 */

import type { LeaveRow } from '../../../shared/api-contracts.js';
import { defineFixtureBuilder, shallowMergeFixture } from '../_shared/fixture-builder.js';
import type { ContractRegistry } from '../contracts/registry.js';
import {
  buildLeaveRegistry,
  buildLeaveRegistryFromData,
  type BuildLeaveRegistryInput,
  type LeaveRegistry,
} from './registry.js';

export interface LeaveRegistryFixtureInput {
  readonly leave?: readonly LeaveRow[];
  readonly contracts?: ContractRegistry;
  readonly today?: string;
  readonly workingDaysDir?: string;
}

const DEFAULT_FIXTURE_INPUT: LeaveRegistryFixtureInput = {};

export const makeTestLeaveRegistry = defineFixtureBuilder<
  LeaveRegistryFixtureInput,
  LeaveRegistry
>((overrides?: Partial<LeaveRegistryFixtureInput>) => {
  const merged = shallowMergeFixture(DEFAULT_FIXTURE_INPUT, overrides);
  const joinInput: BuildLeaveRegistryInput = {
    contracts: merged.contracts,
    today: merged.today,
  };

  if (merged.leave !== undefined) {
    return buildLeaveRegistryFromData(merged.leave, joinInput);
  }
  if (merged.workingDaysDir !== undefined) {
    return buildLeaveRegistry(merged.workingDaysDir, joinInput);
  }
  return buildLeaveRegistry(undefined, joinInput);
});
