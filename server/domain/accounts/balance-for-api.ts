/**
 * API-layer helpers for account balance payloads — read-only aliases for clarity.
 *
 * For credit-card accounts with a **limit-seeded** `openingBalance`, `currentBalance`
 * is *remaining headroom* (see `server/parsers/index.ts#normaliseCreditCardAmounts`).
 * For **zero-seeded** cards (e.g. Santander Everyday), `currentBalance` is negative
 * when the card is in debt.
 *
 * Every response includes `balanceSemantics` plus explicit `cashBalance` /
 * `credit*` / `debtOwed` fields so agents never guess which convention applies.
 */

import type { AccountBalance as AccountBalanceWire } from '../../../shared/api-contracts.js';
import { ACCOUNTS, type AccountName } from '../../../shared/api-contracts.js';
import type { AccountBalance } from '../../db/repositories/balance.js';
import { isCreditCard } from './queries.js';

export type AccountBalanceApi = AccountBalanceWire;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Pure projection: how to read this row for API / agent consumers.
 * Kept exported for focused unit tests.
 */
export function accountBalanceSemanticsForApi(
  account: AccountName,
  row: AccountBalance,
): Pick<
  AccountBalanceWire,
  'balanceSemantics' | 'cashBalance' | 'creditLimit' | 'creditUsed' | 'creditRemaining' | 'debtOwed'
> {
  if (!isCreditCard(account)) {
    return {
      balanceSemantics: 'cash',
      cashBalance: round2(row.currentBalance),
      creditLimit: null,
      creditUsed: null,
      creditRemaining: null,
      debtOwed: null,
    };
  }

  const limit = row.openingBalance;
  const current = row.currentBalance;

  if (limit < 0 || !Number.isFinite(limit) || !Number.isFinite(current)) {
    return {
      balanceSemantics: 'passthrough',
      cashBalance: null,
      creditLimit: null,
      creditUsed: null,
      creditRemaining: null,
      debtOwed: null,
    };
  }

  if (limit > 0) {
    const creditRemaining = round2(current);
    const creditUsed = round2(Math.max(0, limit - current));
    return {
      balanceSemantics: 'credit-remaining',
      cashBalance: null,
      creditLimit: round2(limit),
      creditUsed,
      creditRemaining,
      debtOwed: creditUsed,
    };
  }

  const owedMag = round2(Math.max(0, -current));
  const surplus = round2(Math.max(0, current));
  return {
    balanceSemantics: 'debt-owed',
    cashBalance: null,
    creditLimit: null,
    creditUsed: null,
    creditRemaining: surplus > 0 ? surplus : null,
    debtOwed: owedMag > 0 ? owedMag : null,
  };
}

export function accountBalanceForApi(account: AccountName, row: AccountBalance): AccountBalanceApi {
  return {
    ...row,
    ...accountBalanceSemanticsForApi(account, row),
  };
}

export function allAccountBalancesForApi(
  rows: Readonly<Record<AccountName, AccountBalance>>,
): Record<AccountName, AccountBalanceApi> {
  const out = {} as Record<AccountName, AccountBalanceApi>;
  for (const name of ACCOUNTS) {
    out[name] = accountBalanceForApi(name, rows[name]);
  }
  return out;
}
