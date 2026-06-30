/**
 * Tax-reserve warnings (§1.8).
 *
 * Codes (per obligation type):
 *   - `tax-reserve-underfunded` — reserve balance < liability for one obligation type
 *   - `tax-reserve-trajectory-missing` — projected contributions won't close the gap
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
import { DEFAULT_RESERVE_LOOKAHEAD_DAYS, reserveKey } from '../reserves/schema.js';
import { entityDisplayLabel, taxObligationTypeDisplayLabel } from './display-labels.js';

/** Default look-ahead window when a reserve row omits `lookahead_days`. */
export const RESERVE_LOOKAHEAD_DAYS = DEFAULT_RESERVE_LOOKAHEAD_DAYS;

/** Severity bands keyed off the funding gap as a fraction of the liability. */
export const RESERVE_UNDERFUNDED_CRITICAL = 0.5;
export const RESERVE_UNDERFUNDED_WARN = 0.0;

/** Suppress trajectory when underfunded already fired and due is this soon. */
const TRAJECTORY_SUPPRESS_DAYS_WHEN_UNDERFUNDED = 14;

export interface DeriveTaxReserveWarningsInput {
  readonly today: string;
  readonly reserves: readonly Reserve[];
  readonly obligations: readonly ObligationRow[];
  readonly balanceByAccount: ReadonlyMap<AccountName, number>;
  readonly monthlyContributionByAccount: ReadonlyMap<AccountName, number>;
}

export function maxReserveLookaheadDays(reserves: readonly Reserve[]): number {
  let max = RESERVE_LOOKAHEAD_DAYS;
  for (const r of reserves) {
    if (r.lookahead_days > max) max = r.lookahead_days;
  }
  return max;
}

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

function asEntityId(entity: string): EntityId | null {
  if (entity === 'autonize-it-ltd' || entity === 'autonize-it-fzco') return entity;
  return null;
}

function obligationInReserveWindow(
  o: ObligationRow,
  today: string,
  horizon: string,
): boolean {
  if (o.dueDate === null || o.expectedAmount === null) return false;
  if (o.dueDate > horizon) return false;
  if (o.dueDate >= today) return true;
  return o.status === 'unpaid';
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
): ReserveGroup[] {
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
    const entityId = asEntityId(o.entity);
    if (entityId === null) continue;
    const group = byKey.get(reserveKey(o.type as ObligationType, entityId));
    if (group === undefined) continue;
    const horizon = shiftIso(today, group.reserve.lookahead_days);
    if (!obligationInReserveWindow(o, today, horizon)) continue;
    group.obligations.push(o);
    group.totalDue += Math.abs(o.expectedAmount ?? 0);
    if (group.earliestDueDate === null || o.dueDate! < group.earliestDueDate) {
      group.earliestDueDate = o.dueDate;
    }
  }
  return [...byKey.values()].filter(g => g.obligations.length > 0);
}

/** Reserve funding status per `obligationType:entityId` for tax overview reads. */
export function computeTaxReserveFundingStatus(
  input: DeriveTaxReserveWarningsInput,
): Map<string, 'funded' | 'underfunded'> {
  const groups = groupObligationsByReserve(input.obligations, input.reserves, input.today);
  const out = new Map<string, 'funded' | 'underfunded'>();
  for (const g of groups) {
    const liability = round2(g.totalDue);
    const balance = round2(input.balanceByAccount.get(g.reserve.reserve_account) ?? 0);
    const key = `${g.reserve.obligation_type}:${g.reserve.entity_id}`;
    out.set(key, balance >= liability ? 'funded' : 'underfunded');
  }
  return out;
}

function severityForUnderfunding(gap: number, liability: number): WarningSeverity {
  if (liability <= 0) return 'info';
  const ratio = gap / liability;
  if (ratio > RESERVE_UNDERFUNDED_CRITICAL) return 'critical';
  return 'warn';
}

function trajectoryRecommendedAction(
  gap: number,
  monthsToDue: number,
  reserveAccount: AccountName,
  dueDate: string,
): string {
  if (monthsToDue < 1) {
    return `Move ${gap} into ${reserveAccount} before ${dueDate} to cover this liability.`;
  }
  const monthlyTopUpNeeded = round2(gap / monthsToDue);
  return (
    `Contribute an additional ${monthlyTopUpNeeded} per month into ${reserveAccount} ` +
    `for the next ${monthsToDue.toFixed(1)} months to land on ${dueDate}.`
  );
}

export function deriveTaxReserveWarnings(
  input: DeriveTaxReserveWarningsInput,
): EntityFoundationWarning[] {
  const groups = groupObligationsByReserve(input.obligations, input.reserves, input.today);

  const out: EntityFoundationWarning[] = [];
  const underfundedKeys = new Set<string>();

  for (const g of groups) {
    const liability = round2(g.totalDue);
    const balance = round2(input.balanceByAccount.get(g.reserve.reserve_account) ?? 0);
    const dueDate = g.earliestDueDate!;
    const lookahead = g.reserve.lookahead_days;
    const entityName = entityDisplayLabel(g.reserve.entity_id);
    const obligationName = taxObligationTypeDisplayLabel(g.reserve.obligation_type);

    if (balance < liability) {
      const gap = round2(liability - balance);
      const severity = severityForUnderfunding(gap, liability);
      underfundedKeys.add(reserveKey(g.reserve.obligation_type, g.reserve.entity_id));
      out.push({
        id: `tax-reserve-underfunded:${g.reserve.obligation_type}:${g.reserve.entity_id}`,
        code: 'tax-reserve-underfunded',
        severity,
        title: `${entityName} ${obligationName} reserve is short by ${gap}`,
        detail:
          `Reserve account ${g.reserve.reserve_account} holds ${balance}. ` +
          `${entityName} ${obligationName} obligations totalling ${liability} ` +
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

    const daysToDue = daysBetweenIso(input.today, dueDate);
    const monthsToDue = daysToDue / 30.4375;
    const monthlyContribution = round2(
      input.monthlyContributionByAccount.get(g.reserve.reserve_account) ?? 0,
    );
    const projectedAtDue = round2(balance + monthlyContribution * monthsToDue);
    const underfundedFired = underfundedKeys.has(reserveKey(g.reserve.obligation_type, g.reserve.entity_id));
    const suppressTrajectory =
      underfundedFired && daysToDue <= TRAJECTORY_SUPPRESS_DAYS_WHEN_UNDERFUNDED;

    if (!suppressTrajectory && projectedAtDue < liability) {
      const gap = round2(liability - projectedAtDue);
      const monthlyTopUpNeeded = monthsToDue >= 1 ? round2(gap / monthsToDue) : gap;
      out.push({
        id: `tax-reserve-trajectory-missing:${g.reserve.obligation_type}:${g.reserve.entity_id}`,
        code: 'tax-reserve-trajectory-missing',
        severity: 'warn',
        title: `${entityName} ${obligationName} reserve won't close the gap by ${dueDate}`,
        detail:
          `${g.reserve.reserve_account} balance ${balance} + projected monthly contribution ${monthlyContribution} ` +
          `over ${monthsToDue.toFixed(1)} months = ${projectedAtDue} at due date ${dueDate}. ` +
          `Liability ${liability}. Gap ${gap}.`,
        recommended_action: trajectoryRecommendedAction(
          gap,
          monthsToDue,
          g.reserve.reserve_account,
          dueDate,
        ),
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
