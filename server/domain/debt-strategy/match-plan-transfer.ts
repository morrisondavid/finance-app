/**
 * Find the most recent bank transaction on `movement.from_account` that
 * matches a plan standing order: same-magnitude outflow, day-of-month
 * within {@link PLAN_TRANSFER_DATE_TOLERANCE_DAYS} of the expected day.
 *
 * Used by plan-transfer warnings (§1.8 / §1.9).
 */

import type { TransactionRow } from '../../db/repositories/transactions.js';
import { PLAN_TRANSFER_DATE_TOLERANCE_DAYS } from '../warnings/plan-transfer.js';
import type { Movement } from './movements-schema.js';

const AMOUNT_EPS = 0.01;

function dayOfMonthUtc(isoDate: string): number {
  return new Date(`${isoDate}T12:00:00.000Z`).getUTCDate();
}

function dayWithinTolerance(
  txIsoDate: string,
  expectedDayOfMonth: number,
  toleranceDays: number,
): boolean {
  const dom = dayOfMonthUtc(txIsoDate);
  return Math.abs(dom - expectedDayOfMonth) <= toleranceDays;
}

function daysBetween(startIso: string, endIso: string): number {
  const t0 = Date.parse(`${startIso}T00:00:00Z`);
  const t1 = Date.parse(`${endIso}T00:00:00Z`);
  if (!Number.isFinite(t0) || !Number.isFinite(t1)) return 0;
  return Math.round((t1 - t0) / (1000 * 60 * 60 * 24));
}

/**
 * Most recent matching debit on `from_account` within the lookback window.
 */
export function findLastPlanTransferMatchDate(input: {
  readonly movement: Movement;
  readonly transactionsOnFromAccount: readonly TransactionRow[];
  readonly today: string;
  readonly lookbackDays: number;
}): string | null {
  const { movement } = input;
  let latest: string | null = null;
  for (const t of input.transactionsOnFromAccount) {
    if (t.date > input.today) continue;
    if (daysBetween(t.date, input.today) > input.lookbackDays) continue;
    if (t.amount >= -AMOUNT_EPS) continue; // outflow / debit only
    if (Math.abs(Math.abs(t.amount) - movement.amount) > AMOUNT_EPS) continue;
    if (!dayWithinTolerance(t.date, movement.day_of_month, PLAN_TRANSFER_DATE_TOLERANCE_DAYS)) {
      continue;
    }
    if (latest === null || t.date > latest) latest = t.date;
  }
  return latest;
}
