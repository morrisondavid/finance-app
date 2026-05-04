/**
 * `plan-transfer-not-set-up` and `plan-transfer-missed` (§1.9).
 *
 * Combined emitter — both warnings live here because they're two
 * states of the same underlying lifecycle event ("the standing
 * order's data flow"):
 *
 *   1. `plan-transfer-not-set-up` (warn) — the plan has been active
 *      for >7 days, the user hasn't ticked "I've set this up", AND
 *      no matched transaction has appeared in the last 40 days.
 *      Severity scales with age (warn → critical at 21d).
 *
 *   2. `plan-transfer-missed` (warn) — `acknowledged_at` is set but
 *      no matched transaction has appeared in the last 40 days.
 *      Silenced until `dismissed_missed_until` if the user dismissed.
 *
 * Strict matching: caller pre-computes whether any transaction in
 * `from_account` matches `(amount exact within 0.01, date within ±3
 * days of day_of_month)`. We use `doAmountsAndDatesMatch` from
 * `inter-company/pair-finder` with the cross-currency case forced
 * to same-currency (plan transfers are always single-currency).
 *
 * Pure: caller passes the per-movement match status.
 */

import type {
  EntityFoundationWarning,
  WarningSeverity,
  CurrencyCode,
} from '../../../shared/api-contracts.js';
import type { Plan } from '../debt-strategy/schema.js';
import type { Movement } from '../debt-strategy/movements-schema.js';

function formatStandingOrderAmount(currency: CurrencyCode, amount: number): string {
  if (currency === 'AED') return `AED ${amount.toFixed(2)}`;
  return `£${amount.toFixed(2)}`;
}

/** Plan-transfer match window. Mirrors §1.8 stricter constants per spec. */
export const PLAN_TRANSFER_DATE_TOLERANCE_DAYS = 3;
export const PLAN_TRANSFER_NOT_SET_UP_DAYS = 7;
export const PLAN_TRANSFER_NOT_SET_UP_CRITICAL_DAYS = 21;
export const PLAN_TRANSFER_MISSED_LOOKBACK_DAYS = 40;

export interface MovementMatchInput {
  readonly plan: Plan;
  readonly movement: Movement;
  /** Date of the most recent matched transaction, or null if none in the lookback window. */
  readonly lastMatchedDate: string | null;
}

export interface DerivePlanTransferWarningsInput {
  readonly today: string;
  readonly movementMatches: readonly MovementMatchInput[];
}

function daysBetween(startIso: string, endIso: string): number {
  const t0 = Date.parse(`${startIso}T00:00:00Z`);
  const t1 = Date.parse(`${endIso}T00:00:00Z`);
  if (!Number.isFinite(t0) || !Number.isFinite(t1)) return 0;
  return Math.round((t1 - t0) / (1000 * 60 * 60 * 24));
}

export function derivePlanTransferWarnings(
  input: DerivePlanTransferWarningsInput,
): EntityFoundationWarning[] {
  const out: EntityFoundationWarning[] = [];
  for (const m of input.movementMatches) {
    const { plan, movement, lastMatchedDate } = m;
    if (plan.status !== 'active') continue;

    const hasRecentMatch =
      lastMatchedDate !== null &&
      daysBetween(lastMatchedDate, input.today) <= PLAN_TRANSFER_MISSED_LOOKBACK_DAYS;

    // Case 1: not-set-up
    if (movement.acknowledged_at === null) {
      const ageDays = daysBetween(movement.expected_start_date, input.today);
      if (ageDays >= PLAN_TRANSFER_NOT_SET_UP_DAYS && !hasRecentMatch) {
        const severity: WarningSeverity =
          ageDays >= PLAN_TRANSFER_NOT_SET_UP_CRITICAL_DAYS ? 'critical' : 'warn';
        out.push({
          id: `plan-transfer-not-set-up:${movement.id}`,
          code: 'plan-transfer-not-set-up',
          severity,
          title: `Set up your bank standing order for '${plan.display_name}'`,
          detail:
            `The plan has been active ${ageDays} days but no matching standing order ` +
            `(${formatStandingOrderAmount(plan.currency, movement.amount)} from ` +
            `${movement.from_account} to ${movement.to_account} on ` +
            `the ${movement.day_of_month}th) has been detected. Either set it up at your bank, ` +
            `OR if you've already done it, tick "I've set this up" on the plan card so we know ` +
            `to start watching for the transfer.`,
          recommended_action:
            `Open your banking app, set up the standing order matching these terms, then return ` +
            `here and click "I've set this up" on the plan card.`,
          sources: [`plan:${plan.id}`, `movement:${movement.id}`, 'plan-transfer-not-set-up'],
          context: {
            planId: plan.id,
            movementId: movement.id,
            planDisplayName: plan.display_name,
            ageDays,
            amount: movement.amount,
            fromAccount: movement.from_account,
            toAccount: movement.to_account,
            dayOfMonth: movement.day_of_month,
          },
        });
      }
      continue;
    }

    // Case 2: missed (acknowledged but no recent match)
    if (hasRecentMatch) continue;

    // Honour user's "dismiss missed warnings until X" silence window.
    if (movement.dismissed_missed_until !== null) {
      const dismissDays = daysBetween(input.today, movement.dismissed_missed_until);
      if (dismissDays >= 0) continue; // future dismissal still active
    }

    out.push({
      id: `plan-transfer-missed:${movement.id}`,
      code: 'plan-transfer-missed',
      severity: 'warn',
      title: `Standing order for '${plan.display_name}' may have stopped`,
      detail:
        `No matching ${formatStandingOrderAmount(plan.currency, movement.amount)} transfer from ` +
        `${movement.from_account} to ` +
        `${movement.to_account} has been detected in the last ${PLAN_TRANSFER_MISSED_LOOKBACK_DAYS} days. ` +
        `${movement.acknowledged_at !== null ? `(Acknowledged ${movement.acknowledged_at}.)` : ''} ` +
        `The bank may have cancelled the standing order, or the amount/date drifted out of the ±3 ` +
        `day / exact-amount match window.`,
      recommended_action:
        `Check the standing order at your bank. If it stopped, restart it. If you intended to ` +
        `pause, dismiss this warning to silence it for the next 30 days.`,
      sources: [`plan:${plan.id}`, `movement:${movement.id}`, 'plan-transfer-missed'],
      context: {
        planId: plan.id,
        movementId: movement.id,
        planDisplayName: plan.display_name,
        amount: movement.amount,
        fromAccount: movement.from_account,
        toAccount: movement.to_account,
        lastMatchedDate: lastMatchedDate ?? null,
      },
    });
  }
  return out;
}
