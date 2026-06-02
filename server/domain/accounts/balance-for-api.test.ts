import { describe, it, expect } from 'vitest';
import {
  accountBalanceForApi,
  accountBalanceSemanticsForApi,
  allAccountBalancesForApi,
} from './balance-for-api.js';
import type { AccountBalance } from '../../db/repositories/balance.js';
import type { AccountName } from '../../types.js';

const base: AccountBalance = {
  account: 'barclays-current',
  openingBalance: 1000,
  openingBalanceDate: '2025-01-01',
  transactionTotal: -100,
  currentBalance: 900,
  oldestTransaction: '2025-01-01',
  newestTransaction: '2025-12-01',
  transactionCount: 5,
};

describe('accountBalanceSemanticsForApi', () => {
  it('classifies current accounts as cash', () => {
    const s = accountBalanceSemanticsForApi('barclays-current', base);
    expect(s).toEqual({
      balanceSemantics: 'cash',
      cashBalance: 900,
      creditLimit: null,
      creditUsed: null,
      creditRemaining: null,
      debtOwed: null,
    });
  });

  it('limit-seeded credit card: credit-remaining (matches roadmap shape)', () => {
    const row: AccountBalance = {
      ...base,
      account: 'capital-on-tap',
      openingBalance: 30000,
      transactionTotal: -1247.3,
      currentBalance: 28752.7,
    };
    const s = accountBalanceSemanticsForApi('capital-on-tap', row);
    expect(s.balanceSemantics).toBe('credit-remaining');
    expect(s.creditLimit).toBe(30000);
    expect(s.creditRemaining).toBe(28752.7);
    expect(s.creditUsed).toBe(1247.3);
    expect(s.debtOwed).toBe(1247.3);
    expect(s.cashBalance).toBeNull();
  });

  it('zero-seeded credit card: debt-owed when balance negative', () => {
    const row: AccountBalance = {
      ...base,
      account: 'santander-everyday',
      openingBalance: 0,
      transactionTotal: -500,
      currentBalance: -500,
    };
    const s = accountBalanceSemanticsForApi('santander-everyday', row);
    expect(s.balanceSemantics).toBe('debt-owed');
    expect(s.debtOwed).toBe(500);
    expect(s.cashBalance).toBeNull();
    expect(s.creditLimit).toBeNull();
  });

  it('passthrough when limit is invalid', () => {
    const row: AccountBalance = {
      ...base,
      account: 'barclaycard',
      openingBalance: NaN,
      currentBalance: 0,
    };
    const s = accountBalanceSemanticsForApi('barclaycard', row);
    expect(s.balanceSemantics).toBe('passthrough');
  });
});

describe('accountBalanceForApi', () => {
  it('merges row with semantics for barclaycard', () => {
    const row: AccountBalance = { ...base, account: 'barclaycard' };
    const out = accountBalanceForApi('barclaycard', row);
    expect(out.balanceSemantics).toBe('credit-remaining');
    expect(out.creditLimit).toBe(1000);
    expect(out.openingBalance).toBe(1000);
  });

  it('includes cash semantics for barclays-current', () => {
    const out = accountBalanceForApi('barclays-current', { ...base, account: 'barclays-current' });
    expect(out.balanceSemantics).toBe('cash');
    expect(out.cashBalance).toBe(900);
  });
});

describe('allAccountBalancesForApi', () => {
  it('enriches each key', () => {
    const map: Record<AccountName, AccountBalance> = {
      'barclays-current': { ...base, account: 'barclays-current' },
      'barclays-savings': { ...base, account: 'barclays-savings' },
      'capital-on-tap': { ...base, account: 'capital-on-tap' },
      barclaycard: { ...base, account: 'barclaycard' },
      'wise-ltd': { ...base, account: 'wise-ltd' },
      natwest: { ...base, account: 'natwest' },
      'natwest-savings': { ...base, account: 'natwest-savings' },
      'monzo-joint': { ...base, account: 'monzo-joint' },
      'emirates-islamic': { ...base, account: 'emirates-islamic' },
      'emirates-islamic-gbp': { ...base, account: 'emirates-islamic-gbp' },
      'emirates-islamic-usd': { ...base, account: 'emirates-islamic-usd' },
      'santander-everyday': { ...base, account: 'santander-everyday', openingBalance: 0, currentBalance: -1 },
    };
    const out = allAccountBalancesForApi(map);
    expect(out.barclaycard.balanceSemantics).toBe('credit-remaining');
    expect(out.natwest.balanceSemantics).toBe('cash');
    expect(out['santander-everyday'].balanceSemantics).toBe('debt-owed');
  });
});
