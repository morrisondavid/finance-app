/**
 * Pure: detect when an active plan's target has been reached (§1.9).
 *
 * Two cases:
 *   - `pay-off-debt`: the target debt's `currentBalance` from
 *     `getDebtSummary` is ≤ 0. Catches both planned standing orders
 *     AND one-off balloon payments — the matcher classifies any
 *     payment matching the debt's `matchAmounts` / `merchantPattern`,
 *     so as long as the user's overpayment is reflected in the debt's
 *     `matchAmounts` (or matches via fuzzy tolerance), the balance
 *     drops naturally and this gate fires.
 *   - `save-for-target`: net inflow into `target_account` since
 *     `activated_at` ≥ `target_amount`. Caller computes the inflow.
 *
 * Pure: callers supply already-loaded data; this module does no I/O.
 */

import type { Plan } from './schema.js';

export interface DetectTargetReachedInputBase {
  readonly plan: Plan;
}

export interface DetectPayOffDebtInput extends DetectTargetReachedInputBase {
  /**
   * The plan's target debt's `currentBalance` from `getDebtSummary`.
   * `null` when the debt is missing (e.g. archived) — treated as
   * not-reached to avoid false positives.
   */
  readonly debtCurrentBalance: number | null;
}

export interface DetectSaveForTargetInput extends DetectTargetReachedInputBase {
  /**
   * Net inflow into the plan's `target_account` since `activated_at`.
   * Caller computes this by summing `transactions` in that account
   * (income side) since the activation date, minus any out-of-plan
   * outflows. The function compares against `target_amount`.
   */
  readonly netInflowSinceActivation: number;
}

export type DetectTargetReachedInput = DetectPayOffDebtInput | DetectSaveForTargetInput;

export interface DetectTargetReachedResult {
  readonly reached: boolean;
  /** Primitive evidence the consumer renders ("£0 balance", "£8,200 saved", etc.). */
  readonly evidence: {
    readonly kind: 'debt-cleared' | 'savings-target-reached' | 'not-reached';
    readonly currentBalance?: number;
    readonly netInflowSinceActivation?: number;
    readonly targetAmount?: number;
  };
}

export function detectTargetReached(input: DetectTargetReachedInput): DetectTargetReachedResult {
  if (input.plan.goal_type === 'pay-off-debt') {
    const balance = (input as DetectPayOffDebtInput).debtCurrentBalance;
    if (balance === null) {
      return { reached: false, evidence: { kind: 'not-reached' } };
    }
    if (balance <= 0) {
      return {
        reached: true,
        evidence: { kind: 'debt-cleared', currentBalance: balance },
      };
    }
    return {
      reached: false,
      evidence: { kind: 'not-reached', currentBalance: balance },
    };
  }

  // save-for-target
  const netInflow = (input as DetectSaveForTargetInput).netInflowSinceActivation;
  const target = input.plan.target_amount ?? 0;
  if (target > 0 && netInflow >= target) {
    return {
      reached: true,
      evidence: {
        kind: 'savings-target-reached',
        netInflowSinceActivation: netInflow,
        targetAmount: target,
      },
    };
  }
  return {
    reached: false,
    evidence: {
      kind: 'not-reached',
      netInflowSinceActivation: netInflow,
      targetAmount: target,
    },
  };
}
