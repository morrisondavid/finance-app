/**
 * Global-greedy slot ↔ payment pairing — single source of truth.
 *
 * Used by:
 *   - HMRC seeders (VAT / SA / CT / TTP) via {@link matchPaymentsToSlots},
 *     which scores pairs purely by absolute date distance to the slot's
 *     due date, capped by `maxProximityDays`.
 *   - The §1.3 Phase 4 invoice reconciler via {@link pairBestMatches},
 *     which composes amount + date + narrative scores per pair.
 *
 * Both consumers share **one** algorithm: enumerate every candidate pair
 * (whose scorer returns a non-null value), sort the pairs by ascending
 * score with a deterministic tie-breaker, then walk the sorted list and
 * accept a pair iff neither side has been claimed. Global greedy beats
 * per-slot iteration: sequentially picking "closest for slot S, consume"
 * can rob a later slot of a better-suited payment.
 *
 * Pure: no DB / fs access; both functions are unit-testable in
 * isolation.
 */
import type { HmrcPaymentMatch } from '../db/repositories/tax.js';
import { daysBetween, shiftIsoDate } from '../../shared/iso-date.js';

// Re-exported for call sites that reach `shiftIsoDate` through the
// payment-matcher module. The canonical source is shared/iso-date.ts.
export { shiftIsoDate };

/**
 * Default proximity window historically used for VAT quarters. 90 days ≈
 * one full quarter, large enough to catch extreme-early or extreme-late
 * payments without letting a payment adopt a quarter it has no realistic
 * relationship with. Non-VAT callers (SA, CT) supply their own window.
 */
export const DEFAULT_MAX_PROXIMITY_DAYS = 90;

// ─── Generic pairing primitive ───────────────────────────────────────────────

/**
 * Generic input to {@link pairBestMatches}. The matcher is domain-agnostic:
 * each consumer supplies its own slot/payment types, scoring rule, tie
 * breaker, and slot-key extractor.
 */
export interface PairBestMatchesInput<S, P> {
  readonly slots: readonly S[];
  readonly payments: readonly P[];
  /**
   * Returns `null` to disqualify a (slot, payment) pair from matching at
   * all; otherwise a numeric score where **lower wins**. Must be pure +
   * deterministic.
   */
  readonly score: (slot: S, payment: P) => number | null;
  /**
   * Deterministic secondary ordering when two qualifying pairs share the
   * same score. Returned strings are compared with `localeCompare`, so
   * encode the priority you want at the start (e.g. `"YYYY-MM-DD|…"`).
   * Default: empty string (no tie-break beyond original input order, but
   * since `score` is the primary we still pick a stable winner).
   */
  readonly tieBreaker?: (slot: S, payment: P) => string;
  /** Stable identifier used as the result-map key. Must be unique per slot. */
  readonly slotKey: (slot: S) => string;
}

/**
 * Assign at most one payment per slot using global-greedy: the
 * lowest-score pair across all candidates is matched first, then
 * iteratively the next-lowest among remaining slots/payments. Every slot
 * appears in the returned map (value `null` when no candidate
 * qualifies).
 */
export function pairBestMatches<S, P>(
  input: PairBestMatchesInput<S, P>,
): Map<string, P | null> {
  const { slots, payments, score, tieBreaker, slotKey } = input;
  const result = new Map<string, P | null>();
  for (const s of slots) result.set(slotKey(s), null);
  if (slots.length === 0 || payments.length === 0) return result;

  interface Pair {
    readonly sIndex: number;
    readonly pIndex: number;
    readonly score: number;
    readonly tie: string;
  }
  const pairs: Pair[] = [];
  for (let si = 0; si < slots.length; si++) {
    for (let pi = 0; pi < payments.length; pi++) {
      const sc = score(slots[si], payments[pi]);
      if (sc === null) continue;
      const tie = tieBreaker !== undefined ? tieBreaker(slots[si], payments[pi]) : '';
      pairs.push({ sIndex: si, pIndex: pi, score: sc, tie });
    }
  }

  pairs.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    return a.tie.localeCompare(b.tie);
  });

  const takenS = new Set<number>();
  const takenP = new Set<number>();
  for (const { sIndex, pIndex } of pairs) {
    if (takenS.has(sIndex) || takenP.has(pIndex)) continue;
    takenS.add(sIndex);
    takenP.add(pIndex);
    result.set(slotKey(slots[sIndex]), payments[pIndex]);
  }

  return result;
}

// ─── HMRC specialisation ─────────────────────────────────────────────────────

/**
 * Minimal shape an HMRC slot must expose. Callers keep their own richer
 * slot types (VatQuarterRange, SaSlot, CtSlot, …) and project them into
 * this shape at the call site, so the matcher stays domain-agnostic.
 */
export interface PaymentMatchSlot {
  /** Stable identifier, unique within the supplied slot set. */
  key: string;
  /** ISO due date (YYYY-MM-DD). */
  dueDate: string;
}

/**
 * Match HMRC payments to the supplied slots under the global
 * closest-due-date rule (date-only scoring). Thin wrapper over
 * {@link pairBestMatches} so VAT/SA/CT callers continue to read as if
 * nothing changed; tie-break order preserved exactly: distance, then
 * payment date, then slot due date.
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
  return matchPaymentsToSlotsAsymmetric(slots, payments, {
    maxEarlyDays: maxProximityDays,
    maxLateDays: maxProximityDays,
  });
}

export interface AsymmetricProximityDays {
  maxEarlyDays: number;
  maxLateDays: number;
}

/**
 * Match HMRC payments using separate early/late windows around each slot's
 * due date. Used by SA where late filing can land >60 days after 31 Jan but
 * must not overlap the Jul POA2 slot when paying early.
 */
export function matchPaymentsToSlotsAsymmetric(
  slots: readonly PaymentMatchSlot[],
  payments: readonly HmrcPaymentMatch[],
  window: AsymmetricProximityDays,
): Map<string, HmrcPaymentMatch | null> {
  const sortedSlots = [...slots].sort((a, b) =>
    a.dueDate.localeCompare(b.dueDate),
  );
  return pairBestMatches<PaymentMatchSlot, HmrcPaymentMatch>({
    slots: sortedSlots,
    payments,
    score: (slot, payment) => {
      const daysFromDue = daysBetween(payment.date, slot.dueDate);
      const dist = Math.abs(daysFromDue);
      const maxAllowed = daysFromDue >= 0 ? window.maxLateDays : window.maxEarlyDays;
      return dist > maxAllowed ? null : dist;
    },
    tieBreaker: (slot, payment) => `${payment.date}|${slot.dueDate}`,
    slotKey: s => s.key,
  });
}
