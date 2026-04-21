import { describe, it, expect } from 'vitest';
import { 
  isTransferDescription, 
  isBounceDescription,
  TRANSFER_PATTERNS,
  BOUNCE_PATTERNS,
  TRANSFER_DATE_TOLERANCE_DAYS
} from './transfer-patterns.js';

describe('Transfer Pattern Detection', () => {
  describe('isTransferDescription', () => {
    it('should detect Capital on Tap transfers', () => {
      expect(isTransferDescription('Capital on Tap payment')).toBe(true);
      expect(isTransferDescription('CAPITAL ON TAP')).toBe(true);
      expect(isTransferDescription('Payment to capital on tap')).toBe(true);
    });

    it('should detect Barclaycard payments', () => {
      expect(isTransferDescription('Barclaycard payment')).toBe(true);
      expect(isTransferDescription('BARCLAYCARD DIRECT DEBIT')).toBe(true);
    });

    it('should detect Santander Everyday card payments by name or card number', () => {
      expect(isTransferDescription('SANTANDER CARDS')).toBe(true);
      expect(isTransferDescription('Santander Credit Card Payment')).toBe(true);
      expect(isTransferDescription('DD TO SANTANDER 3062')).toBe(true);
      // Bare card number should still classify as a transfer reference.
      expect(isTransferDescription('CARD PAYMENT REF 3062')).toBe(true);
    });

    it('should detect generic credit card transfers', () => {
      expect(isTransferDescription('Credit card payment')).toBe(true);
      expect(isTransferDescription('CREDIT CARD REPAYMENT')).toBe(true);
    });

    it('should detect transfer descriptions', () => {
      expect(isTransferDescription('Transfer to savings')).toBe(true);
      expect(isTransferDescription('TRANSFER FROM CURRENT')).toBe(true);
    });

    it('should detect Optional FT (Capital on Tap)', () => {
      expect(isTransferDescription('Optional FT 12345')).toBe(true);
      expect(isTransferDescription('202519 60878820 OPTIONAL FT')).toBe(true);
    });

    it('should detect Capital on Tap reference number', () => {
      expect(isTransferDescription('60878820 payment ref')).toBe(true);
      expect(isTransferDescription('202519 60878820')).toBe(true);
    });

    it('should detect VirtualBankTransfer', () => {
      expect(isTransferDescription('VirtualBankTransfer')).toBe(true);
      expect(isTransferDescription('Payment made (VirtualBankTransfer)')).toBe(true);
    });

    it('should detect draw down transactions', () => {
      expect(isTransferDescription('Draw down request')).toBe(true);
      expect(isTransferDescription('DRAW DOWN')).toBe(true);
    });

    it('should detect Barclays Savings transfers', () => {
      expect(isTransferDescription('BUSINESS PREMIUM STO')).toBe(true);
      expect(isTransferDescription('Business Premium transfer')).toBe(true);
    });

    it('should detect inward remittance (Emirates Islamic)', () => {
      expect(isTransferDescription('INWARD REMITTANCETT REF: AE1RCXT2609003HP AED 4824.33')).toBe(true);
      expect(isTransferDescription('inward remittance')).toBe(true);
    });

    it('should detect Wise / TransferWise transfers', () => {
      expect(isTransferDescription('WISE PAYMENT 12345')).toBe(true);
      expect(isTransferDescription('TransferWise Ltd')).toBe(true);
    });

    it('should NOT detect regular payments', () => {
      expect(isTransferDescription('Amazon purchase')).toBe(false);
      expect(isTransferDescription('SALARY PAYMENT')).toBe(false);
      expect(isTransferDescription('Customer invoice payment')).toBe(false);
      expect(isTransferDescription('HMRC VAT PAYMENT')).toBe(false);
    });
  });

  describe('isBounceDescription', () => {
    it('should detect REV with code 8003', () => {
      expect(isBounceDescription('REV PAYMENT 8003')).toBe(true);
      expect(isBounceDescription('8003 REV insufficient')).toBe(true);
    });

    it('should detect insufficient funds bounces', () => {
      expect(isBounceDescription('8003 insufficient funds')).toBe(true);
      expect(isBounceDescription('Insufficient fund return')).toBe(true);
      expect(isBounceDescription('REV insufficient balance')).toBe(true);
    });

    it('should detect returned payment descriptions', () => {
      expect(isBounceDescription('Returned payment')).toBe(true);
      expect(isBounceDescription('Payment returned')).toBe(true);
    });

    it('should NOT detect regular descriptions', () => {
      expect(isBounceDescription('Regular payment')).toBe(false);
      expect(isBounceDescription('Invoice payment')).toBe(false);
      expect(isBounceDescription('SALARY')).toBe(false);
    });
  });

  describe('Constants', () => {
    it('should have reasonable transfer date tolerance', () => {
      expect(TRANSFER_DATE_TOLERANCE_DAYS).toBe(5);
      expect(TRANSFER_DATE_TOLERANCE_DAYS).toBeGreaterThan(0);
      expect(TRANSFER_DATE_TOLERANCE_DAYS).toBeLessThan(30);
    });

    it('should have transfer patterns defined', () => {
      expect(TRANSFER_PATTERNS.length).toBeGreaterThan(0);
      expect(TRANSFER_PATTERNS.every(p => p instanceof RegExp)).toBe(true);
    });

    it('should have bounce patterns defined', () => {
      expect(BOUNCE_PATTERNS.length).toBeGreaterThan(0);
      expect(BOUNCE_PATTERNS.every(p => p instanceof RegExp)).toBe(true);
    });
  });
});
