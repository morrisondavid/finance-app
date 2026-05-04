/**
 * Pure: present three intensity options for a goal (§1.9).
 *
 * Given the available headroom and the goal's target shape, returns
 * three discrete monthly-allocation choices the user can pick from:
 *
 *   - Aggressive ≈ 95% of available headroom
 *   - Medium     ≈ 50% of available headroom
 *   - Passive    ≈ min(£100, 15% of available headroom)
 *
 * When the goal has a fixed `target_date`, each option is **stretched
 * upward** to honour the deadline minimum (the amount/month required
 * to hit the target by that date). If even Aggressive can't reach the
 * deadline at the available headroom, `feasible: false` flags the
 * shortfall and Aggressive is set to `availableHeadroom` (the most
 * the user could possibly commit).
 *
 * Pure: no I/O, no Date.now(). Caller passes `today` so tests are
 * deterministic.
 */

import type { Plan } from './schema.js';
import { PLAN_TARGET_DATE_ASAP } from './schema.js';

export interface IntensityGoalInput {
  readonly goalType: Plan['goal_type'];
  /** ISO date or `'ASAP'`. */
  readonly targetDateOrAsap: string;
  /**
   * For `pay-off-debt`: outstanding debt balance to clear (in plan currency).
   * For `save-for-target`: the savings target amount.
   */
  readonly targetAmount: number;
  /**
   * For `pay-off-debt` only: monthly amount already flowing toward this debt
   * (e.g. existing standing orders in `matchAmounts`). Intensity **monthly
   * amounts** are incremental; total paydown rate is baseline + option.
   */
  readonly baselineMonthlyTowardTarget?: number;
}

export interface PresentIntensityOptionsInput {
  readonly availableHeadroom: number;
  readonly goal: IntensityGoalInput;
  /** ISO date — `today`. Used to compute months-to-deadline when the goal has a fixed target_date. */
  readonly today: string;
}

export interface IntensityOption {
  readonly monthlyAllocation: number;
  readonly projectedCompletionDate: string | null;
}

export interface IntensityOptionsResult {
  readonly aggressive: IntensityOption;
  readonly medium: IntensityOption;
  readonly passive: IntensityOption;
  /**
   * `false` when the goal has a fixed `target_date` and even allocating
   * the entire available headroom can't hit the deadline. UI surfaces
   * this; the user must extend the deadline or free more headroom.
   */
  readonly feasible: boolean;
}

const AGGRESSIVE_FRACTION = 0.95;
const MEDIUM_FRACTION = 0.5;
const PASSIVE_FRACTION = 0.15;
const PASSIVE_FLOOR = 100;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Months between two ISO dates (start → end). Always positive when
 * end > start; returns 0 for past or same-day dates so we never
 * divide by zero downstream. Approximate (uses 30.44 days/month);
 * the planner only needs ballpark precision for projections.
 */
function monthsBetween(startIso: string, endIso: string): number {
  const start = Date.parse(`${startIso}T00:00:00Z`);
  const end = Date.parse(`${endIso}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  const days = (end - start) / (1000 * 60 * 60 * 24);
  return days / 30.4375;
}

/** Exported for plan generation — total monthly rate toward `targetAmount`. */
export function projectCompletionDate(
  todayIso: string,
  monthlyAllocation: number,
  targetAmount: number,
): string | null {
  if (monthlyAllocation <= 0 || targetAmount <= 0) return null;
  const months = targetAmount / monthlyAllocation;
  const today = new Date(`${todayIso}T00:00:00Z`);
  // Add `months` calendar months, then floor to the day.
  const wholeMonths = Math.floor(months);
  const fractional = months - wholeMonths;
  today.setUTCMonth(today.getUTCMonth() + wholeMonths);
  today.setUTCDate(today.getUTCDate() + Math.round(fractional * 30.4375));
  return today.toISOString().slice(0, 10);
}

export function presentIntensityOptions(
  input: PresentIntensityOptionsInput,
): IntensityOptionsResult {
  const headroom = Math.max(0, input.availableHeadroom);
  const targetAmount = Math.max(0, input.goal.targetAmount);
  const isFixedDate = input.goal.targetDateOrAsap !== PLAN_TARGET_DATE_ASAP;
  const baseline =
    input.goal.goalType === 'pay-off-debt'
      ? Math.max(0, input.goal.baselineMonthlyTowardTarget ?? 0)
      : 0;

  // 1. Compute the natural option amounts from headroom-percentage.
  //    For pay-off-debt with baseline, these are **incremental** amounts
  //    (new standing order on top of existing matching).
  let aggressiveAmt = round2(headroom * AGGRESSIVE_FRACTION);
  let mediumAmt = round2(headroom * MEDIUM_FRACTION);
  let passiveAmt = round2(Math.min(PASSIVE_FLOOR, headroom * PASSIVE_FRACTION));

  // Clamp to non-negative and to headroom.
  aggressiveAmt = Math.max(0, Math.min(aggressiveAmt, headroom));
  mediumAmt = Math.max(0, Math.min(mediumAmt, headroom));
  passiveAmt = Math.max(0, Math.min(passiveAmt, headroom));

  // 2. If the goal has a fixed target_date, stretch each option upward
  //    to honour the deadline minimum (so a user picking "Passive" still
  //    sees an amount that hits the deadline if they want to). Each
  //    stretched amount is capped at the available headroom.
  let feasible = true;
  if (isFixedDate && targetAmount > 0) {
    const monthsToDeadline = monthsBetween(input.today, input.goal.targetDateOrAsap);
    if (monthsToDeadline > 0) {
      const requiredTotalMonthly = round2(targetAmount / monthsToDeadline);
      const requiredIncremental =
        input.goal.goalType === 'pay-off-debt'
          ? Math.max(0, round2(requiredTotalMonthly - baseline))
          : requiredTotalMonthly;
      if (requiredIncremental > headroom) {
        // Even Aggressive (= entire incremental headroom) can't reach the deadline.
        feasible = false;
        aggressiveAmt = headroom;
        mediumAmt = headroom;
        passiveAmt = headroom;
      } else {
        // Stretch each option's MINIMUM up to requiredIncremental so any
        // chosen intensity hits the deadline (pay-off-debt: incremental).
        aggressiveAmt = Math.max(aggressiveAmt, requiredIncremental);
        mediumAmt = Math.max(mediumAmt, requiredIncremental);
        passiveAmt = Math.max(passiveAmt, requiredIncremental);
      }
    } else {
      // Deadline already passed (or today). Treat as infeasible.
      feasible = false;
      aggressiveAmt = headroom;
      mediumAmt = headroom;
      passiveAmt = headroom;
    }
  }

  // 3. Project completion dates from each chosen amount.
  const rateAgg = input.goal.goalType === 'pay-off-debt' ? baseline + aggressiveAmt : aggressiveAmt;
  const rateMed = input.goal.goalType === 'pay-off-debt' ? baseline + mediumAmt : mediumAmt;
  const ratePass = input.goal.goalType === 'pay-off-debt' ? baseline + passiveAmt : passiveAmt;

  const aggressiveDate = projectCompletionDate(input.today, rateAgg, targetAmount);
  const mediumDate = projectCompletionDate(input.today, rateMed, targetAmount);
  const passiveDate = projectCompletionDate(input.today, ratePass, targetAmount);

  return {
    aggressive: { monthlyAllocation: aggressiveAmt, projectedCompletionDate: aggressiveDate },
    medium: { monthlyAllocation: mediumAmt, projectedCompletionDate: mediumDate },
    passive: { monthlyAllocation: passiveAmt, projectedCompletionDate: passiveDate },
    feasible,
  };
}
