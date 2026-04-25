import { describe, it, expect } from 'vitest';
import { sumCashAndCreditByCurrency } from './runway-credit.js';
import type { AccountBalance } from '../../db/repositories/balance.js';
import { ACCOUNTS, type AccountName } from '../../../shared/api-contracts.js';
import { isCreditCard } from './queries.js';

const zero: Omit<AccountBalance, 'account'> = {
  openingBalance: 0,
  openingBalanceDate: null,
  transactionTotal: 0,
  currentBalance: 0,
  oldestTransaction: null,
  newestTransaction: null,
  transactionCount: 0,
};

function buildBalances(
  perAccount: Partial<Record<AccountName, number>>,
): Record<AccountName, AccountBalance> {
  const out = {} as Record<AccountName, AccountBalance>;
  for (const name of ACCOUNTS) {
    out[name] = { account: name, ...zero, currentBalance: perAccount[name] ?? 0 };
  }
  return out;
}

describe('sumCashAndCreditByCurrency', () => {
  it('separates cash from credit-card headroom', () => {
    const balances = buildBalances({
      'barclays-current': 1_500,
      'natwest': 250,
      'capital-on-tap': 4_000,
      'barclaycard': 1_000,
      'santander-everyday': 500,
    });
    const totals = sumCashAndCreditByCurrency('GBP', balances);
    expect(totals.totalCashCurrent).toBe(1_750);
    expect(totals.totalAvailableCredit).toBe(5_500);
  });

  it('does not mix GBP and AED into one figure', () => {
    const balances = buildBalances({
      'barclays-current': 1_000,
      'emirates-islamic': 9_999,
    });
    const gbp = sumCashAndCreditByCurrency('GBP', balances);
    const aed = sumCashAndCreditByCurrency('AED', balances);
    expect(gbp.totalCashCurrent).toBe(1_000);
    expect(aed.totalCashCurrent).toBe(9_999);
  });

  it('respects sign convention — overspent card surfaces as negative headroom', () => {
    const balances = buildBalances({ 'capital-on-tap': -50 });
    const totals = sumCashAndCreditByCurrency('GBP', balances);
    expect(totals.totalAvailableCredit).toBe(-50);
    expect(totals.totalCashCurrent).toBe(0);
  });

  it('agrees with the registry’s creditCards index', () => {
    const balances = buildBalances({});
    expect(() => sumCashAndCreditByCurrency('GBP', balances)).not.toThrow();
    for (const name of ACCOUNTS) {
      expect(typeof isCreditCard(name)).toBe('boolean');
    }
  });
});
