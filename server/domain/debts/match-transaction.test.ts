import { describe, it, expect } from 'vitest';
import type { Debt } from '../../db/repositories/debts.js';
import { transactionMatchesDebt } from './match-transaction.js';

function coventryMortgage(overrides: Partial<Debt> = {}): Debt {
  return {
    id: 'mortgage-heath-park-road',
    name: '53 Heath Park Road Mortgage',
    merchantPattern: 'Coventry B',
    sourceAccounts: ['monzo-joint'],
    originalLoanAmount: 449000,
    originalLoanDate: null,
    openingBalance: 428117,
    openingBalanceDate: '2024-03-14',
    archived: false,
    matchAmounts: [2221.63, 3431.96],
    matchTolerancePct: 0,
    kind: 'mortgage',
    interestRate: 4.4,
    fixedRateEndDate: '2029-06-30',
    repaymentType: 'repayment',
    propertyValueEstimate: 630000,
    propertyId: 'heath-park-road-53',
    updatedAt: '2026-01-01',
    ...overrides,
  };
}

describe('transactionMatchesDebt', () => {
  it('matches abbreviated Coventry BS mortgage payment', () => {
    const debt = coventryMortgage();
    expect(
      transactionMatchesDebt({
        description: 'COVENTRY BS DDR',
        account: 'monzo-joint',
        amount: -2221.63,
        type: 'expense',
      }, debt),
    ).toBe(true);
  });

  it('rejects wrong amount', () => {
    const debt = coventryMortgage();
    expect(
      transactionMatchesDebt({
        description: 'COVENTRY BS',
        account: 'monzo-joint',
        amount: -999,
        type: 'expense',
      }, debt),
    ).toBe(false);
  });

  it('rejects wrong account', () => {
    const debt = coventryMortgage();
    expect(
      transactionMatchesDebt({
        description: 'COVENTRY BS',
        account: 'barclays-current',
        amount: -2221.63,
        type: 'expense',
      }, debt),
    ).toBe(false);
  });

  it('rejects merchant pattern mismatch', () => {
    const debt = coventryMortgage();
    expect(
      transactionMatchesDebt({
        description: 'NATWEST MORTGAGE',
        account: 'monzo-joint',
        amount: -2221.63,
        type: 'expense',
      }, debt),
    ).toBe(false);
  });

  it('skips archived debts', () => {
    const debt = coventryMortgage({ archived: true });
    expect(
      transactionMatchesDebt({
        description: 'COVENTRY BS',
        account: 'monzo-joint',
        amount: -2221.63,
        type: 'expense',
      }, debt),
    ).toBe(false);
  });
});
