/**
 * Pure: generate a Plan + its Movements from a goal + chosen intensity (§1.9).
 *
 * Composes `presentIntensityOptions` against the available headroom,
 * picks the chosen intensity's allocation, then builds the Plan +
 * one Movement per the §1.9 default ("one transfer per plan,
 * `from_account` → `target_account`, day-of-month derived from any
 * existing same-account standing-order pattern, else 1, capped at 28").
 *
 * Returns either a successful `{ plan, movements }` bundle or a
 * `{ blocked, code, detail? }` reason. The block codes match the §1.8
 * warning-code enum (so the route can re-emit them onto the warnings
 * spine cleanly).
 *
 * Pure: no I/O, no Date.now(). Caller passes `today`.
 */

import type {
  AccountName,
  CurrencyCode,
  EntityFoundationWarningCode,
} from '../../../shared/api-contracts.js';
import {
  presentIntensityOptions,
  type IntensityGoalInput,
} from './present-intensity-options.js';
import { effectiveHeadroomForStrategyPlanning } from './effective-headroom-for-strategy.js';
import type {
  Plan,
  PlanIntensity,
  PlanScope,
  PlanGoalType,
} from './schema.js';
import type { Movement } from './movements-schema.js';

/** §1.9 supports `'household'`, `'autonize-it-ltd'`, `'autonize-it-fzco'`. */
export interface GeneratePlanGoal {
  readonly goalType: PlanGoalType;
  readonly displayName: string;
  /** Debt id for `pay-off-debt`; null otherwise. */
  readonly targetId: string | null;
  /** For `pay-off-debt`: the debt's current outstanding balance. For `save-for-target`: the savings goal. */
  readonly targetAmount: number;
  /** ISO date or `'ASAP'`. */
  readonly targetDateOrAsap: string;
  readonly currency: CurrencyCode;
  readonly scope: PlanScope;
  readonly fromAccount: AccountName;
  readonly targetAccount: AccountName;
  readonly notes?: string | null;
}

export interface GeneratePlanInput {
  readonly goal: GeneratePlanGoal;
  readonly intensity: PlanIntensity;
  readonly availableHeadroom: number;
  readonly today: string;
  /** Stable id for the plan being created. Caller (route) generates this. */
  readonly planId: string;
  /** Stable id for the single movement created at activation. */
  readonly movementId: string;
  /**
   * Day-of-month for the plan's standing order. Caller passes this
   * (typically derived from the user's existing standing-order
   * patterns; defaults to 1 if no signal). Capped at 28 here.
   */
  readonly dayOfMonth: number;
  /** Set of categories that DO have explicit `category_budgets` rows. */
  readonly budgetedCategories: ReadonlySet<string>;
  /** Set of categories that REQUIRE a budget for this plan to be feasible. */
  readonly requiredBudgetedCategories: ReadonlySet<string>;
  /**
   * Capital-aware: money for debt strategy in this bucket (deployable + surplus).
   * When set with {@link strategyPeriodApproxMonths}, boosts intensity headroom
   * so monthly allocations can reflect firepower across the strategy period.
   */
  readonly moneyForDebtStrategy?: number;
  /**
   * Approximate length of the strategy period in months (≥ 1). Used with
   * `moneyForDebtStrategy` to derive a monthly equivalent.
   */
  readonly strategyPeriodApproxMonths?: number;
}

export interface GeneratePlanSuccess {
  readonly blocked: false;
  readonly plan: Plan;
  readonly movements: readonly Movement[];
}

export interface GeneratePlanBlocked {
  readonly blocked: true;
  readonly code: Extract<
    EntityFoundationWarningCode,
    | 'plan-blocked-incomplete-budgets'
    | 'plan-blocked-fzco-no-savings-account'
    | 'plan-infeasible'
  >;
  readonly detail: string;
  readonly missingCategories?: readonly string[];
}

export type GeneratePlanResult = GeneratePlanSuccess | GeneratePlanBlocked;

function clampDayOfMonth(d: number): number {
  if (!Number.isInteger(d) || d < 1) return 1;
  if (d > 28) return 28;
  return d;
}

export function generatePlan(input: GeneratePlanInput): GeneratePlanResult {
  // 1. FZCO save-for-target is unsupported in v1 (no AED savings account).
  if (input.goal.goalType === 'save-for-target' && input.goal.scope === 'autonize-it-fzco') {
    return {
      blocked: true,
      code: 'plan-blocked-fzco-no-savings-account',
      detail:
        'FZCO save-for-target plans are unsupported in v1 (no AED savings account configured).',
    };
  }

  // 2. Required budget categories must all have explicit caps.
  const missing: string[] = [];
  for (const cat of input.requiredBudgetedCategories) {
    if (!input.budgetedCategories.has(cat)) missing.push(cat);
  }
  if (missing.length > 0) {
    return {
      blocked: true,
      code: 'plan-blocked-incomplete-budgets',
      detail: `Categories without explicit budget caps: ${missing.join(', ')}.`,
      missingCategories: missing,
    };
  }

  // 3. Compute intensity options from available headroom (+ capital-aware boost).
  const intensityGoal: IntensityGoalInput = {
    goalType: input.goal.goalType,
    targetDateOrAsap: input.goal.targetDateOrAsap,
    targetAmount: input.goal.targetAmount,
  };
  const headroomForIntensity = effectiveHeadroomForStrategyPlanning({
    availableHeadroom: input.availableHeadroom,
    moneyForDebtStrategy: input.moneyForDebtStrategy,
    strategyPeriodApproxMonths: input.strategyPeriodApproxMonths,
  });

  const opts = presentIntensityOptions({
    availableHeadroom: headroomForIntensity,
    goal: intensityGoal,
    today: input.today,
  });

  if (!opts.feasible) {
    return {
      blocked: true,
      code: 'plan-infeasible',
      detail:
        'Even at maximum intensity (95% of available headroom), the plan cannot reach the target by the deadline. Extend the deadline, free more headroom (deactivate another plan), or reduce the target amount.',
    };
  }

  const chosen = opts[input.intensity];
  if (chosen.monthlyAllocation <= 0) {
    return {
      blocked: true,
      code: 'plan-infeasible',
      detail: 'Available headroom is zero — no allocation can be made.',
    };
  }

  // 4. Build the plan + single movement.
  const day = clampDayOfMonth(input.dayOfMonth);
  const plan: Plan = {
    id: input.planId,
    display_name: input.goal.displayName,
    goal_type: input.goal.goalType,
    target_id: input.goal.targetId,
    target_amount:
      input.goal.goalType === 'save-for-target' ? input.goal.targetAmount : null,
    target_account: input.goal.targetAccount,
    target_date_or_asap: input.goal.targetDateOrAsap,
    currency: input.goal.currency,
    scope: input.goal.scope,
    intensity: input.intensity,
    monthly_allocation: chosen.monthlyAllocation,
    status: 'active',
    activated_at: input.today,
    completed_at: null,
    projected_completion_date: chosen.projectedCompletionDate,
    notes: input.goal.notes ?? null,
    updated_at: input.today,
  };

  const movement: Movement = {
    id: input.movementId,
    plan_id: input.planId,
    from_account: input.goal.fromAccount,
    to_account: input.goal.targetAccount,
    amount: chosen.monthlyAllocation,
    day_of_month: day,
    expected_start_date: input.today,
    expected_end_date: chosen.projectedCompletionDate,
    acknowledged_at: null,
    dismissed_missed_until: null,
    updated_at: input.today,
  };

  return { blocked: false, plan, movements: [movement] };
}
