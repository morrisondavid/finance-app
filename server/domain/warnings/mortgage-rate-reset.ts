/**
 * Mortgage rate-reset warnings (§1.9).
 *
 * Emits `mortgage-rate-reset-soon` for mortgage debts whose
 * `fixedRateEndDate` falls within the next 90 days. Severity scales
 * with proximity to the reset:
 *   - `< 30 days`  → critical
 *   - `30–90 days` → warn
 *
 * The stress monthly payment is computed at +1.5pp above the current
 * rate as a conservative proxy for the new market rate. Pure: caller
 * supplies already-loaded debts.
 */

import type {
  EntityFoundationWarning,
  WarningSeverity,
} from '../../../shared/api-contracts.js';
import type { Debt } from '../../db/repositories/debts.js';

/** Look-ahead window in days. */
export const RATE_RESET_LOOKAHEAD_DAYS = 90;
/** Severity-bumping threshold. */
export const RATE_RESET_CRITICAL_DAYS = 30;
/** Conservative spread added to the current rate to compute the stress monthly. */
export const RATE_RESET_STRESS_SPREAD = 0.015;

export interface DeriveMortgageRateResetWarningsInput {
  readonly today: string;
  readonly debts: readonly Debt[];
}

function daysBetweenIso(start: string, end: string): number {
  const t0 = Date.parse(`${start}T00:00:00Z`);
  const t1 = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(t0) || !Number.isFinite(t1)) return 0;
  return Math.round((t1 - t0) / (1000 * 60 * 60 * 24));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Approximate stressed monthly payment at a higher rate.
 * For interest-only mortgages: monthly = balance × rate / 12.
 * For repayment mortgages: a similar approximation works at the
 * monthly-payment delta level (this is a stress proxy, not a
 * full amortisation projection).
 */
function stressedMonthlyPayment(
  _balance: number,
  currentRatePct: number,
  currentMonthly: number,
): number {
  // Use a ratio-based stress so both interest-only and repayment
  // mortgages move proportionally with the rate change.
  const currentRate = currentRatePct / 100;
  if (currentRate <= 0) return currentMonthly;
  const stressedRate = currentRate + RATE_RESET_STRESS_SPREAD;
  return round2((stressedRate / currentRate) * currentMonthly);
}

export function deriveMortgageRateResetWarnings(
  input: DeriveMortgageRateResetWarningsInput,
): EntityFoundationWarning[] {
  const out: EntityFoundationWarning[] = [];
  for (const debt of input.debts) {
    if (debt.kind !== 'mortgage') continue;
    if (debt.archived) continue;
    if (debt.fixedRateEndDate === null) continue;
    if (debt.interestRate === null) continue;
    if (debt.matchAmounts.length === 0) continue;

    const days = daysBetweenIso(input.today, debt.fixedRateEndDate);
    if (days < 0 || days > RATE_RESET_LOOKAHEAD_DAYS) continue;

    const currentMonthly = debt.matchAmounts[0];
    const stressedMonthly = stressedMonthlyPayment(
      debt.openingBalance,
      debt.interestRate,
      currentMonthly,
    );
    const monthlyDelta = round2(stressedMonthly - currentMonthly);

    const severity: WarningSeverity = days < RATE_RESET_CRITICAL_DAYS ? 'critical' : 'warn';
    out.push({
      id: `mortgage-rate-reset-soon:${debt.id}`,
      code: 'mortgage-rate-reset-soon',
      severity,
      title: `${debt.name} rate resets in ${days} day${days === 1 ? '' : 's'}`,
      detail:
        `${debt.name} has a fixed-rate period ending ${debt.fixedRateEndDate} ` +
        `(currently ${debt.interestRate}% APR, monthly payment £${currentMonthly}). ` +
        `If the new rate is ~${round2(debt.interestRate + RATE_RESET_STRESS_SPREAD * 100)}% ` +
        `(current rate + 1.5pp stress), the monthly payment becomes ~£${stressedMonthly} ` +
        `(+£${monthlyDelta}/mo).`,
      recommended_action:
        severity === 'critical'
          ? `The reset is imminent — confirm the new rate with the lender and adjust your forecast/plans before it bites.`
          : `Plan ahead: stress-test your forecast at the +1.5pp rate, and consider remortgaging now if a better deal is available.`,
      sources: [`debt:${debt.id}`, 'mortgage-rate-reset'],
      context: {
        debtId: debt.id,
        debtName: debt.name,
        fixedRateEndDate: debt.fixedRateEndDate,
        daysUntilReset: days,
        currentRatePct: debt.interestRate,
        currentMonthlyPayment: currentMonthly,
        stressedMonthlyPaymentAtMarketRate: stressedMonthly,
        monthlyPaymentDelta: monthlyDelta,
        stressSpreadPp: RATE_RESET_STRESS_SPREAD * 100,
      },
    });
  }
  return out;
}
