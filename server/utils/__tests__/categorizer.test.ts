import { describe, it, expect } from 'vitest';
import { categorizeTransaction } from '../categorizer.js';

// ---------------------------------------------------------------------------
// Known bank / building society names that can appear as payees (mortgage
// lenders, loan providers, etc.).  These must NEVER be caught by the
// Transfers pattern — doing so silently drops legitimate bills.
// ---------------------------------------------------------------------------
const BANK_NAMES = [
  'NatWest',
  'Halifax',
  'Coventry Building Society',
  'Nationwide',
  'Lloyds',
  'HSBC',
  'Santander',
  'Barclays Partner Finance',
  'Bank of Ireland',
];

describe('categorizer', () => {
  // ========================================================================
  // Guard: bank names must never be classified as Transfers
  // ========================================================================
  describe('guard: bank names are never Transfers', () => {
    for (const bank of BANK_NAMES) {
      it(`"${bank}" is not classified as Transfers`, () => {
        const category = categorizeTransaction(bank);
        expect(category).not.toBe('Transfers');
      });
    }
  });

  // ========================================================================
  // NatWest mortgage regression — the specific bug
  // ========================================================================
  describe('NatWest mortgage payments', () => {
    it('NatWest direct debit is categorised as Housing', () => {
      expect(categorizeTransaction('NatWest')).toBe('Housing');
    });

    it('NatWest with reference number is Housing', () => {
      expect(categorizeTransaction('NatWest 84211043/3864588')).toBe('Housing');
    });

    it('Monzo-style "Direct Debit, NatWest" is Housing', () => {
      expect(categorizeTransaction('NatWest,,Bills,-683.38')).toBe('Housing');
    });
  });

  // ========================================================================
  // Other Housing items still work
  // ========================================================================
  describe('Housing', () => {
    it('Halifax', () => {
      expect(categorizeTransaction('HALIFAX')).toBe('Housing');
    });

    it('Coventry Building Society', () => {
      expect(categorizeTransaction('Coventry Building Society')).toBe('Housing');
    });

    it('Council Tax', () => {
      expect(categorizeTransaction('HAVERING COUNCIL')).toBe('Housing');
      expect(categorizeTransaction('LONDON BOROUGH')).toBe('Housing');
    });
  });

  // ========================================================================
  // Transfers still work for genuine inter-account movements
  // ========================================================================
  describe('Transfers', () => {
    it('David Morrison', () => {
      expect(categorizeTransaction('DAVID MORRISON')).toBe('Transfers');
    });

    it('Heena Tailor', () => {
      expect(categorizeTransaction('HEENA TAILOR')).toBe('Transfers');
    });

    it('Monzo Joint', () => {
      expect(categorizeTransaction('MONZO JOINT')).toBe('Transfers');
    });

    it('Autonize', () => {
      expect(categorizeTransaction('AUTONIZE')).toBe('Transfers');
    });

    it('Morrison DD', () => {
      expect(categorizeTransaction('MORRISON DD')).toBe('Transfers');
    });

    it('Via Mobile payment', () => {
      expect(categorizeTransaction('VIA MOBILE - PYMT')).toBe('Transfers');
    });
  });

  // ========================================================================
  // Debt Repayment still works
  // ========================================================================
  describe('Debt Repayment', () => {
    it('Barclays Partner Finance', () => {
      expect(categorizeTransaction('BARCLAYS PARTNER FINANCE')).toBe('Debt Repayment');
    });

    it('Santander Cards', () => {
      expect(categorizeTransaction('SANTANDERCARDS LTD')).toBe('Debt Repayment');
    });

    it('MBNA', () => {
      expect(categorizeTransaction('MBNA LIMITED')).toBe('Debt Repayment');
    });

    it('Funding Circle', () => {
      expect(categorizeTransaction('FUNDING CIRCLE')).toBe('Debt Repayment');
    });

    it('Novuna', () => {
      expect(categorizeTransaction('NOVUNA PERSONAL FI')).toBe('Debt Repayment');
    });
  });
});
