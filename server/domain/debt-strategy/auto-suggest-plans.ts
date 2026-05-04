/**
 * Pure: auto-suggest plans for active debts that don't already have a
 * live (active or paused) plan covering them (§1.9).
 *
 * Behaviour at the route level: every `/api/debt-strategy/state` call
 * runs this and surfaces the result as `suggestedPlans`. The user
 * activates the ones they want; suggestions are NEVER persisted
 * (see schema's `suggested` status only existing on the route-only
 * `SuggestedPlan` shape).
 *
 * Order: avalanche (highest APR first). Mortgages and archived debts
 * are excluded — only consumer debts get auto-suggested plans.
 *
 * Default intensity: `'medium'`. The user picks aggressive / passive
 * during the activation flow.
 *
 * Pure: callers supply already-loaded data; this module does no I/O.
 */

import type { CurrencyCode } from '../../../shared/api-contracts.js';
import type { Plan, PlanScope, SuggestedPlan } from './schema.js';
import { presentIntensityOptions } from './present-intensity-options.js';
import { effectiveHeadroomForStrategyPlanning } from './effective-headroom-for-strategy.js';

export interface AutoSuggestDebt {
  readonly id: string;
  readonly name: string;
  /** APR as decimal fraction. Used for avalanche ordering. */
  readonly apr: number;
  /** `'consumer'` | `'mortgage'`. Only `'consumer'` gets suggested plans. */
  readonly kind: 'consumer' | 'mortgage';
  readonly archived: boolean;
  /** Outstanding balance (used as targetAmount for the projection). */
  readonly currentBalance: number;
  /** Source account the debt is paid from. */
  readonly fromAccount: import('../../../shared/api-contracts.js').AccountName;
  /**
   * Currency the debt is denominated in. (Today all of ours are GBP;
   * but the planner is currency-aware in case that changes.)
   */
  readonly currency: CurrencyCode;
  /** Scope this debt belongs to (entity id or 'household'). */
  readonly scope: PlanScope;
}

export interface AutoSuggestPlansInput {
  readonly debts: readonly AutoSuggestDebt[];
  /** All persisted plans. Used to skip debts with a live (active|paused) plan covering them. */
  readonly persistedPlans: readonly Plan[];
  /**
   * Available headroom per (currency, scope) bucket. Caller computes
   * once and passes in. Each suggested plan is sized off the entry
   * matching its debt's currency+scope.
   */
  readonly availableHeadroomByBucket: ReadonlyMap<string, number>;
  readonly today: string;
  /**
   * Holistic money-for-debt-strategy (all buckets, FX-converted) from
   * {@link assembleStrategyCapitalSnapshot}; boosts suggestions when deployable sits in other buckets.
   */
  readonly holisticMoneyForDebtGbp: number;
  readonly holisticMoneyForDebtAed: number;
  /** Same period as capital snapshot (approx months to strategy_end_date). */
  readonly strategyPeriodApproxMonths: number;
}

/** Composite-key helper. Mirrors how the orchestrator buckets headroom. */
export function bucketKey(currency: CurrencyCode, scope: PlanScope): string {
  return `${currency}::${scope}`;
}

export function autoSuggestPlans(input: AutoSuggestPlansInput): SuggestedPlan[] {
  // Skip debts that already have a live plan (active or paused).
  const liveTargetIds = new Set<string>();
  for (const p of input.persistedPlans) {
    if (p.status === 'active' || p.status === 'paused') {
      if (p.target_id !== null) liveTargetIds.add(p.target_id);
    }
  }

  const candidates = input.debts
    .filter(d => d.kind === 'consumer')
    .filter(d => !d.archived)
    .filter(d => d.currentBalance > 0)
    .filter(d => !liveTargetIds.has(d.id))
    // Avalanche: highest APR first.
    .sort((a, b) => b.apr - a.apr);

  const out: SuggestedPlan[] = [];
  for (const debt of candidates) {
    const headroom = input.availableHeadroomByBucket.get(bucketKey(debt.currency, debt.scope)) ?? 0;
    const holisticMoneyForDebt =
      debt.currency === 'AED'
        ? input.holisticMoneyForDebtAed
        : input.holisticMoneyForDebtGbp;
    const effectiveHeadroom = effectiveHeadroomForStrategyPlanning({
      availableHeadroom: headroom,
      moneyForDebtStrategy: holisticMoneyForDebt,
      strategyPeriodApproxMonths: input.strategyPeriodApproxMonths,
    });
    const opts = presentIntensityOptions({
      availableHeadroom: effectiveHeadroom,
      goal: {
        goalType: 'pay-off-debt',
        targetDateOrAsap: 'ASAP',
        targetAmount: debt.currentBalance,
      },
      today: input.today,
    });
    const medium = opts.medium;

    // Only emit a suggestion when there's genuine allocation to make.
    // Zero-allocation suggestions are noise (the user would activate
    // and immediately get plan-infeasible).
    if (medium.monthlyAllocation <= 0) continue;

    out.push({
      id: `suggested:${debt.id}`,
      display_name: `Clear ${debt.name}`,
      goal_type: 'pay-off-debt',
      target_id: debt.id,
      target_amount: null,
      target_account: debt.fromAccount,
      target_date_or_asap: 'ASAP',
      currency: debt.currency,
      scope: debt.scope,
      intensity: 'medium',
      monthly_allocation: medium.monthlyAllocation,
      activated_at: input.today,
      completed_at: null,
      projected_completion_date: medium.projectedCompletionDate,
      notes: null,
      updated_at: input.today,
      status: 'suggested',
    });
  }

  return out;
}
