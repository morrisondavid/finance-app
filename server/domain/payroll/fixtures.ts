/**
 * Payroll domain — test fixtures.
 *
 * `makeTestPayrollRegistry(overrides?)` produces a fresh registry
 * built through the production `buildPayrollRegistry` loader. By
 * default it uses the live obligations + people registries; tests
 * that want to isolate can pass curated registry fixtures as
 * overrides.
 */

import {
  buildPayrollRegistry,
  type BuildPayrollRegistryInput,
  type PayrollRegistry,
} from './registry.js';
import { defineFixtureBuilder, shallowMergeFixture } from '../_shared/fixture-builder.js';
import { getObligationRegistry, type ObligationRegistry } from '../obligations/registry.js';
import { getPeopleRegistry, type PeopleRegistry } from '../people/index.js';

export interface TestPayrollInput {
  readonly obligations: ObligationRegistry;
  readonly people: PeopleRegistry;
}

export const makeTestPayrollRegistry = defineFixtureBuilder<
  TestPayrollInput,
  PayrollRegistry
>((overrides) => {
  const defaults: TestPayrollInput = {
    obligations: getObligationRegistry(),
    people: getPeopleRegistry(),
  };
  const merged = shallowMergeFixture(defaults, overrides);
  const input: BuildPayrollRegistryInput = {
    obligations: merged.obligations,
    people: merged.people,
  };
  return buildPayrollRegistry(input);
});
