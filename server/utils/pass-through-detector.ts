/**
 * Detects "pass-through" income: money that arrives on an account and is
 * immediately forwarded out (same absolute amount within a few days).
 *
 * Only flags the INCOME side — the outgoing leg is already handled by
 * existing transfer detection / categorisation.
 *
 * Pure function, no IO, fully testable.
 */

import { TRANSFER_DATE_TOLERANCE_DAYS } from '../config/transfer-patterns.js';

export interface PassThroughTransaction {
  id: number;
  date: string;   // "YYYY-MM-DD"
  amount: number;  // signed: positive = income, negative = expense
  type: 'income' | 'expense' | 'transfer';
  account: string;
}

export interface PassThroughResult {
  passThroughIds: Set<number>;
  totalExcluded: number;
}

const AMOUNT_TOLERANCE = 0.01;

function daysBetween(a: string, b: string): number {
  const msPerDay = 86_400_000;
  return Math.abs(
    (new Date(a).getTime() - new Date(b).getTime()) / msPerDay,
  );
}

/**
 * Identify income transactions that have a matching outgoing of the exact
 * same amount within TRANSFER_DATE_TOLERANCE_DAYS on the same account.
 *
 * The outgoing must occur ON or AFTER the income (you can't forward money
 * before it arrives).
 */
export function detectPassThrough(
  transactions: PassThroughTransaction[],
): PassThroughResult {
  const incomes: PassThroughTransaction[] = [];
  const outgoings: PassThroughTransaction[] = [];

  for (const t of transactions) {
    if (t.type === 'income' || (t.type === 'transfer' && t.amount > 0)) {
      incomes.push(t);
    }
    if (t.type === 'expense' || (t.type === 'transfer' && t.amount < 0)) {
      outgoings.push(t);
    }
  }

  incomes.sort((a, b) => a.date.localeCompare(b.date));
  outgoings.sort((a, b) => a.date.localeCompare(b.date));

  const usedOutgoingIds = new Set<number>();
  const passThroughIds = new Set<number>();
  let totalExcluded = 0;

  for (const inc of incomes) {
    const incAbs = Math.abs(inc.amount);
    let bestMatch: PassThroughTransaction | null = null;
    let bestGap = Infinity;

    for (const out of outgoings) {
      if (usedOutgoingIds.has(out.id)) continue;
      if (out.account !== inc.account) continue;

      if (out.date < inc.date) continue;

      if (Math.abs(Math.abs(out.amount) - incAbs) > AMOUNT_TOLERANCE) continue;

      const gap = daysBetween(inc.date, out.date);
      if (gap > TRANSFER_DATE_TOLERANCE_DAYS) continue;

      if (gap < bestGap) {
        bestGap = gap;
        bestMatch = out;
      }
    }

    if (bestMatch) {
      usedOutgoingIds.add(bestMatch.id);
      passThroughIds.add(inc.id);
      totalExcluded += incAbs;
    }
  }

  return { passThroughIds, totalExcluded };
}
