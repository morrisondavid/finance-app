/**
 * API-layer helpers for account balance payloads — read-only aliases for clarity.
 *
 * For credit-card accounts, `creditLimit` mirrors `openingBalance` because
 * `openingBalance` *is* the credit line in this app's model (see
 * `server/parsers/index.ts#normaliseCreditCardAmounts`). Exposing it under a
 * second, semantically unambiguous name lets human / AI consumers read the
 * balance payload without having to know the parser convention.
 *
 * No new stored field — `creditLimit` is derived at response time only.
 */

import { ACCOUNTS, type AccountName } from '../../../shared/api-contracts.js';
import type { AccountBalance } from '../../db/repositories/balance.js';
import { isCreditCard } from './queries.js';

export type AccountBalanceApi = AccountBalance & { readonly creditLimit?: number };

export function accountBalanceForApi(account: AccountName, row: AccountBalance): AccountBalanceApi {
  if (!isCreditCard(account)) {
    return row;
  }
  return { ...row, creditLimit: row.openingBalance };
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
