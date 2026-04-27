/**
 * Pure: available headroom (§1.9).
 *
 * Once one or more plans are active, each one has claimed a fixed
 * `monthly_allocation` from the headroom pool. Newly-activated plans
 * (and the intensity-options preview) only see what's left after the
 * already-active plans take their bite.
 *
 * `availableHeadroom = totalHeadroom − Σ(activePlans[*].monthly_allocation)`
 *
 * Active plans are filtered by matching currency + scope so the AED
 * pool and GBP pool stay separate, and a UK Ltd plan's allocation
 * doesn't reduce a personal-scope plan's headroom.
 *
 * Floor at 0.
 */

import type { CurrencyCode } from '../../../shared/api-contracts.js';
import type { Plan, PlanScope } from './schema.js';

export interface AvailableHeadroomInput {
  /** Total headroom for this currency+scope from `computeHeadroom`. */
  readonly totalHeadroom: number;
  /** Currency this slice is in. */
  readonly currency: CurrencyCode;
  /** Scope this slice is in (`'household'` or an entity id). */
  readonly scope: PlanScope;
  /** All known plans (the function filters by status + currency + scope). */
  readonly allPlans: readonly Plan[];
}

export function availableHeadroom(input: AvailableHeadroomInput): number {
  const claimed = input.allPlans
    .filter(p => p.status === 'active')
    .filter(p => p.currency === input.currency && p.scope === input.scope)
    .reduce((sum, p) => sum + p.monthly_allocation, 0);
  return Math.max(0, input.totalHeadroom - claimed);
}
