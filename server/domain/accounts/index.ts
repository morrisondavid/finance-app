/**
 * Accounts domain — public barrel.
 *
 * Consumers should import from this module, not from the internal
 * `registry.ts` / `queries.ts` / `schema.ts` files directly.
 */

export {
  buildAccountsRegistry,
  getAccountsRegistry,
  invalidateAccountsRegistry,
  __resetAccountsRegistryForTests,
  type AccountsRegistry,
} from './registry.js';

export {
  AccountConfigSchema,
  AccountConfigMapSchema,
  BusinessAccountConfigSchema,
  PersonalAccountConfigSchema,
  BusinessTaxConfigSchema,
  VatConfigSchema,
  CorpTaxConfigSchema,
  type AccountConfig,
  type AccountConfigMap,
  type CompleteAccountConfigMap,
  type AccountName,
  type BusinessAccountConfig,
  type PersonalAccountConfig,
  type BusinessTaxConfig,
  type VatConfig,
  type CorpTaxConfig,
  type EntityId,
} from './schema.js';

export { ACCOUNT_CONFIG_DATA } from './data.js';

export {
  isValidAccountName,
  validateAccount,
  getAccountConfig,
  isBusinessConfig,
  isBusinessAccount,
  isCreditCard,
  canMakeOutgoingPayments,
  getEntityIdForAccount,
  accountsForEntity,
  businessAccounts,
  personalAccounts,
  vatApplicableAccounts,
  corpTaxApplicableAccounts,
  businessPaymentAccounts,
  personalPaymentAccounts,
  businessAndPersonalPaymentAccounts,
  isCrossAccountBusinessToBusinessTransfer,
} from './queries.js';

export { makeTestAccountsRegistry } from './fixtures.js';
