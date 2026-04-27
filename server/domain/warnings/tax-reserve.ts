/**
 * Tax-reserve warnings (§1.8).
 *
 * Two codes per (obligation, reserve) combo:
 *   - `tax-reserve-underfunded` — current balance of the reserve
 *     account is less than the sum of obligations of that type due
 *     within the look-ahead window.
 *   - `tax-reserve-trajectory-missing` — even with the rolling
 *     average monthly contribution rate, the reserve's projected
 *     balance at the obligation's due date will fall short of the
 *     liability.
 *
 * No reserve configured for an `(obligation_type, entity_id)` combo
 * → no warning. Treats absence as "policy gap, not violation"; a future
 * data-quality check can surface "obligation X has no reserve
 * configured" as its own warning when needed.
 *
 * Pure: callers supply already-loaded data; this module does no I/O.
 */

import type {
  AccountName,
  EntityFoundationWarning,
  EntityId,
  ObligationRow,
  ObligationType,
  WarningSeverity,
} from '../../../shared/api-contracts.js';
import type { Reserve } from '../reserves/schema.js';
import { reserveKey } from '../reserves/schema.js';

/** Default look-ahead window for "obligations due soon". 90 days. */
export const RESERVE_LOOKAHEAD_DAYS = 90;

/** Severity bands keyed off the funding gap as a fraction of the liability. */
export const RESERVE_UNDERFUNDED_CRITICAL = 0.5; // > 50% of liability uncovered
export const RESERVE_UNDERFUNDED_WARN = 0.0; // any gap at all (after the critical check)

export interface DeriveTaxReserveWarningsInput {
  readonly today: string;
  readonly reserves: readonly Reserve[];
  readonly obligations: readonly ObligationRow[];
  /** Current balance of every reserve account, keyed by account name. */
  readonly balanceByAccount: ReadonlyMap<AccountName, number>;
  /** Average net monthly inflow per account over rolling window. */
  readonly monthlyContributionByAccount: ReadonlyMap<AccountName, number>;
  readonly lookaheadDays?: number;
}

/** ISO-date difference in days, returning a non-negative integer (clamps to 0). */
function daysBetweenIso(start: string, end: string): number {
  const t0 = Date.parse(`${start}T00:00:00Z`);
  const t1 = Date.parse(`${end}T00:00:00Z`);
  const days = Math.round((t1 - t0) / (24 * 60 * 60 * 1000));
  return Math.max(0, days);
}

function shiftIso(start: string, days: number): string {
  const d = new Date(`${start}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Map an `ObligationRow.entity` (string) onto a known `EntityId`. */
function asEntityId(entity: string): EntityId | null {
  if (entity === 'autonize-it-ltd' || entity === 'autonize-it-fzco') return entity;
  return null;
}

interface ReserveGroup {
  readonly reserve: Reserve;
  readonly obligations: ObligationRow[];
  totalDue: number;
  earliestDueDate: string | null;
}

function groupObligationsByReserve(
  obligations: readonly ObligationRow[],
  reserves: readonly Reserve[],
  today: string,
  lookaheadDays: number,
): ReserveGroup[] {
  const horizon = shiftIso(today, lookaheadDays);
  const byKey = new Map<string, ReserveGroup>();
  for (const r of reserves) {
    byKey.set(reserveKey(r.obligation_type, r.entity_id), {
      reserve: r,
      obligations: [],
      totalDue: 0,
      earliestDueDate: null,
    });
  }
  for (const o of obligations) {
    if (o.dueDate === null) continue;
    if (o.dueDate < today) continue;
    if (o.dueDate > horizon) continue;
    if (o.expectedAmount === null) continue;
    const entityId = asEntityId(o.entity);
    if (entityId === null) continue;
    const group = byKey.get(reserveKey(o.type as ObligationType, entityId));
    if (group === undefined) continue; // no reserve configured — skip silently
    group.obligations.push(o);
    group.totalDue += Math.abs(o.expectedAmount);
    if (group.earliestDueDate === null || o.dueDate < group.earliestDueDate) {
      group.earliestDueDate = o.dueDate;
    }
  }
  return [...byKey.values()].filter(g => g.obligations.length > 0);
}

function severityForUnderfunding(gap: number, liability: number): WarningSeverity {
  if (liability <= 0) return 'info';
  const ratio = gap / liability;
  if (ratio > RESERVE_UNDERFUNDED_CRITICAL) return 'critical';
  return 'warn';
}

export function deriveTaxReserveWarnings(
  input: DeriveTaxReserveWarningsInput,
): EntityFoundationWarning[] {
  const lookahead = input.lookaheadDays ?? RESERVE_LOOKAHEAD_DAYS;
  const groups = groupObligationsByReserve(
    input.obligations,
    input.reserves,
    input.today,
    lookahead,
  );

  const out: EntityFoundationWarning[] = [];
  for (const g of groups) {
    const liability = round2(g.totalDue);
    const balance = round2(input.balanceByAccount.get(g.reserve.reserve_account) ?? 0);
    const dueDate = g.earliestDueDate!;

    // 1) Underfunded: balance < liability today
    if (balance < liability) {
      const gap = round2(liability - balance);
      const severity = severityForUnderfunding(gap, liability);
      out.push({
        id: `tax-reserve-underfunded:${g.reserve.obligation_type}:${g.reserve.entity_id}`,
        code: 'tax-reserve-underfunded',
        severity,
        title: `${g.reserve.entity_id} ${g.reserve.obligation_type} reserve is short by ${gap}`,
        detail:
          `Reserve account ${g.reserve.reserve_account} holds ${balance}. ` +
          `Obligations of type ${g.reserve.obligation_type} for ${g.reserve.entity_id} totalling ${liability} ` +
          `are due within ${lookahead} days (earliest ${dueDate}). ` +
          `Shortfall today: ${gap}.`,
        recommended_action:
          severity === 'critical'
            ? `Move ${gap} into ${g.reserve.reserve_account} immediately, or arrange a TTP / payment plan with the relevant authority.`
            : `Top up ${g.reserve.reserve_account} by ${gap} before ${dueDate} to clear this without using credit.`,
        sources: [
          `entity:${g.reserve.entity_id}`,
          `account:${g.reserve.reserve_account}`,
          `obligation-type:${g.reserve.obligation_type}`,
          'reserves',
        ],
        entityId: g.reserve.entity_id,
        context: {
          obligationType: g.reserve.obligation_type,
          entityId: g.reserve.entity_id,
          reserveAccount: g.reserve.reserve_account,
          currentBalance: balance,
          liability,
          shortfall: gap,
          dueDate,
          lookaheadDays: lookahead,
        },
      });
    }

    // 2) Trajectory missing: balance + (months_to_due × monthly_contribution) < liability.
    // Distinct concern from `underfunded`: this surfaces a contribution-rate
    // problem even if today's balance happens to cover today's gap. Both can
    // legitimately fire on the same reserve — they give the user
    // alternative remedies (top up now vs raise the rate).
    const daysToDue = daysBetweenIso(input.today, dueDate);
    const monthsToDue = daysToDue / 30.4375;
    const monthlyContribution = round2(
      input.monthlyContributionByAccount.get(g.reserve.reserve_account) ?? 0,
    );
    const projectedAtDue = round2(balance + monthlyContribution * monthsToDue);
    if (projectedAtDue < liability) {
      const gap = round2(liability - projectedAtDue);
      const monthlyTopUpNeeded = monthsToDue > 0 ? round2(gap / monthsToDue) : gap;
      out.push({
        id: `tax-reserve-trajectory-missing:${g.reserve.obligation_type}:${g.reserve.entity_id}`,
        code: 'tax-reserve-trajectory-missing',
        severity: 'warn',
        title: `${g.reserve.entity_id} ${g.reserve.obligation_type} reserve won't close the gap by ${dueDate}`,
        detail:
          `${g.reserve.reserve_account} balance ${balance} + projected monthly contribution ${monthlyContribution} ` +
          `over ${monthsToDue.toFixed(1)} months = ${projectedAtDue} at due date ${dueDate}. ` +
          `Liability ${liability}. Gap ${gap}.`,
        recommended_action:
          `Contribute an additional ${monthlyTopUpNeeded} per month into ${g.reserve.reserve_account} ` +
          `for the next ${monthsToDue.toFixed(1)} months to land at ${liability} on ${dueDate}.`,
        sources: [
          `entity:${g.reserve.entity_id}`,
          `account:${g.reserve.reserve_account}`,
          `obligation-type:${g.reserve.obligation_type}`,
          'reserves',
        ],
        entityId: g.reserve.entity_id,
        context: {
          obligationType: g.reserve.obligation_type,
          entityId: g.reserve.entity_id,
          reserveAccount: g.reserve.reserve_account,
          currentBalance: balance,
          liability,
          monthlyContribution,
          monthsToDue: round2(monthsToDue),
          projectedBalanceAtDueDate: projectedAtDue,
          gap,
          monthlyTopUpNeeded,
          dueDate,
        },
      });
    }
  }

  return out;
}
