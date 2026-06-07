/**
 * Amount rules for obligation payments.
 *
 * Manual "mark paid" linking uses {@link paymentCoversObligation}: the
 * transaction must cover the expected amount (overpayment is fine).
 *
 * The renewal auto-matcher uses symmetric {@link amountWithinTolerance}
 * when the declared premium may drift from the actual debit.
 */

/** Symmetric tolerance for auto-matching renewals (0.3 = ±30%). */
export const DEFAULT_OBLIGATION_AMOUNT_TOLERANCE_RATIO = 0.3;

/** Allowed shortfall vs expected when linking a payment (penny rounding). */
export const OBLIGATION_PAYMENT_UNDERPAYMENT_TOLERANCE_GBP = 0.01;

export function amountWithinTolerance(
  paymentAmountAbs: number,
  expected: number,
  toleranceRatio: number,
): boolean {
  if (expected <= 0) return true;
  const diff = Math.abs(paymentAmountAbs - expected);
  return diff <= expected * toleranceRatio;
}

export function paymentCoversObligation(
  paymentAmountAbs: number,
  expected: number,
  underpaymentToleranceGbp = OBLIGATION_PAYMENT_UNDERPAYMENT_TOLERANCE_GBP,
): boolean {
  if (expected <= 0) return true;
  return paymentAmountAbs >= expected - underpaymentToleranceGbp;
}

export class PaymentAmountMismatchError extends Error {
  constructor(
    readonly hash: string,
    readonly paidAmount: number,
    readonly expectedAmount: number,
  ) {
    super(
      `Transaction amount £${paidAmount.toFixed(2)} is less than obligation expected £${expectedAmount.toFixed(2)}`,
    );
    this.name = 'PaymentAmountMismatchError';
  }
}

export function assertPaymentMatchesObligation(opts: {
  hash: string;
  paidAmount: number;
  expectedAmount: number | null;
}): void {
  if (opts.expectedAmount === null || opts.expectedAmount <= 0) return;
  if (!paymentCoversObligation(opts.paidAmount, opts.expectedAmount)) {
    throw new PaymentAmountMismatchError(opts.hash, opts.paidAmount, opts.expectedAmount);
  }
}
