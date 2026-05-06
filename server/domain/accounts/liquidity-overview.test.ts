import { describe, it, expect } from 'vitest';
import { ACCOUNTS, type AccountName } from '../../../shared/api-contracts.js';
import type { AccountBalance } from '../../db/repositories/balance.js';
import { buildLiquidityOverview } from './liquidity-overview.js';

function zeroBalance(account: AccountName): AccountBalance {
  return {
    account,
    openingBalance: 0,
    openingBalanceDate: null,
    transactionTotal: 0,
    currentBalance: 0,
    oldestTransaction: null,
    newestTransaction: null,
    transactionCount: 0,
  };
}

function allZeroBalances(): Record<AccountName, AccountBalance> {
  const out = {} as Record<AccountName, AccountBalance>;
  for (const a of ACCOUNTS) {
    out[a] = zeroBalance(a);
  }
  return out;
}

describe('buildLiquidityOverview', () => {
  it('sums GBP cash, AED converted at static rate, and credit headroom in GBP', () => {
    const rows = allZeroBalances();
    rows.natwest = { ...rows.natwest, currentBalance: 1_000 };
    rows['emirates-islamic'] = { ...rows['emirates-islamic'], currentBalance: 10_000 };
    rows.barclaycard = { ...rows.barclaycard, currentBalance: 500 };

    const o = buildLiquidityOverview(rows);
    // AED/GBP = 0.21 in hardcoded table
    expect(o.lines.find(l => l.account === 'natwest')?.amountGbp).toBe(1_000);
    expect(o.lines.find(l => l.account === 'emirates-islamic')?.amountGbp).toBe(2_100);
    expect(o.lines.find(l => l.account === 'barclaycard')?.kind).toBe('credit');
    expect(o.totalCashGbp).toBe(1_000 + 2_100);
    expect(o.totalCreditGbp).toBe(500);
    expect(o.totalCashGbp + o.totalCreditGbp).toBe(o.totalAvailableGbp);
  });

  it('sorts lines by currency then label', () => {
    const rows = allZeroBalances();
    rows['emirates-islamic'] = { ...rows['emirates-islamic'], currentBalance: 100 };
    rows['monzo-joint'] = { ...rows['monzo-joint'], currentBalance: 50 };
    rows['barclays-current'] = { ...rows['barclays-current'], currentBalance: 200 };

    const o = buildLiquidityOverview(rows);
    const idx = (a: AccountName) => o.lines.findIndex(l => l.account === a);
    expect(idx('barclays-current')).toBeLessThan(idx('emirates-islamic'));
    expect(idx('monzo-joint')).toBeLessThan(idx('emirates-islamic'));
  });
});
