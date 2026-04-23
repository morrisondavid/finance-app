/**
 * Clients domain — fixture builders for consumer tests.
 *
 * `makeTestClientRegistry(overrides?)` produces a real registry built
 * through the production `buildClientRegistryFromData` so fixtures can
 * never silently drift from the production index shape.
 */

import type { Client } from './schema.js';
import { defineFixtureBuilder, shallowMergeFixture } from '../_shared/fixture-builder.js';
import {
  buildClientRegistry,
  buildClientRegistryFromData,
  type ClientRegistry,
} from './registry.js';

export interface ClientRegistryFixtureInput {
  readonly clients?: readonly Client[];
  readonly clientsDir?: string;
}

const DEFAULT_FIXTURE_INPUT: ClientRegistryFixtureInput = {};

export const makeTestClientRegistry = defineFixtureBuilder<
  ClientRegistryFixtureInput,
  ClientRegistry
>((overrides?: Partial<ClientRegistryFixtureInput>) => {
  const input = shallowMergeFixture(DEFAULT_FIXTURE_INPUT, overrides);
  if (input.clients !== undefined) {
    return buildClientRegistryFromData(input.clients);
  }
  if (input.clientsDir !== undefined) {
    return buildClientRegistry(input.clientsDir);
  }
  return buildClientRegistry();
});
