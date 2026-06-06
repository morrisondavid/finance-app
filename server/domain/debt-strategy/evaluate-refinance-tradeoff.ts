/**
 * Pure: refinance trade-off evaluation (§1.9).
 *
 * Always returns ALL THREE plans side-by-side. NEVER returns a
 * one-sided "saves you £X/mo" framing — the rule that prevents the
 * loan-shark logic trap (lower monthly payment, much higher total
 * cost). The consumer (UI) is required to render all three.
 *
 *   planA_keepAsIs            — pay the source debt as-is at its
 *                                current monthly_payment until clear.
 *   planB_minOnly             — transfer balance to the target card,
 *                                pay only the card's minimum each
 *                                month. Lower monthly cash, often much
 *                                higher total interest.
 *   planB_overpay             — transfer balance to the target card,
 *                                pay the same amount as planA's
 *                                monthly. Useful "what if I keep my
 *                                cash flow the same but get the
 *                                card's lower rate?" comparison.
 *
 * Honours the card's promo period: if the promo expires mid-payoff,
 * `promoExpiresMidPayoff: true` and the post-promo rate kicks in for
 * the remaining months.
 */

import type { CreditCardConfig } from '../accounts/schema.js';
import {
  effectiveMinPaymentFloorGbp,
  effectiveMinPaymentPct,
} from '../accounts/credit-card-terms.js';

export interface RefinanceSourceDebt {
  /** Outstanding balance to refinance. */
  readonly balance: number;
  /** APR as a decimal fraction (`0.154` = 15.4%). */
  readonly apr: number;
  /** Current contractual monthly payment (matchAmounts[0] convention). */
  readonly monthlyPayment: number;
}

export interface RefinancePlanProjection {
  readonly monthlyPayment: number;
  readonly monthsToClear: number;
  readonly totalInterest: number;
  /** Promo transfer fee, when applicable (planB only). */
  readonly transferFee?: number;
  /** Total cost of the plan (interest + transfer fee). */
  readonly totalCost: number;
}

export interface EvaluateRefinanceTradeoffResult {
  readonly planA_keepAsIs: RefinancePlanProjection;
  readonly planB_minOnly: RefinancePlanProjection;
  readonly planB_overpay: RefinancePlanProjection;
  /** True when the promo period ends before the balance clears under planB_minOnly. */
  readonly promoExpiresMidPayoff: boolean;
  /** The rate planB_minOnly reverts to after promo expiry, or null if no promo. */
  readonly postIntroJumpToRate: number | null;
}

const MAX_MONTHS = 600; // 50-year ceiling — anything beyond is degenerate.

/**
 * Simulate paying down a balance month-by-month at a given monthly
 * rate (compound monthly = APR / 12). When `monthlyPaymentFn` returns
 * a value below the interest accrued, the balance grows — we cap at
 * MAX_MONTHS and surface that as a degenerate projection. When the
 * payment exceeds the remaining balance + interest, we cap the final
 * payment to clear exactly.
 */
function simulatePayoff(
  initialBalance: number,
  apr: number,
  monthlyPaymentFn: (month: number, balance: number) => number,
): { months: number; totalInterest: number; totalPaid: number } {
  let balance = initialBalance;
  let totalInterest = 0;
  let totalPaid = 0;
  for (let month = 1; month <= MAX_MONTHS; month++) {
    const monthlyRate = apr / 12;
    const interestThisMonth = balance * monthlyRate;
    balance += interestThisMonth;
    totalInterest += interestThisMonth;
    const requestedPayment = monthlyPaymentFn(month, balance);
    const actualPayment = Math.min(requestedPayment, balance);
    balance -= actualPayment;
    totalPaid += actualPayment;
    if (balance <= 0.005) {
      return { months: month, totalInterest, totalPaid };
    }
  }
  return { months: MAX_MONTHS, totalInterest, totalPaid };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface EvaluateRefinanceTradeoffInput {
  readonly sourceDebt: RefinanceSourceDebt;
  readonly targetCard: CreditCardConfig;
}

/**
 * Default-clock variant. Pure-function tests should call
 * `evaluateRefinanceTradeoffWithToday` directly so the date input is
 * deterministic. This wrapper is convenience for the route, where
 * "today" naturally comes from the system clock.
 */
export function evaluateRefinanceTradeoff(
  input: EvaluateRefinanceTradeoffInput,
): EvaluateRefinanceTradeoffResult {
  const { sourceDebt, targetCard } = input;
  const transferFeePct = targetCard.promo?.transferFeePct ?? 0;
  const transferFee = round2(sourceDebt.balance * transferFeePct);
  return _evaluateInner(sourceDebt, targetCard, transferFee, new Date().toISOString().slice(0, 10));
}

/**
 * Deterministic variant — caller supplies `today`. Used by both the
 * default `evaluateRefinanceTradeoff` (which falls back to system
 * clock) and tests.
 */
export function evaluateRefinanceTradeoffWithToday(
  input: EvaluateRefinanceTradeoffInput & { today: string },
): EvaluateRefinanceTradeoffResult {
  const { sourceDebt, targetCard, today } = input;
  const transferFeePct = targetCard.promo?.transferFeePct ?? 0;
  const transferFee = round2(sourceDebt.balance * transferFeePct);
  return _evaluateInner(sourceDebt, targetCard, transferFee, today);
}

function _evaluateInner(
  sourceDebt: RefinanceSourceDebt,
  targetCard: CreditCardConfig,
  transferFee: number,
  today: string,
): EvaluateRefinanceTradeoffResult {
  // Plan A — pay the source debt as-is.
  const aResult = simulatePayoff(
    sourceDebt.balance,
    sourceDebt.apr,
    () => sourceDebt.monthlyPayment,
  );
  const planA_keepAsIs: RefinancePlanProjection = {
    monthlyPayment: sourceDebt.monthlyPayment,
    monthsToClear: aResult.months,
    totalInterest: round2(aResult.totalInterest),
    totalCost: round2(aResult.totalInterest + sourceDebt.balance),
  };

  // Promo months remaining
  let promoMonths = 0;
  if (targetCard.promo) {
    const start = Date.parse(`${today}T00:00:00Z`);
    const end = Date.parse(`${targetCard.promo.expiresAt}T00:00:00Z`);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      promoMonths = Math.floor((end - start) / (1000 * 60 * 60 * 24) / 30.4375);
    }
  }

  function aprForMonth(month: number): number {
    if (targetCard.promo && month <= promoMonths) return targetCard.promo.apr;
    return targetCard.standardApr;
  }

  // Plan B (min only): pay the minimum percentage each month.
  // Pre-fee balance is `sourceDebt.balance + transferFee`. The
  // simulator can't change APR per month easily (would need a more
  // capable hook), so do month-by-month simulation here directly.
  const balanceB = sourceDebt.balance + transferFee;
  const minPct = effectiveMinPaymentPct(targetCard);
  const PLAN_B_MIN_FLOOR = effectiveMinPaymentFloorGbp(targetCard);

  let balanceMin = balanceB;
  let totalInterestMin = 0;
  let monthsMin = 0;
  for (let month = 1; month <= MAX_MONTHS; month++) {
    const apr = aprForMonth(month);
    const interest = balanceMin * (apr / 12);
    balanceMin += interest;
    totalInterestMin += interest;
    const minPayment = Math.max(PLAN_B_MIN_FLOOR, balanceMin * minPct);
    const actual = Math.min(minPayment, balanceMin);
    balanceMin -= actual;
    monthsMin = month;
    if (balanceMin <= 0.005) break;
  }

  const planB_minOnly: RefinancePlanProjection = {
    monthlyPayment: round2(Math.max(PLAN_B_MIN_FLOOR, balanceB * minPct)),
    monthsToClear: monthsMin,
    totalInterest: round2(totalInterestMin),
    transferFee,
    totalCost: round2(totalInterestMin + transferFee + sourceDebt.balance),
  };

  // Plan B (overpay): pay the SAME monthly as planA's monthly_payment
  // on top of the transfer-fee'd balance.
  let balanceOver = balanceB;
  let totalInterestOver = 0;
  let monthsOver = 0;
  for (let month = 1; month <= MAX_MONTHS; month++) {
    const apr = aprForMonth(month);
    const interest = balanceOver * (apr / 12);
    balanceOver += interest;
    totalInterestOver += interest;
    const actual = Math.min(sourceDebt.monthlyPayment, balanceOver);
    balanceOver -= actual;
    monthsOver = month;
    if (balanceOver <= 0.005) break;
  }

  const planB_overpay: RefinancePlanProjection = {
    monthlyPayment: sourceDebt.monthlyPayment,
    monthsToClear: monthsOver,
    totalInterest: round2(totalInterestOver),
    transferFee,
    totalCost: round2(totalInterestOver + transferFee + sourceDebt.balance),
  };

  return {
    planA_keepAsIs,
    planB_minOnly,
    planB_overpay,
    promoExpiresMidPayoff: targetCard.promo !== undefined && monthsMin > promoMonths,
    postIntroJumpToRate: targetCard.promo ? targetCard.standardApr : null,
  };
}
