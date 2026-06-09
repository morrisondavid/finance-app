import { describe, it, expect } from 'vitest';
import type { Debt } from '../../db/repositories/debts.js';
import { findMatchingDebt, transactionMatchesDebt } from './match-transaction.js';

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

function thorneyMortgage(overrides: Partial<Debt> = {}): Debt {
  return {
    id: 'mortgage-thorney-house',
    name: '56 Thorney House Mortgage',
    merchantPattern: 'NatWest',
    sourceAccounts: ['monzo-joint'],
    originalLoanAmount: 121785.99,
    originalLoanDate: null,
    openingBalance: 121785.99,
    openingBalanceDate: '2021-11-30',
    archived: false,
    matchAmounts: [683.38, 630.99, 174.44],
    matchTolerancePct: 0,
    kind: 'mortgage',
    interestRate: 6.74,
    fixedRateEndDate: null,
    repaymentType: 'interest-only',
    propertyValueEstimate: 188085.56,
    propertyId: 'thorney-house-56',
    updatedAt: '2026-01-01',
    ...overrides,
  };
}

function huntersMortgage(overrides: Partial<Debt> = {}): Debt {
  return {
    id: 'mortgage-hunters-square',
    name: '78 Hunters Square Mortgage',
    merchantPattern: 'NatWest',
    sourceAccounts: ['monzo-joint'],
    originalLoanAmount: 214757.15,
    originalLoanDate: null,
    openingBalance: 214757.15,
    openingBalanceDate: '2021-11-30',
    archived: false,
    matchAmounts: [801.35, 1054.64, 306.35],
    matchTolerancePct: 0,
    kind: 'mortgage',
    interestRate: 4.48,
    fixedRateEndDate: '2028-04-30',
    repaymentType: 'interest-only',
    propertyValueEstimate: 315553.21,
    propertyId: 'hunters-square-78',
    updatedAt: '2026-01-01',
    ...overrides,
  };
}

describe('findMatchingDebt', () => {
  const debts = [thorneyMortgage(), huntersMortgage()];

  it('disambiguates two NatWest mortgages by exact amount', () => {
    expect(
      findMatchingDebt({
        description: 'NatWest',
        account: 'monzo-joint',
        amount: -683.38,
        type: 'expense',
      }, debts)?.id,
    ).toBe('mortgage-thorney-house');
    expect(
      findMatchingDebt({
        description: 'NatWest',
        account: 'monzo-joint',
        amount: -801.35,
        type: 'expense',
      }, debts)?.id,
    ).toBe('mortgage-hunters-square');
  });

  it('matches historical Thorney rate via second matchAmounts entry', () => {
    expect(
      findMatchingDebt({
        description: 'NatWest',
        account: 'monzo-joint',
        amount: -630.99,
        type: 'expense',
      }, debts)?.id,
    ).toBe('mortgage-thorney-house');
  });
});
