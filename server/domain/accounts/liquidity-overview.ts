/**
 * Household liquidity rollup for the Dashboard tab: all accounts, native
 * balances + GBP total using static FX (same as runway).
 */

import { ACCOUNTS, type AccountName, type CurrencyCode } from '../../../shared/api-contracts.js';
import { convertAmountSync } from '../../config/exchange-rates.js';
import type { AccountBalance } from '../../db/repositories/balance.js';
import { getAccountConfig, isCreditCard } from './queries.js';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type LiquidityLineKind = 'cash' | 'credit';

export interface LiquidityOverviewLine {
  readonly account: AccountName;
  readonly label: string;
  readonly kind: LiquidityLineKind;
  readonly currency: CurrencyCode;
  readonly amountNative: number;
  readonly amountGbp: number;
}

export interface LiquidityOverview {
  /** Sum of cash/savings/current accounts in GBP (after FX). */
  readonly totalCashGbp: number;
  /** Sum of credit-card available headroom in GBP (after FX). */
  readonly totalCreditGbp: number;
  /** Cash + credit; same incremental rounding as summing the two buckets. */
  readonly totalAvailableGbp: number;
  readonly lines: readonly LiquidityOverviewLine[];
}

function currencySortKey(c: CurrencyCode): number {
  if (c === 'GBP') return 0;
  if (c === 'AED') return 1;
  return 2;
}

/**
 * Build liquidity from raw balances (same source as dashboard `balances`).
 */
export function buildLiquidityOverview(
  rows: Readonly<Record<AccountName, AccountBalance>>,
): LiquidityOverview {
  const lines: LiquidityOverviewLine[] = [];
  let totalCashGbp = 0;
  let totalCreditGbp = 0;
  let totalAvailableGbp = 0;

  for (const name of ACCOUNTS) {
    const row = rows[name];
    if (row === undefined) continue;
    const config = getAccountConfig(name);
    const currency = config.currency;
    const amountNative = row.currentBalance;
    const amountGbp = round2(convertAmountSync(amountNative, currency, 'GBP'));
    const kind: LiquidityLineKind = isCreditCard(name) ? 'credit' : 'cash';
    if (kind === 'credit') {
      totalCreditGbp = round2(totalCreditGbp + amountGbp);
    } else {
      totalCashGbp = round2(totalCashGbp + amountGbp);
    }
    totalAvailableGbp = round2(totalAvailableGbp + amountGbp);
    lines.push({
      account: name,
      label: config.label,
      kind,
      currency,
      amountNative: round2(amountNative),
      amountGbp,
    });
  }

  lines.sort((a, b) => {
    const cc = currencySortKey(a.currency) - currencySortKey(b.currency);
    if (cc !== 0) return cc;
    return a.label.localeCompare(b.label, 'en', { sensitivity: 'base' });
  });

  return {
    totalCashGbp: round2(totalCashGbp),
    totalCreditGbp: round2(totalCreditGbp),
    totalAvailableGbp: round2(totalAvailableGbp),
    lines,
  };
}
