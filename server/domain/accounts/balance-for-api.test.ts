import { describe, it, expect } from 'vitest';
import { accountBalanceForApi, allAccountBalancesForApi } from './balance-for-api.js';
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

describe('accountBalanceForApi', () => {
  it('adds creditLimit for credit-card accounts', () => {
    const row: AccountBalance = { ...base, account: 'barclaycard' };
    const out = accountBalanceForApi('barclaycard', row);
    expect(out.creditLimit).toBe(1000);
    expect(out.openingBalance).toBe(1000);
  });

  it('omits creditLimit for non-credit accounts', () => {
    const out = accountBalanceForApi('barclays-current', { ...base, account: 'barclays-current' });
    expect('creditLimit' in out).toBe(false);
  });
});

describe('allAccountBalancesForApi', () => {
  it('enriches each key', () => {
    const map: Record<AccountName, AccountBalance> = {
      'barclays-current': { ...base, account: 'barclays-current' },
      'barclays-savings': { ...base, account: 'barclays-savings' },
      'capital-on-tap': { ...base, account: 'capital-on-tap' },
      'barclaycard': { ...base, account: 'barclaycard' },
      'wise-ltd': { ...base, account: 'wise-ltd' },
      'natwest': { ...base, account: 'natwest' },
      'natwest-savings': { ...base, account: 'natwest-savings' },
      'monzo-joint': { ...base, account: 'monzo-joint' },
      'emirates-islamic': { ...base, account: 'emirates-islamic' },
      'santander-everyday': { ...base, account: 'santander-everyday' },
    };
    const out = allAccountBalancesForApi(map);
    expect(out.barclaycard.creditLimit).toBe(1000);
    expect('creditLimit' in out.natwest).toBe(false);
  });
});
