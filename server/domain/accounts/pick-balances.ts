/**
 * Subset of account balances for entity-scoped liquidity / net-worth style rollups.
 */

import type { AccountName } from '../../types.js';
import type { AccountBalance } from '../../db/repositories/balance.js';

export function pickBalances(
  all: Readonly<Record<AccountName, AccountBalance>>,
  names: readonly AccountName[],
): Readonly<Partial<Record<AccountName, AccountBalance>>> {
  const out: Partial<Record<AccountName, AccountBalance>> = {};
  for (const n of names) {
    const b = all[n];
    if (b !== undefined) {
      out[n] = b;
    }
  }
  return out;
}
