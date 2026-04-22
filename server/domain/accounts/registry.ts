/**
 * Accounts domain — registry.
 *
 * The loader (`buildAccountsRegistry`) is the one place where raw
 * account config data is turned into answers. Every gate that scopes
 * accounts for a named purpose (VAT-applicable, CT-applicable, business
 * vs personal, by-entity, outgoing-capable) is encoded here exactly
 * once. Consumers read `registry.indexes.<name>` — no consumer does
 * `.filter(...)` on raw data.
 *
 * This is the eat-the-entity-dropdown module: `EntityScopedFilterOpts`
 * existed because the question "which accounts are VAT-applicable for
 * entity X?" had no named index. Here that question is
 * `indexes.vatApplicableByEntity.get(entityId)`.
 *
 * Adding a new named question:
 *   1. Add the field to `AccountsRegistry.indexes` below.
 *   2. Populate it in `buildAccountsRegistry` using the `_shared`
 *      index builders.
 *   3. Expose a named query in `queries.ts`.
 *   4. Document the consumer(s) in `registry.manifest.test.ts`.
 */

import { createRegistry } from '../_shared/create-registry.js';
import { filterToIndex, groupBy, indexBy, mapToIndex } from '../_shared/index-builders.js';
import type { EntityId } from '../../../shared/api-contracts.js';
import { ACCOUNT_CONFIG_DATA } from './data.js';
import {
  AccountConfigSchema,
  type AccountConfig,
  type AccountConfigMap,
  type AccountName,
  type BusinessAccountConfig,
} from './schema.js';

export interface AccountsRegistry {
  /** Every configured account, in the order declared in `data.ts`. */
  readonly all: readonly AccountConfig[];
  /** Every account name, in declaration order. */
  readonly allNames: readonly AccountName[];
  /** Primary-key lookup by account name. */
  readonly byName: ReadonlyMap<AccountName, AccountConfig>;
  /**
   * Precomputed, named answers to every question this registry can
   * answer. Every entry is a lookup result — no consumer should filter
   * raw `all` to derive the same answer.
   */
  readonly indexes: {
    /** Accounts with `category === 'business'`. */
    readonly business: readonly AccountName[];
    /** Accounts with `category === 'personal'`. */
    readonly personal: readonly AccountName[];
    /**
     * Every account grouped by `entityId`. Personal accounts are not
     * present (they have `entityId === null`). Use `personal` for
     * non-entity accounts.
     */
    readonly byEntity: ReadonlyMap<EntityId, readonly AccountName[]>;
    /**
     * Accounts whose income is subject to VAT obligation emission.
     *
     * Triple gate:
     *   1. `category === 'business'`
     *   2. `business.vat.applicable === true`
     *   3. `business.vat.registered === true`
     *
     * Excludes the UAE FZCO account (VAT applicable but not yet
     * registered). The gate logic encoded here is the single source
     * of truth — do not re-derive it in consumers.
     */
    readonly vatApplicable: readonly AccountName[];
    /** `vatApplicable` further partitioned by `entityId`. */
    readonly vatApplicableByEntity: ReadonlyMap<EntityId, readonly AccountName[]>;
    /**
     * Accounts whose income is subject to Corporation-Tax-style
     * obligation emission.
     *
     * Triple gate:
     *   1. `category === 'business'`
     *   2. `business.corpTax.applicable === true`
     *   3. `business.corpTax.qualifyingFreeZone !== 'TBC'`
     *
     * Excludes the UAE FZCO account while QFZP status is `'TBC'`.
     * Flipping it to `true` or `false` is what un-gates UAE CT emission.
     */
    readonly corpTaxApplicable: readonly AccountName[];
    /** `corpTaxApplicable` further partitioned by `entityId`. */
    readonly corpTaxApplicableByEntity: ReadonlyMap<EntityId, readonly AccountName[]>;
    /** Accounts with `canMakeOutgoingPayments === true`. */
    readonly outgoingPaymentsCapable: readonly AccountName[];
    /** Business accounts with `canMakeOutgoingPayments === true`. */
    readonly businessOutgoingPayments: readonly AccountName[];
    /** Personal accounts with `canMakeOutgoingPayments === true`. */
    readonly personalOutgoingPayments: readonly AccountName[];
    /** Accounts with `excludeTransfersFromIncome === true`. */
    readonly excludeTransfersFromIncome: readonly AccountName[];
    /** Accounts with `showTaxLiabilities === true`. */
    readonly showTaxLiabilities: readonly AccountName[];
    /** Accounts with `type === 'credit-card'`. */
    readonly creditCards: readonly AccountName[];
  };
}

function isBusiness(c: AccountConfig): c is BusinessAccountConfig {
  return c.category === 'business';
}

export function buildAccountsRegistry(
  data: AccountConfigMap = ACCOUNT_CONFIG_DATA,
): AccountsRegistry {
  /**
   * Validate each entry individually. The map type is partial to
   * permit sparse fixtures; parsing each value against
   * `AccountConfigSchema` gives per-entry validation without the
   * strictness of `z.record(enum, ...)` which rejects missing keys
   * wholesale.
   */
  const parsedEntries: AccountConfig[] = [];
  for (const [name, cfg] of Object.entries(data)) {
    if (cfg === undefined) continue;
    const parsed = AccountConfigSchema.parse(cfg);
    if (parsed.name !== name) {
      throw new Error(
        `accounts registry: key '${name}' does not match parsed config name '${parsed.name}'`,
      );
    }
    parsedEntries.push(parsed);
  }
  const all: readonly AccountConfig[] = parsedEntries;
  const allNames: readonly AccountName[] = mapToIndex(all, a => a.name);

  const byName = indexBy(all, a => a.name, { indexName: 'accounts.byName' });

  const businessAccounts = filterToIndex(all, a => a.category === 'business');
  const personalAccounts = filterToIndex(all, a => a.category === 'personal');

  const business = mapToIndex(businessAccounts, a => a.name);
  const personal = mapToIndex(personalAccounts, a => a.name);

  const byEntityGroups = groupBy(
    businessAccounts.filter(isBusiness),
    a => a.entityId,
  );
  const byEntity = new Map<EntityId, readonly AccountName[]>();
  for (const [entity, accounts] of byEntityGroups) {
    byEntity.set(entity, mapToIndex(accounts, a => a.name));
  }

  const vatApplicableAccounts = filterToIndex(
    businessAccounts.filter(isBusiness),
    a => a.business.vat.applicable && a.business.vat.registered === true,
  );
  const vatApplicable = mapToIndex(vatApplicableAccounts, a => a.name);

  const vatApplicableByEntity = new Map<EntityId, readonly AccountName[]>();
  for (const [entity, accounts] of groupBy(vatApplicableAccounts, a => a.entityId)) {
    vatApplicableByEntity.set(entity, mapToIndex(accounts, a => a.name));
  }

  const corpTaxApplicableAccounts = filterToIndex(
    businessAccounts.filter(isBusiness),
    a => a.business.corpTax.applicable && a.business.corpTax.qualifyingFreeZone !== 'TBC',
  );
  const corpTaxApplicable = mapToIndex(corpTaxApplicableAccounts, a => a.name);

  const corpTaxApplicableByEntity = new Map<EntityId, readonly AccountName[]>();
  for (const [entity, accounts] of groupBy(corpTaxApplicableAccounts, a => a.entityId)) {
    corpTaxApplicableByEntity.set(entity, mapToIndex(accounts, a => a.name));
  }

  const outgoingPaymentsCapable = mapToIndex(
    filterToIndex(all, a => a.canMakeOutgoingPayments),
    a => a.name,
  );
  const businessOutgoingPayments = mapToIndex(
    filterToIndex(businessAccounts, a => a.canMakeOutgoingPayments),
    a => a.name,
  );
  const personalOutgoingPayments = mapToIndex(
    filterToIndex(personalAccounts, a => a.canMakeOutgoingPayments),
    a => a.name,
  );
  const excludeTransfersFromIncome = mapToIndex(
    filterToIndex(all, a => a.excludeTransfersFromIncome),
    a => a.name,
  );
  const showTaxLiabilities = mapToIndex(
    filterToIndex(all, a => a.showTaxLiabilities),
    a => a.name,
  );
  const creditCards = mapToIndex(
    filterToIndex(all, a => a.type === 'credit-card'),
    a => a.name,
  );

  return {
    all,
    allNames,
    byName,
    indexes: {
      business,
      personal,
      byEntity,
      vatApplicable,
      vatApplicableByEntity,
      corpTaxApplicable,
      corpTaxApplicableByEntity,
      outgoingPaymentsCapable,
      businessOutgoingPayments,
      personalOutgoingPayments,
      excludeTransfersFromIncome,
      showTaxLiabilities,
      creditCards,
    },
  };
}

const handle = createRegistry<AccountsRegistry>({
  name: 'accounts',
  build: () => buildAccountsRegistry(ACCOUNT_CONFIG_DATA),
});

export const getAccountsRegistry = handle.get;
export const invalidateAccountsRegistry = handle.invalidate;
export const __resetAccountsRegistryForTests = handle.__resetForTests;
