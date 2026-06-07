import { describe, it, expect } from 'vitest';
import {
  amountWithinTolerance,
  assertPaymentMatchesObligation,
  DEFAULT_OBLIGATION_AMOUNT_TOLERANCE_RATIO,
  PaymentAmountMismatchError,
} from './amount-tolerance.js';

describe('amountWithinTolerance', () => {
  it('accepts payment within 30% of expected', () => {
    expect(amountWithinTolerance(2123.24, 2123.24, DEFAULT_OBLIGATION_AMOUNT_TOLERANCE_RATIO)).toBe(true);
    expect(amountWithinTolerance(1486.27, 2123.24, DEFAULT_OBLIGATION_AMOUNT_TOLERANCE_RATIO)).toBe(true);
    expect(amountWithinTolerance(2760.21, 2123.24, DEFAULT_OBLIGATION_AMOUNT_TOLERANCE_RATIO)).toBe(true);
  });

  it('rejects payment far below expected (e.g. finance charge vs SA tax)', () => {
    expect(amountWithinTolerance(30.69, 2123.24, DEFAULT_OBLIGATION_AMOUNT_TOLERANCE_RATIO)).toBe(false);
  });

  it('allows any amount when expected is zero or negative', () => {
    expect(amountWithinTolerance(30.69, 0, DEFAULT_OBLIGATION_AMOUNT_TOLERANCE_RATIO)).toBe(true);
  });
});

describe('assertPaymentMatchesObligation', () => {
  it('throws PaymentAmountMismatchError when amounts diverge', () => {
    expect(() => assertPaymentMatchesObligation({
      hash: 'bad-hash',
      paidAmount: 30.69,
      expectedAmount: 2123.24,
    })).toThrowError(PaymentAmountMismatchError);
  });

  it('no-ops when expected amount is unknown', () => {
    expect(() => assertPaymentMatchesObligation({
      hash: 'any-hash',
      paidAmount: 30.69,
      expectedAmount: null,
    })).not.toThrow();
  });
});
