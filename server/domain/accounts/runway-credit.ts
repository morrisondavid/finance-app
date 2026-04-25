/**
 * Aggregate cash vs credit-card headroom by currency for runway / household views.
 *
 * The current-balance model for credit cards in this app treats `openingBalance`
 * as the credit line and reduces it on spend; `currentBalance` therefore
 * naturally represents *remaining headroom* on the card. See
 * `server/parsers/index.ts#normaliseCreditCardAmounts` for the convention.
 */

import { ACCOUNTS, type AccountName } from '../../types.js';
import type { CurrencyCode } from '../../../shared/api-contracts.js';
import type { AccountBalance } from '../../db/repositories/balance.js';
import { getAccountConfig, isCreditCard } from './queries.js';

export interface CurrencyCashAndCreditTotals {
  readonly totalCashCurrent: number;
  readonly totalAvailableCredit: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Sum current balances within a single currency:
 *   - non–credit-card accounts contribute to `totalCashCurrent`,
 *   - credit-card accounts contribute to `totalAvailableCredit`.
 *
 * Personal cards (entityId === null) are *included* — household runway is
 * deliberately holistic. Per-entity scoping happens upstream by filtering
 * the `balances` map to allowed accounts before calling this.
 */
export function sumCashAndCreditByCurrency(
  currency: CurrencyCode,
  balances: Readonly<Record<AccountName, AccountBalance>>,
): CurrencyCashAndCreditTotals {
  let totalCashCurrent = 0;
  let totalAvailableCredit = 0;
  for (const name of ACCOUNTS) {
    const config = getAccountConfig(name);
    if (config.currency !== currency) continue;
    const row = balances[name];
    if (!row) continue;
    if (isCreditCard(name)) {
      totalAvailableCredit += row.currentBalance;
    } else {
      totalCashCurrent += row.currentBalance;
    }
  }
  return {
    totalCashCurrent: round2(totalCashCurrent),
    totalAvailableCredit: round2(totalAvailableCredit),
  };
}
