/**
 * Payoff option rows for suggested debt cards — same kernel as activation.
 */

import type { DebtSummary } from '../../db/repositories/debts.js';

/** Minimal debt shape for payoff projections (callers may pass full {@link DebtSummary}). */
export type DebtPayoffSlice = Pick<DebtSummary, 'id' | 'currentBalance' | 'matchAmounts'>;
import type { AccountName } from '../../../shared/api-contracts.js';
import { buildDebtStrategyProposal } from './debt-strategy-proposal.js';
import type { Plan, PlanIntensity, SuggestedPlan } from './schema.js';
import { projectCompletionDate } from './present-intensity-options.js';

const INTENSITIES: readonly PlanIntensity[] = ['aggressive', 'medium', 'passive'];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function approxMonthsRemaining(todayIso: string, endIso: string | null): number | null {
  if (endIso === null) return null;
  const start = Date.parse(`${todayIso}T12:00:00.000Z`);
  const end = Date.parse(`${endIso}T12:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  const days = (end - start) / (1000 * 60 * 60 * 24);
  return Math.max(1, Math.ceil(days / 30.4375));
}

export interface PayoffIntensityRow {
  readonly intensity: PlanIntensity;
  readonly monthly_total: number;
  readonly supplemental_monthly: number;
  readonly projected_completion_date: string | null;
  readonly approx_months_remaining: number | null;
}

export interface PayoffOneShotRow {
  readonly amount: number;
  readonly projected_completion_date: string | null;
  readonly approx_months_remaining: number | null;
}

export interface SuggestedPlanPayoffOptions {
  readonly current_balance: number;
  readonly baseline_monthly: number;
  readonly intensities: readonly PayoffIntensityRow[];
  readonly one_shot: PayoffOneShotRow | null;
}

/** API shape: suggested plan plus payoff story for cards (§1.9). */
export type SuggestedPlanWithPayoffOptions = SuggestedPlan & {
  readonly payoff_options: SuggestedPlanPayoffOptions;
};

export type PlanWithPayoffSummary = Plan & {
  readonly payoff_summary: ActivePlanPayoffSummary | null;
};

export interface BuildSuggestedPayoffOptionsInput {
  readonly suggested: SuggestedPlan;
  readonly debt: DebtPayoffSlice;
  readonly availableHeadroom: number;
  readonly holisticMoneyForDebt: number;
  readonly strategyPeriodApproxMonths: number;
  readonly today: string;
  /** From {@link buildRecommendedLumpSumAllocations} for this debt id, if any. */
  readonly oneShotLumpAmount?: number;
}

export function buildSuggestedPlanPayoffOptions(
  input: BuildSuggestedPayoffOptionsInput,
): SuggestedPlanPayoffOptions {
  const { suggested, debt, today } = input;
  const baseline = debt.matchAmounts.reduce((a, b) => a + b, 0);

  const goalBase = {
    goalType: 'pay-off-debt' as const,
    targetId: debt.id,
    targetAmount: debt.currentBalance,
    targetDateOrAsap: 'ASAP' as const,
    currency: suggested.currency,
    scope: suggested.scope,
    fromAccount: suggested.target_account as AccountName,
    targetAccount: suggested.target_account as AccountName,
  };

  const emptyBudgets = new Set<string>();

  const intensities: PayoffIntensityRow[] = [];
  for (const intensity of INTENSITIES) {
    const r = buildDebtStrategyProposal({
      goal: goalBase,
      intensity,
      availableHeadroom: input.availableHeadroom,
      today,
      moneyForDebtStrategy: input.holisticMoneyForDebt,
      strategyPeriodApproxMonths: input.strategyPeriodApproxMonths,
      baselineMonthlyTowardTarget: baseline,
      budgetedCategories: emptyBudgets,
      requiredBudgetedCategories: emptyBudgets,
    });
    if (!r.ok) continue;
    intensities.push({
      intensity,
      monthly_total: r.totalMonthly,
      supplemental_monthly: r.movementAmount,
      projected_completion_date: r.projectedCompletionDate,
      approx_months_remaining: approxMonthsRemaining(today, r.projectedCompletionDate),
    });
  }

  let one_shot: PayoffOneShotRow | null = null;
  const lump = input.oneShotLumpAmount;
  if (lump !== undefined && lump > 0 && debt.currentBalance > 0) {
    const amount = round2(Math.min(lump, debt.currentBalance));
    const remaining = round2(Math.max(0, debt.currentBalance - amount));
    const mediumRow = intensities.find(i => i.intensity === 'medium');
    const monthlyAfter =
      mediumRow !== undefined ? mediumRow.monthly_total : baseline > 0 ? baseline : 0.01;
    let projected: string | null = null;
    let months: number | null = null;
    if (remaining <= 0) {
      projected = today;
      months = 0;
    } else if (monthlyAfter > 0) {
      projected = projectCompletionDate(today, monthlyAfter, remaining);
      months = approxMonthsRemaining(today, projected);
    }
    one_shot = {
      amount,
      projected_completion_date: projected,
      approx_months_remaining: months,
    };
  }

  return {
    current_balance: debt.currentBalance,
    baseline_monthly: round2(baseline),
    intensities,
    one_shot,
  };
}

export interface ActivePlanPayoffSummary {
  readonly current_balance: number | null;
  readonly baseline_monthly: number;
  readonly supplemental_monthly: number;
  readonly total_monthly: number;
  readonly projected_completion_date: string | null;
  readonly approx_months_remaining: number | null;
}

export function buildActivePlanPayoffSummary(input: {
  readonly plan: Plan;
  readonly debt: DebtPayoffSlice | undefined;
  readonly supplementalFromMovements: number;
}): ActivePlanPayoffSummary | null {
  const { plan, debt } = input;
  if (plan.goal_type !== 'pay-off-debt' || debt === undefined) return null;
  const baseline = debt.matchAmounts.reduce((a, b) => a + b, 0);
  const total = plan.monthly_allocation;
  const bal = debt.currentBalance;
  let approxMonths: number | null = null;
  if (bal > 0 && total > 0) {
    approxMonths = Math.max(1, Math.ceil(bal / total));
  }
  return {
    current_balance: bal,
    baseline_monthly: round2(baseline),
    supplemental_monthly: round2(input.supplementalFromMovements),
    total_monthly: total,
    projected_completion_date: plan.projected_completion_date,
    approx_months_remaining:
      approxMonthsRemaining(plan.activated_at, plan.projected_completion_date) ?? approxMonths,
  };
}
