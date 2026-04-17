/**
 * VAT payment matcher
 *
 * Assigns at most one HMRC VAT-pattern payment to each VAT quarter, using a
 * chronological single-pass algorithm:
 *
 *   1. Quarters are processed in ascending dueDate order.
 *   2. For each quarter Q, the candidate window is
 *        [Q.dueDate - earlyWindowDays, nextQ.dueDate - earlyWindowDays)
 *      (unbounded above for the last quarter).
 *   3. The EARLIEST payment in that window, not yet consumed, is assigned to Q.
 *   4. Assigned payments are removed from the pool so they cannot be reused.
 *
 * The helper is pure (no DB access) so it can be unit-tested directly.
 */
import type { VatQuarterRange } from '../config/tax-rates.js';
import type { HmrcPaymentMatch } from '../db/repositories/tax.js';

export const DEFAULT_EARLY_WINDOW_DAYS = 7;

/** Stable key for a quarter: `${startDate}-${endDate}`. */
export function quarterKey(q: VatQuarterRange): string {
  return `${q.startDate}-${q.endDate}`;
}

/**
 * Match HMRC payments to VAT quarters.
 *
 * @param quarters  Quarters to assign payments to (any order; sorted internally).
 * @param payments  Candidate HMRC VAT-pattern payments (any order).
 * @param earlyWindowDays  How many days before a quarter's due date a payment
 *   may still be attributed to that quarter. Defaults to 7.
 * @returns Map keyed by `quarterKey(q)`, value is the assigned payment or null.
 */
export function matchPaymentsToQuarters(
  quarters: readonly VatQuarterRange[],
  payments: readonly HmrcPaymentMatch[],
  earlyWindowDays: number = DEFAULT_EARLY_WINDOW_DAYS,
): Map<string, HmrcPaymentMatch | null> {
  const result = new Map<string, HmrcPaymentMatch | null>();
  if (quarters.length === 0) return result;

  const sortedQuarters = [...quarters].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const pool = [...payments].sort((a, b) => a.date.localeCompare(b.date));
  const consumed = new Set<number>();

  for (let i = 0; i < sortedQuarters.length; i++) {
    const q = sortedQuarters[i];
    const nextQ = sortedQuarters[i + 1];
    const windowStart = shiftIsoDate(q.dueDate, -earlyWindowDays);
    const windowEndExclusive = nextQ ? shiftIsoDate(nextQ.dueDate, -earlyWindowDays) : null;

    let match: HmrcPaymentMatch | null = null;
    for (let j = 0; j < pool.length; j++) {
      if (consumed.has(j)) continue;
      const p = pool[j];
      if (p.date < windowStart) continue;
      if (windowEndExclusive !== null && p.date >= windowEndExclusive) break;
      match = p;
      consumed.add(j);
      break;
    }

    result.set(quarterKey(q), match);
  }

  return result;
}

/**
 * Shift an ISO date string (YYYY-MM-DD) by an integer number of days.
 * Uses UTC midpoint to avoid DST edge cases.
 */
function shiftIsoDate(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}
