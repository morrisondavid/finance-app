/**
 * Single place to turn headroom + goal + intensity into plan figures (§1.9 DRY).
 * Used by {@link generatePlan} and by tests; keeps suggest vs generate aligned.
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
import type { PlanGoalType, PlanIntensity, PlanScope } from './schema.js';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface ProposalGoal {
  readonly goalType: PlanGoalType;
  readonly targetId: string | null;
  readonly targetAmount: number;
  readonly targetDateOrAsap: string;
  readonly currency: CurrencyCode;
  readonly scope: PlanScope;
  readonly fromAccount: AccountName;
  readonly targetAccount: AccountName;
}

export interface BuildDebtStrategyProposalInput {
  readonly goal: ProposalGoal;
  readonly intensity: PlanIntensity;
  readonly availableHeadroom: number;
  readonly today: string;
  readonly moneyForDebtStrategy?: number;
  readonly strategyPeriodApproxMonths?: number;
  /**
   * Pay-off-debt only: existing monthly flow toward the debt (matched standing orders).
   * Total plan paydown = baseline + incremental intensity amount.
   */
  readonly baselineMonthlyTowardTarget?: number;
  readonly budgetedCategories: ReadonlySet<string>;
  readonly requiredBudgetedCategories: ReadonlySet<string>;
}

export interface DebtStrategyProposalSuccess {
  readonly ok: true;
  /** Plan `monthly_allocation` — total monthly paydown or savings rate. */
  readonly totalMonthly: number;
  /** Movement `amount` — incremental new transfer for pay-off-debt; full amount for save-for-target. */
  readonly movementAmount: number;
  readonly projectedCompletionDate: string | null;
}

export interface DebtStrategyProposalBlocked {
  readonly ok: false;
  readonly code: Extract<
    EntityFoundationWarningCode,
    | 'plan-blocked-incomplete-budgets'
    | 'plan-blocked-fzco-no-savings-account'
    | 'plan-infeasible'
  >;
  readonly detail: string;
  readonly missingCategories?: readonly string[];
}

export type BuildDebtStrategyProposalResult = DebtStrategyProposalSuccess | DebtStrategyProposalBlocked;

/**
 * Shared kernel: same rules for manual plan creation and auto-suggest activation.
 */
export function buildDebtStrategyProposal(
  input: BuildDebtStrategyProposalInput,
): BuildDebtStrategyProposalResult {
  if (input.goal.goalType === 'save-for-target' && input.goal.scope === 'autonize-it-fzco') {
    return {
      ok: false,
      code: 'plan-blocked-fzco-no-savings-account',
      detail:
        'FZCO save-for-target plans are unsupported in v1 (no AED savings account configured).',
    };
  }

  const missing: string[] = [];
  for (const cat of input.requiredBudgetedCategories) {
    if (!input.budgetedCategories.has(cat)) missing.push(cat);
  }
  if (missing.length > 0) {
    return {
      ok: false,
      code: 'plan-blocked-incomplete-budgets',
      detail: `Categories without explicit budget caps: ${missing.join(', ')}.`,
      missingCategories: missing,
    };
  }

  const baseline =
    input.goal.goalType === 'pay-off-debt'
      ? Math.max(0, input.baselineMonthlyTowardTarget ?? 0)
      : 0;

  const intensityGoal: IntensityGoalInput = {
    goalType: input.goal.goalType,
    targetDateOrAsap: input.goal.targetDateOrAsap,
    targetAmount: input.goal.targetAmount,
    ...(input.goal.goalType === 'pay-off-debt'
      ? { baselineMonthlyTowardTarget: baseline }
      : {}),
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
      ok: false,
      code: 'plan-infeasible',
      detail:
        'Even at maximum intensity (95% of available headroom), the plan cannot reach the target by the deadline. Extend the deadline, free more headroom (deactivate another plan), or reduce the target amount.',
    };
  }

  const chosen = opts[input.intensity];
  if (chosen.monthlyAllocation <= 0) {
    return {
      ok: false,
      code: 'plan-infeasible',
      detail: 'Available headroom is zero — no allocation can be made.',
    };
  }

  const inc = chosen.monthlyAllocation;
  if (input.goal.goalType === 'pay-off-debt') {
    const totalMonthly = round2(baseline + inc);
    return {
      ok: true,
      totalMonthly,
      movementAmount: inc,
      projectedCompletionDate: chosen.projectedCompletionDate,
    };
  }

  return {
    ok: true,
    totalMonthly: inc,
    movementAmount: inc,
    projectedCompletionDate: chosen.projectedCompletionDate,
  };
}
