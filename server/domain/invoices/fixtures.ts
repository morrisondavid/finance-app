/**
 * Invoices domain — fixture builders for consumer tests.
 *
 * `makeTestInvoiceRegistry(overrides?)` produces a real registry built
 * through the production `buildInvoiceRegistryFromData` so fixtures
 * can never silently drift from the production index shape.
 */

import type { Invoice } from './schema.js';
import {
  defineFixtureBuilder,
  shallowMergeFixture,
} from '../_shared/fixture-builder.js';
import {
  buildInvoiceRegistry,
  buildInvoiceRegistryFromData,
  type InvoiceRegistry,
} from './registry.js';

export interface InvoiceRegistryFixtureInput {
  readonly invoices?: readonly Invoice[];
  readonly invoicesDir?: string;
}

const DEFAULT_FIXTURE_INPUT: InvoiceRegistryFixtureInput = {};

export const makeTestInvoiceRegistry = defineFixtureBuilder<
  InvoiceRegistryFixtureInput,
  InvoiceRegistry
>((overrides?: Partial<InvoiceRegistryFixtureInput>) => {
  const input = shallowMergeFixture(DEFAULT_FIXTURE_INPUT, overrides);
  if (input.invoices !== undefined) {
    return buildInvoiceRegistryFromData(input.invoices);
  }
  if (input.invoicesDir !== undefined) {
    return buildInvoiceRegistry(input.invoicesDir);
  }
  return buildInvoiceRegistry();
});
