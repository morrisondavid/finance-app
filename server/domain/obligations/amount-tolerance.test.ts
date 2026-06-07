import { describe, it, expect } from 'vitest';
import {
  amountWithinTolerance,
  assertPaymentMatchesObligation,
  DEFAULT_OBLIGATION_AMOUNT_TOLERANCE_RATIO,
  paymentCoversObligation,
  PaymentAmountMismatchError,
} from './amount-tolerance.js';

describe('paymentCoversObligation', () => {
  it('accepts exact payment and overpayment', () => {
    expect(paymentCoversObligation(2123.24, 2123.24)).toBe(true);
    expect(paymentCoversObligation(5000, 2123.24)).toBe(true);
  });

  it('rejects underpayment (e.g. finance charge vs SA tax)', () => {
    expect(paymentCoversObligation(30.69, 2123.24)).toBe(false);
    expect(paymentCoversObligation(2000, 2123.24)).toBe(false);
  });

  it('allows penny rounding slack below expected', () => {
    expect(paymentCoversObligation(2123.23, 2123.24)).toBe(true);
  });

  it('allows any amount when expected is zero or negative', () => {
    expect(paymentCoversObligation(30.69, 0)).toBe(true);
  });
});

describe('amountWithinTolerance (auto-matcher only)', () => {
  it('uses symmetric tolerance for renewal matching', () => {
    expect(amountWithinTolerance(900, 615, DEFAULT_OBLIGATION_AMOUNT_TOLERANCE_RATIO)).toBe(false);
    expect(amountWithinTolerance(700, 615, DEFAULT_OBLIGATION_AMOUNT_TOLERANCE_RATIO)).toBe(true);
  });
});

describe('assertPaymentMatchesObligation', () => {
  it('throws PaymentAmountMismatchError when payment is too small', () => {
    expect(() => assertPaymentMatchesObligation({
      hash: 'bad-hash',
      paidAmount: 30.69,
      expectedAmount: 2123.24,
    })).toThrowError(PaymentAmountMismatchError);
  });

  it('accepts overpayment', () => {
    expect(() => assertPaymentMatchesObligation({
      hash: 'ok-hash',
      paidAmount: 5000,
      expectedAmount: 2123.24,
    })).not.toThrow();
  });

  it('no-ops when expected amount is unknown', () => {
    expect(() => assertPaymentMatchesObligation({
      hash: 'any-hash',
      paidAmount: 30.69,
      expectedAmount: null,
    })).not.toThrow();
  });
});
