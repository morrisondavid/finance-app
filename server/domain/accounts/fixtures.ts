/**
 * Accounts domain — test fixtures.
 *
 * `makeTestAccountsRegistry(overrides)` produces a fresh registry built
 * through the production `buildAccountsRegistry` loader. Consumer tests
 * that need a tweaked config call this helper and get every index
 * automatically — new indexes added to the real registry appear in
 * fixtures without a sweep of every test file.
 *
 * `overrides` is a partial `AccountConfigMap`. Supplied keys replace
 * the default configs for those account names; unsupplied keys keep
 * their defaults. Accounts not present in `AccountNameSchema` are
 * rejected by the Zod schema at build time.
 */

import { defineFixtureBuilder } from '../_shared/fixture-builder.js';
import { ACCOUNT_CONFIG_DATA } from './data.js';
import { buildAccountsRegistry, type AccountsRegistry } from './registry.js';
import type { AccountConfigMap } from './schema.js';

export const makeTestAccountsRegistry = defineFixtureBuilder<AccountConfigMap, AccountsRegistry>(
  overrides => buildAccountsRegistry({ ...ACCOUNT_CONFIG_DATA, ...(overrides ?? {}) }),
);
