import { describe, it, expect } from 'vitest';
import { normaliseCreditCardAmounts } from './index.js';
import type { Transaction } from '../types.js';

function makeTransaction(amount: number, account: string): Transaction {
  return {
    date: new Date(2025, 0, 15),
    description: 'TEST TRANSACTION',
    amount,
    account,
    type: amount > 0 ? 'expense' : 'income',
    occurrence: 1,
  };
}

describe('normaliseCreditCardAmounts', () => {
  describe('credit card accounts', () => {
    it('inverts positive purchase amount for capital-on-tap', () => {
      const tx = makeTransaction(105, 'capital-on-tap');
      const result = normaliseCreditCardAmounts(tx, 'capital-on-tap');
      expect(result.amount).toBe(-105);
    });

    it('inverts negative payment amount for capital-on-tap', () => {
      const tx = makeTransaction(-50, 'capital-on-tap');
      const result = normaliseCreditCardAmounts(tx, 'capital-on-tap');
      expect(result.amount).toBe(50);
    });

    it('inverts positive purchase amount for barclaycard', () => {
      const tx = makeTransaction(84.95, 'barclaycard');
      const result = normaliseCreditCardAmounts(tx, 'barclaycard');
      expect(result.amount).toBe(-84.95);
    });

    it('inverts negative payment amount for barclaycard', () => {
      const tx = makeTransaction(-86.13, 'barclaycard');
      const result = normaliseCreditCardAmounts(tx, 'barclaycard');
      expect(result.amount).toBe(86.13);
    });

    it('preserves zero amounts', () => {
      const tx = makeTransaction(0, 'barclaycard');
      const result = normaliseCreditCardAmounts(tx, 'barclaycard');
      expect(result.amount).toBe(-0);
    });

    it('preserves all other transaction fields', () => {
      const tx = makeTransaction(100, 'capital-on-tap');
      const result = normaliseCreditCardAmounts(tx, 'capital-on-tap');
      expect(result.date).toEqual(tx.date);
      expect(result.description).toBe(tx.description);
      expect(result.account).toBe(tx.account);
      expect(result.type).toBe(tx.type);
      expect(result.occurrence).toBe(tx.occurrence);
    });

    it('does not mutate the original transaction', () => {
      const tx = makeTransaction(100, 'barclaycard');
      normaliseCreditCardAmounts(tx, 'barclaycard');
      expect(tx.amount).toBe(100);
    });
  });

  describe('non-credit-card accounts', () => {
    it('does not invert amounts for barclays-current', () => {
      const tx = makeTransaction(-500, 'barclays-current');
      const result = normaliseCreditCardAmounts(tx, 'barclays-current');
      expect(result.amount).toBe(-500);
    });

    it('does not invert amounts for barclays-savings', () => {
      const tx = makeTransaction(1000, 'barclays-savings');
      const result = normaliseCreditCardAmounts(tx, 'barclays-savings');
      expect(result.amount).toBe(1000);
    });

    it('does not invert amounts for natwest', () => {
      const tx = makeTransaction(-6.21, 'natwest');
      const result = normaliseCreditCardAmounts(tx, 'natwest');
      expect(result.amount).toBe(-6.21);
    });

    it('does not invert amounts for monzo-joint', () => {
      const tx = makeTransaction(42, 'monzo-joint');
      const result = normaliseCreditCardAmounts(tx, 'monzo-joint');
      expect(result.amount).toBe(42);
    });
  });

  describe('unknown accounts', () => {
    it('passes through amounts for unrecognised account names', () => {
      const tx = makeTransaction(200, 'unknown-bank');
      const result = normaliseCreditCardAmounts(tx, 'unknown-bank');
      expect(result.amount).toBe(200);
    });
  });
});
