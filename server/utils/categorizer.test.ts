import { describe, it, expect } from 'vitest';
import { categorizeTransaction } from './categorizer.js';

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

    it('director salary tokens to David are Payroll (before generic transfer)', () => {
      expect(categorizeTransaction('STO SALARY DAVID MORRISON')).toBe('Payroll');
      expect(categorizeTransaction('STANDING ORDER PAYROLL HEENA TAILOR')).toBe('Payroll');
    });

    it('David Morrison line with DIVIDEND stays Transfers', () => {
      expect(categorizeTransaction('STO DIVIDEND DAVID MORRISON')).toBe('Transfers');
    });

    it('Monzo Joint', () => {
      expect(categorizeTransaction('MONZO JOINT')).toBe('Transfers');
    });

    it('Morrison DD', () => {
      expect(categorizeTransaction('MORRISON DD')).toBe('Transfers');
    });

    it('Via Mobile payment', () => {
      expect(categorizeTransaction('VIA MOBILE - PYMT')).toBe('Transfers');
    });
  });

  describe('EE mobile (Utilities vs Via Mobile transfer)', () => {
    it('EE bill lines stay Utilities when Via Mobile appears on the same description', () => {
      expect(categorizeTransaction('EE LIMITED VIA MOBILE')).toBe('Utilities');
      expect(categorizeTransaction('DIRECT DEBIT EE LTD VIA MOBILE APP')).toBe('Utilities');
    });

    it('BT joint mobile billing and other EE payee strings are Utilities', () => {
      expect(categorizeTransaction('BT GROUP PLC EE MOBILE')).toBe('Utilities');
      expect(categorizeTransaction('DIRECT DEBIT PAYMENT TO EE')).toBe('Utilities');
      expect(categorizeTransaction('EVERYTHING EVERYWHERE DD')).toBe('Utilities');
      expect(categorizeTransaction('T-MOBILE EE')).toBe('Utilities');
    });
  });

  describe('Autonize (own company — Transfers)', () => {
    it('Autonize is classified as Transfers (internal)', () => {
      expect(categorizeTransaction('AUTONIZE')).toBe('Transfers');
      expect(categorizeTransaction('AUTONIZEITLIMITED')).toBe('Transfers');
      expect(categorizeTransaction('AUTONIZE LTD')).toBe('Transfers');
    });
  });

  describe('NatWest Account Fee', () => {
    it('NatWest fees are Other (personal account, not Business)', () => {
      expect(categorizeTransaction('14APR A/C')).toBe('Other');
      expect(categorizeTransaction('02JAN A C')).toBe('Other');
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

    it('Bounce Back Loan (BARCLAYS 0520A ref)', () => {
      expect(categorizeTransaction('BARCLAYS 0520A6538148615 DDR')).toBe('Debt Repayment');
    });

    it('generic Barclays DDR', () => {
      expect(categorizeTransaction('BARCLAYS 9999 SOMETHING DDR')).toBe('Debt Repayment');
    });
  });

  describe('Accommodation vs Travel', () => {
    it('lodging and OTAs are Accommodation', () => {
      expect(categorizeTransaction('AIRBNB *HM123')).toBe('Accommodation');
      expect(categorizeTransaction('BOOKING.COM AMSTERDAM')).toBe('Accommodation');
      expect(categorizeTransaction('PAN PACIFIC SINGAPORE')).toBe('Accommodation');
      expect(categorizeTransaction('PREMIER INN LONDON')).toBe('Accommodation');
      expect(categorizeTransaction('EXPEDIA 12345')).toBe('Accommodation');
    });

    it('airlines, car hire, and airports stay Travel', () => {
      expect(categorizeTransaction('EASYJET')).toBe('Travel');
      expect(categorizeTransaction('BRITISH AIRWAYS')).toBe('Travel');
      expect(categorizeTransaction('EMIRATES AIRLINE')).toBe('Travel');
      expect(categorizeTransaction('ENTERPRISE RENT A CAR')).toBe('Travel');
      expect(categorizeTransaction('STANSTED AIRPORT')).toBe('Travel');
      expect(categorizeTransaction('SCHIPHOL')).toBe('Travel');
    });

    it('NatWest-style commas normalise before match (lodging)', () => {
      expect(categorizeTransaction('5120 08APR26 , AIRBNB , GUEST')).toBe('Accommodation');
    });
  });

  describe('Uber vs Uber Eats', () => {
    it('NatWest-style UBER *EATS is Eating Out', () => {
      expect(categorizeTransaction('5120 15APR26 UBER *EATS NATWEST GBR')).toBe('Eating Out');
    });

    it('UBER PAYMENTS UK is Transport', () => {
      expect(categorizeTransaction('UBER PAYMENTS UK')).toBe('Transport');
    });
  });
});
