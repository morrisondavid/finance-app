/**
 * Contracts domain — fixture builders for consumer tests.
 *
 * Because the contract registry joins three upstream registries at
 * build time, fixtures must accept (or default-fetch) those upstream
 * registries. The fixture builder surfaces both knobs.
 */

import type { Contract, MasterAgreement } from '../../../shared/api-contracts.js';
import { defineFixtureBuilder, shallowMergeFixture } from '../_shared/fixture-builder.js';
import type { ClientRegistry } from '../clients/registry.js';
import type { CompanyRegistry } from '../company/registry.js';
import {
  buildContractRegistry,
  buildContractRegistryFromData,
  type ContractRegistry,
  type BuildContractRegistryInput,
} from './registry.js';

export interface ContractRegistryFixtureInput {
  readonly contracts?: readonly Contract[];
  readonly clients?: ClientRegistry;
  readonly companies?: CompanyRegistry;
  readonly masters?: readonly MasterAgreement[];
  readonly clientsDir?: string;
}

const DEFAULT_FIXTURE_INPUT: ContractRegistryFixtureInput = {};

export const makeTestContractRegistry = defineFixtureBuilder<
  ContractRegistryFixtureInput,
  ContractRegistry
>((overrides?: Partial<ContractRegistryFixtureInput>) => {
  const merged = shallowMergeFixture(DEFAULT_FIXTURE_INPUT, overrides);
  const joinInput: BuildContractRegistryInput = {
    clients: merged.clients,
    companies: merged.companies,
    masters: merged.masters,
  };

  if (merged.contracts !== undefined) {
    return buildContractRegistryFromData(merged.contracts, joinInput);
  }
  if (merged.clientsDir !== undefined) {
    return buildContractRegistry(merged.clientsDir, joinInput);
  }
  return buildContractRegistry(undefined, joinInput);
});
