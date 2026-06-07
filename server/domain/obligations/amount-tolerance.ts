/**
 * Shared amount-tolerance rules for obligation payment linking and
 * auto-matching. Expressed as a decimal fraction of the expected amount
 * (0.3 = ±30%).
 */

export const DEFAULT_OBLIGATION_AMOUNT_TOLERANCE_RATIO = 0.3;

export function amountWithinTolerance(
  paymentAmountAbs: number,
  expected: number,
  toleranceRatio: number,
): boolean {
  if (expected <= 0) return true;
  const diff = Math.abs(paymentAmountAbs - expected);
  return diff <= expected * toleranceRatio;
}

export class PaymentAmountMismatchError extends Error {
  constructor(
    readonly hash: string,
    readonly paidAmount: number,
    readonly expectedAmount: number,
  ) {
    super(
      `Transaction amount £${paidAmount.toFixed(2)} does not match obligation expected £${expectedAmount.toFixed(2)} (within ${Math.round(DEFAULT_OBLIGATION_AMOUNT_TOLERANCE_RATIO * 100)}% tolerance)`,
    );
    this.name = 'PaymentAmountMismatchError';
  }
}

export function assertPaymentMatchesObligation(opts: {
  hash: string;
  paidAmount: number;
  expectedAmount: number | null;
  toleranceRatio?: number;
}): void {
  if (opts.expectedAmount === null || opts.expectedAmount <= 0) return;
  const ratio = opts.toleranceRatio ?? DEFAULT_OBLIGATION_AMOUNT_TOLERANCE_RATIO;
  if (!amountWithinTolerance(opts.paidAmount, opts.expectedAmount, ratio)) {
    throw new PaymentAmountMismatchError(opts.hash, opts.paidAmount, opts.expectedAmount);
  }
}
