/**
 * Pure: check whether an active plan still fits the current headroom (§1.9).
 *
 * Status bands (size of gap as a fraction of the plan's allocation):
 *   - `ok`         — current available ≥ allocation
 *   - `degraded`   — gap ≤ 25% of allocation
 *   - `infeasible` — gap > 25% of allocation
 *
 * `suggestedRemedies` returns concrete, actionable next-steps. The
 * §1.8 `plan-feasibility-degraded` warning surfaces these as primitive
 * fields so the user can act without re-deriving the math.
 */

import type { Plan, PlanIntensity } from './schema.js';

export type FeasibilityStatus = 'ok' | 'degraded' | 'infeasible';

export interface SuggestedRemedy {
  /** Discriminator — typed primitives for the consumer to render. */
  readonly kind:
    | 'switch-intensity'
    | 'pause-other-plan'
    | 'extend-deadline'
    | 'reduce-target-amount';
  /** Frees this much monthly headroom (positive). */
  readonly freesMonthly: number;
  /** Subject of the remedy — only set on `pause-other-plan`. */
  readonly otherPlanId?: string;
  readonly otherPlanDisplayName?: string;
  /** New intensity to switch to (only set on `switch-intensity`). */
  readonly newIntensity?: PlanIntensity;
}

export interface FeasibilityReport {
  readonly status: FeasibilityStatus;
  /** Required − available, positive when allocation exceeds available. */
  readonly gap: number;
  readonly requiredAllocation: number;
  readonly currentAvailable: number;
  readonly suggestedRemedies: readonly SuggestedRemedy[];
  /** Layman bill runway from capital snapshot (same bucket as plan). */
  readonly months_of_bill_cover_after_plan: number | null;
  /** False when months &lt; 2 per §1.9 capital-aware rule. */
  readonly bill_cover_viable: boolean;
}

const DEGRADED_THRESHOLD = 0.25;

const INTENSITY_FRACTION: Record<PlanIntensity, number> = {
  aggressive: 0.95,
  medium: 0.5,
  passive: 0.15,
};

export interface CheckPlanFeasibilityInput {
  /** The plan being checked. */
  readonly plan: Plan;
  /**
   * Total headroom available for this plan's currency+scope BEFORE
   * subtracting active-plan allocations. The function subtracts the
   * OTHER active plans (everything except `plan` itself) to compute
   * how much headroom is actually available to support `plan`.
   */
  readonly totalHeadroom: number;
  /**
   * All currently-active plans (including `plan` itself). Filtered to
   * the plan's currency+scope before headroom math.
   */
  readonly allActivePlans: readonly Plan[];
  /**
   * From capital-aware snapshot: months of bill cover after all active
   * plans' standing orders. When &lt; 2 the plan is treated as not viable.
   */
  readonly monthsOfBillCoverAfterPlan?: number | null;
}

export function checkPlanFeasibility(input: CheckPlanFeasibilityInput): FeasibilityReport {
  const { plan, totalHeadroom, allActivePlans, monthsOfBillCoverAfterPlan } = input;

  // Other active plans in the same currency+scope claim headroom too.
  const otherClaim = allActivePlans
    .filter(p => p.id !== plan.id)
    .filter(p => p.currency === plan.currency && p.scope === plan.scope)
    .filter(p => p.status === 'active')
    .reduce((sum, p) => sum + p.monthly_allocation, 0);

  const currentAvailable = Math.max(0, totalHeadroom - otherClaim);
  const requiredAllocation = plan.monthly_allocation;
  const gap = Math.max(0, requiredAllocation - currentAvailable);

  let status: FeasibilityStatus;
  if (gap === 0) {
    status = 'ok';
  } else if (requiredAllocation === 0 || gap / requiredAllocation > DEGRADED_THRESHOLD) {
    status = 'infeasible';
  } else {
    status = 'degraded';
  }

  const billMonths = monthsOfBillCoverAfterPlan ?? null;
  const bill_cover_viable =
    billMonths === null ? true : billMonths >= 2;
  if (!bill_cover_viable) {
    status = 'infeasible';
  }

  const suggestedRemedies: SuggestedRemedy[] = [];

  if (status !== 'ok') {
    // 1. Switching to a less aggressive intensity might fit.
    const currentFraction = INTENSITY_FRACTION[plan.intensity];
    const intensities: PlanIntensity[] = ['medium', 'passive'];
    for (const lower of intensities) {
      if (lower === plan.intensity) continue;
      if (INTENSITY_FRACTION[lower] >= currentFraction) continue;
      const wouldUse =
        Math.round(currentAvailable * INTENSITY_FRACTION[lower] * 100) / 100;
      if (wouldUse > 0 && wouldUse < requiredAllocation) {
        suggestedRemedies.push({
          kind: 'switch-intensity',
          freesMonthly: Math.round((requiredAllocation - wouldUse) * 100) / 100,
          newIntensity: lower,
        });
      }
    }

    // 2. Pausing another active plan in the same currency+scope frees
    //    its allocation. Suggest each one ranked by allocation (largest
    //    first — biggest impact on headroom).
    const pausableOthers = allActivePlans
      .filter(p => p.id !== plan.id)
      .filter(p => p.currency === plan.currency && p.scope === plan.scope)
      .filter(p => p.status === 'active')
      .sort((a, b) => b.monthly_allocation - a.monthly_allocation);
    for (const other of pausableOthers) {
      suggestedRemedies.push({
        kind: 'pause-other-plan',
        freesMonthly: other.monthly_allocation,
        otherPlanId: other.id,
        otherPlanDisplayName: other.display_name,
      });
    }

    // 3. Extending the deadline (only meaningful for fixed-date goals).
    //    Concrete amount is route-side concern; we just flag the option.
    if (plan.target_date_or_asap !== 'ASAP') {
      suggestedRemedies.push({
        kind: 'extend-deadline',
        freesMonthly: gap,
      });
    }

    // 4. Reducing the target amount (save-for-target only).
    if (plan.goal_type === 'save-for-target' && plan.target_amount !== null) {
      suggestedRemedies.push({
        kind: 'reduce-target-amount',
        freesMonthly: gap,
      });
    }
  }

  return {
    status,
    gap: Math.round(gap * 100) / 100,
    requiredAllocation,
    currentAvailable: Math.round(currentAvailable * 100) / 100,
    suggestedRemedies,
    months_of_bill_cover_after_plan: billMonths,
    bill_cover_viable,
  };
}
