/**
 * HMRC payment matcher — global closest-due-date wins
 *
 * Each obligation "slot" (VAT quarter / SA payment deadline / CT due date /
 * TTP installment / …) is assigned at most one HMRC payment. Pairing is
 * governed by a single rule: globally minimise the distance between each
 * assigned payment and its slot's due date, subject to a maximum proximity.
 *
 * Algorithm (greedy global assignment):
 *   1. Enumerate every (payment, slot) pair whose distance is within
 *      `maxProximityDays`.
 *   2. Sort pairs by ascending distance, breaking ties deterministically on
 *      (payment date, slot dueDate).
 *   3. Walk the sorted list, accepting a pair only if neither its payment
 *      nor its slot has already been claimed.
 *
 * Why global greedy instead of per-slot iteration: sequential "pick the
 * closest payment for slot S then consume" can steal a payment that is
 * better suited to a later slot. Global-greedy always commits the best
 * (smallest-distance) pairing first, so no slot is robbed of a payment
 * that was closer to it than to any other slot.
 *
 * The helper is pure (no DB access) so it can be unit-tested directly.
 */
import type { HmrcPaymentMatch } from '../db/repositories/tax.js';

/**
 * Default proximity window historically used for VAT quarters. 90 days ≈
 * one full quarter, large enough to catch extreme-early or extreme-late
 * payments without letting a payment adopt a quarter it has no realistic
 * relationship with. Non-VAT callers (SA, CT) supply their own window.
 */
export const DEFAULT_MAX_PROXIMITY_DAYS = 90;

/**
 * Minimal shape a slot must expose to participate in matching. Callers keep
 * their own richer slot types (VatQuarterRange, SaSlot, CtSlot, …) and
 * project them into this shape at the call site, so the matcher stays
 * domain-agnostic.
 */
export interface PaymentMatchSlot {
  /** Stable identifier, unique within the supplied slot set. */
  key: string;
  /** ISO due date (YYYY-MM-DD). */
  dueDate: string;
}

/**
 * Match HMRC payments to the supplied slots under the global closest-due-date
 * rule. Every slot from the input appears as a key in the returned map; the
 * value is the assigned payment or `null` when no plausible payment exists.
 *
 * @param slots            Slots to assign payments to (any order; sorted internally).
 * @param payments         Candidate HMRC-pattern payments (any order).
 * @param maxProximityDays Maximum |payment.date - slot.dueDate| allowed.
 */
export function matchPaymentsToSlots(
  slots: readonly PaymentMatchSlot[],
  payments: readonly HmrcPaymentMatch[],
  maxProximityDays: number,
): Map<string, HmrcPaymentMatch | null> {
  const result = new Map<string, HmrcPaymentMatch | null>();
  if (slots.length === 0) return result;

  const sortedSlots = [...slots].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  for (const s of sortedSlots) result.set(s.key, null);

  if (payments.length === 0) return result;

  interface Pair { sIndex: number; pIndex: number; dist: number; }
  const pairs: Pair[] = [];
  for (let si = 0; si < sortedSlots.length; si++) {
    for (let pi = 0; pi < payments.length; pi++) {
      const dist = Math.abs(dayDistance(payments[pi].date, sortedSlots[si].dueDate));
      if (dist <= maxProximityDays) pairs.push({ sIndex: si, pIndex: pi, dist });
    }
  }

  // Global ascending by distance, then by payment date, then by slot dueDate
  // — all deterministic, no dependence on insertion order.
  pairs.sort((a, b) => {
    if (a.dist !== b.dist) return a.dist - b.dist;
    const dateCmp = payments[a.pIndex].date.localeCompare(payments[b.pIndex].date);
    if (dateCmp !== 0) return dateCmp;
    return sortedSlots[a.sIndex].dueDate.localeCompare(sortedSlots[b.sIndex].dueDate);
  });

  const takenS = new Set<number>();
  const takenP = new Set<number>();
  for (const { sIndex, pIndex } of pairs) {
    if (takenS.has(sIndex) || takenP.has(pIndex)) continue;
    takenS.add(sIndex);
    takenP.add(pIndex);
    result.set(sortedSlots[sIndex].key, payments[pIndex]);
  }

  return result;
}

/**
 * Shift an ISO date string (YYYY-MM-DD) by an integer number of days.
 * Uses UTC midpoint to avoid DST edge cases.
 */
export function shiftIsoDate(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** Signed day distance `a - b` for ISO dates (both YYYY-MM-DD). */
function dayDistance(a: string, b: string): number {
  const toUtc = (iso: string): number => {
    const [y, m, d] = iso.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(a) - toUtc(b)) / 86_400_000);
}
