/**
 * Accounts domain — public query surface.
 *
 * Every function here answers one named question by reading a
 * precomputed index (or doing an O(1) map lookup). No function in this
 * file contains a `.filter(...)` over raw account data — if you find
 * yourself writing one, the answer belongs as a new index in
 * `registry.ts` instead.
 *
 * Every query takes the registry as an optional parameter with default
 * `= getAccountsRegistry()`. Tests inject fixture registries without
 * global-state pollution.
 */

import type { EntityId } from '../../../shared/api-contracts.js';
import { ACCOUNTS } from '../../../shared/api-contracts.js';
import type { AccountConfig, AccountName, BusinessAccountConfig } from './schema.js';
import { getAccountsRegistry, type AccountsRegistry } from './registry.js';

/**
 * Validate that a string is a known account id. Mirrors
 * `shared/api-contracts.ts::ACCOUNTS` — the canonical list.
 */
export function isValidAccountName(account: string): account is AccountName {
  return ACCOUNTS.includes(account as AccountName);
}

/**
 * Validate an account id or fall back to `barclays-current`. Shared
 * by route handlers that accept an `?account=` query string.
 */
export function validateAccount(account: string | undefined): AccountName {
  return account !== undefined && isValidAccountName(account) ? account : 'barclays-current';
}

export function getAccountConfig(
  account: AccountName,
  reg: AccountsRegistry = getAccountsRegistry(),
): AccountConfig {
  const found = reg.byName.get(account);
  if (found === undefined) {
    throw new Error(`Unknown account: ${account}`);
  }
  return found;
}

/**
 * Type guard that narrows `AccountConfig` to `BusinessAccountConfig`.
 * Kept here as the discrimination primitive; consumers that want a
 * list of business accounts should read `businessAccounts()` instead.
 */
export function isBusinessConfig(c: AccountConfig): c is BusinessAccountConfig {
  return c.category === 'business';
}

export function isBusinessAccount(
  account: string,
  reg: AccountsRegistry = getAccountsRegistry(),
): boolean {
  if (!isValidAccountName(account)) return false;
  const config = reg.byName.get(account);
  return config !== undefined && config.category === 'business';
}

export function isCreditCard(
  account: AccountName,
  reg: AccountsRegistry = getAccountsRegistry(),
): boolean {
  return reg.indexes.creditCards.includes(account);
}

/**
 * Whether this account's balance counts as deployable cash for §1.9
 * capital-aware strategy. Omitted defaults to excluding credit cards only.
 */
export function accountDeployableForStrategy(config: AccountConfig): boolean {
  if (config.deployableForStrategy === false) return false;
  if (config.deployableForStrategy === true) return true;
  return config.type !== 'credit-card';
}

export function canMakeOutgoingPayments(
  account: AccountName,
  reg: AccountsRegistry = getAccountsRegistry(),
): boolean {
  return reg.indexes.outgoingPaymentsCapable.includes(account);
}

export function getEntityIdForAccount(
  account: AccountName,
  reg: AccountsRegistry = getAccountsRegistry(),
): EntityId | null {
  const config = reg.byName.get(account);
  return config?.entityId ?? null;
}

/**
 * Accounts belonging to `entityId`. Pass `null` to enumerate personal
 * (non-entity) accounts.
 */
export function accountsForEntity(
  entityId: EntityId | null,
  reg: AccountsRegistry = getAccountsRegistry(),
): readonly AccountName[] {
  if (entityId === null) return reg.indexes.personal;
  return reg.indexes.byEntity.get(entityId) ?? [];
}

export function businessAccounts(
  reg: AccountsRegistry = getAccountsRegistry(),
): readonly AccountName[] {
  return reg.indexes.business;
}

export function personalAccounts(
  reg: AccountsRegistry = getAccountsRegistry(),
): readonly AccountName[] {
  return reg.indexes.personal;
}

/**
 * Accounts whose income is subject to VAT obligation emission. When
 * `entityId` is supplied, the result is scoped to that entity; omit it
 * for the union across every entity (equivalent to the global VAT-
 * applicable index).
 */
export function vatApplicableAccounts(
  opts?: { readonly entityId?: EntityId },
  reg: AccountsRegistry = getAccountsRegistry(),
): readonly AccountName[] {
  if (opts?.entityId === undefined) return reg.indexes.vatApplicable;
  return reg.indexes.vatApplicableByEntity.get(opts.entityId) ?? [];
}

/**
 * Accounts whose income is subject to Corporation-Tax-style obligation
 * emission. Same scoping semantics as `vatApplicableAccounts`.
 */
export function corpTaxApplicableAccounts(
  opts?: { readonly entityId?: EntityId },
  reg: AccountsRegistry = getAccountsRegistry(),
): readonly AccountName[] {
  if (opts?.entityId === undefined) return reg.indexes.corpTaxApplicable;
  return reg.indexes.corpTaxApplicableByEntity.get(opts.entityId) ?? [];
}

export function businessPaymentAccounts(
  reg: AccountsRegistry = getAccountsRegistry(),
): readonly AccountName[] {
  return reg.indexes.businessOutgoingPayments;
}

export function personalPaymentAccounts(
  reg: AccountsRegistry = getAccountsRegistry(),
): readonly AccountName[] {
  return reg.indexes.personalOutgoingPayments;
}

/**
 * Every account that can make outgoing payments regardless of category.
 *
 * Self Assessment is personal tax but is legitimately paid from either
 * business or personal accounts (directors sometimes route SA through
 * the company card, sometimes via their personal current account).
 * Restricting the matcher to business-only accounts silently orphans
 * every personal-account SA payment.
 */
export function businessAndPersonalPaymentAccounts(
  reg: AccountsRegistry = getAccountsRegistry(),
): readonly AccountName[] {
  return reg.indexes.outgoingPaymentsCapable;
}

/**
 * Cross-account transfer pairing (same amount / opposite sign) is only
 * valid for movements **within the same legal entity**. Pairing an
 * expense on one entity's account against an income on another entity's
 * account would silently net the two rows out and destroy audit-critical
 * information: that a genuine cross-border money movement happened,
 * which has to be classified (loan / capital contribution / inter-
 * company service fee) by a human or the Warnings Engine.
 *
 * Rules (short-circuit in this exact order):
 *   1. Same account pair → `false`.
 *   2. Either side not a business account → `false`.
 *   3. Both business BUT `entityId` differs → `false` (inter-company).
 *   4. Both business AND same `entityId` → `true`.
 */
export function isCrossAccountBusinessToBusinessTransfer(
  expenseAccount: string,
  incomeAccount: string,
  reg: AccountsRegistry = getAccountsRegistry(),
): boolean {
  if (expenseAccount === incomeAccount) return false;
  if (!isBusinessAccount(expenseAccount, reg) || !isBusinessAccount(incomeAccount, reg)) return false;
  const fromEntity = reg.byName.get(expenseAccount as AccountName)?.entityId ?? null;
  const toEntity = reg.byName.get(incomeAccount as AccountName)?.entityId ?? null;
  return fromEntity !== null && toEntity !== null && fromEntity === toEntity;
}
