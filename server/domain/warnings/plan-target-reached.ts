/**
 * `plan-target-reached` + `plan-standing-order-can-be-stopped` (§1.9).
 *
 * Fires (info / celebratory) when the §1.9 `detectTargetReached`
 * gate returns `true` for an active plan. Caller side-effects:
 *   1. Persist plan.status → 'completed', completed_at = today.
 *   2. For each movement on the completed plan whose `acknowledged_at`
 *      is set (i.e. user confirmed the standing order is running),
 *      emit `plan-standing-order-can-be-stopped` so the user knows to
 *      cancel the bank-side order.
 *
 * This emitter ONLY produces the warnings; the route is responsible
 * for the status flip + CSV write.
 *
 * Pure: caller passes the per-plan target-reached reports + the
 * acknowledged movements per completed plan.
 */

import type { EntityFoundationWarning } from '../../../shared/api-contracts.js';
import type { Plan } from '../debt-strategy/schema.js';
import type { Movement } from '../debt-strategy/movements-schema.js';
import type { DetectTargetReachedResult } from '../debt-strategy/detect-target-reached.js';

export interface PlanTargetReachedInputItem {
  readonly plan: Plan;
  readonly report: DetectTargetReachedResult;
  /** Movements on this plan that have an `acknowledged_at` (active standing orders to stop). */
  readonly acknowledgedMovements: readonly Movement[];
}

export interface DerivePlanTargetReachedInput {
  readonly today: string;
  readonly items: readonly PlanTargetReachedInputItem[];
}

export function derivePlanTargetReachedWarnings(
  input: DerivePlanTargetReachedInput,
): EntityFoundationWarning[] {
  const out: EntityFoundationWarning[] = [];
  for (const item of input.items) {
    if (!item.report.reached) continue;
    const evidenceKind = item.report.evidence.kind;
    out.push({
      id: `plan-target-reached:${item.plan.id}`,
      code: 'plan-target-reached',
      severity: 'info',
      title: `'${item.plan.display_name}' — target reached!`,
      detail:
        evidenceKind === 'debt-cleared'
          ? `${item.plan.display_name} successfully cleared its target debt (current balance ` +
            `£${item.report.evidence.currentBalance}). Time to stop the standing order at the bank.`
          : evidenceKind === 'savings-target-reached'
          ? `${item.plan.display_name} hit its £${item.report.evidence.targetAmount} savings ` +
            `target (£${item.report.evidence.netInflowSinceActivation} accumulated since ` +
            `${item.plan.activated_at}). Time to stop the standing order at the bank.`
          : `${item.plan.display_name} target reached.`,
      recommended_action:
        `Cancel the standing order(s) at your bank — see the plan-standing-order-can-be-stopped ` +
        `warnings for the specifics. The plan has been auto-flipped to completed.`,
      sources: [`plan:${item.plan.id}`, 'plan-target-reached'],
      context: {
        planId: item.plan.id,
        planDisplayName: item.plan.display_name,
        evidenceKind,
        currentBalance: item.report.evidence.currentBalance ?? null,
        netInflowSinceActivation: item.report.evidence.netInflowSinceActivation ?? null,
        targetAmount: item.report.evidence.targetAmount ?? null,
      },
    });

    for (const m of item.acknowledgedMovements) {
      out.push({
        id: `plan-standing-order-can-be-stopped:${m.id}`,
        code: 'plan-standing-order-can-be-stopped',
        severity: 'info',
        title: `Stop the £${m.amount} standing order to ${m.to_account}`,
        detail:
          `The £${m.amount} standing order from ${m.from_account} to ${m.to_account} on the ` +
          `${m.day_of_month}th was running for the now-completed plan '${item.plan.display_name}'. ` +
          `Cancel it at the bank to free the headroom for your next plan.`,
        recommended_action:
          `Open your banking app and cancel the standing order matching these terms.`,
        sources: [`plan:${item.plan.id}`, `movement:${m.id}`, 'plan-standing-order-can-be-stopped'],
        context: {
          planId: item.plan.id,
          movementId: m.id,
          amount: m.amount,
          fromAccount: m.from_account,
          toAccount: m.to_account,
          dayOfMonth: m.day_of_month,
        },
      });
    }
  }
  return out;
}
