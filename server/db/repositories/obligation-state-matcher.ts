/**
 * Auto-matcher for manual one-off / annual obligation renewals.
 *
 * The generic overdue query (`due_date < today AND status NOT IN
 * ('paid','confirmed')`) already surfaces missed renewals on the
 * Obligations tab. What it doesn't do is clear the overdue flag when the
 * user has actually paid — without explicit intervention every annual
 * renewal becomes a permanent red row in the hero.
 *
 * This module closes that loop for the subset of obligations the user
 * cares about:
 *
 *   - category ≠ tax-manual  (HMRC types are handled by their own
 *     dedicated auto-seeders, mixing would double-count).
 *   - frequency ∈ {annual, one-off} (monthly items are deliberately
 *     not modelled — too noisy to be useful).
 *   - dueDate set.
 *
 * For each eligible obligation we scan the transactions table for a
 * matching expense debit (merchant substring, optional account, within
 * ±{@link MATCH_PROXIMITY_DAYS} of the due date, amount within
 * tolerance). A match → write a `source=auto` state row that flips the
 * projected obligation to `paid`; past-due without a match → write
 * `source=auto, status=unpaid` so the overdue hero still lights up.
 *
 * User-authored state rows (`source=user`) are NEVER touched — the
 * Mark Paid UI writes those, and user intent always wins over
 * auto-matching.
 *
 * Split into an impure shell
 * ({@link deriveAndWriteAutoObligationStates}) that owns the DB + CSV
 * I/O and a pure helper
 * ({@link matchManualObligationsToTransactions}) that contains all the
 * matching logic so it can be unit-tested without a DB or filesystem.
 */

import { OBLIGATIONS_DIR } from '../connection.js';
import { buildObligationRegistry } from '../../domain/obligations/registry.js';
import {
  getObligationStateCsvPath,
  readObligationStateFromFile,
  writeObligationStateToFile,
  type ObligationStateRow,
} from '../../domain/obligations/obligation-state.js';
import {
  findExpenseTransactionsByDescriptionPatterns,
  type ExpenseTransactionMatch,
} from './transaction-queries.js';
import { paidFieldsFromTransactionMatch } from '../../domain/obligations/paid-fields.js';
import { shiftIsoDate, toIsoDate, daysBetween } from '../../../shared/iso-date.js';
import type { OutgoingObligation } from '../../../shared/api-contracts.js';

/**
 * Half-window (days either side of an obligation's due date) used when
 * looking for a matching renewal debit. 60 days is generous enough to
 * tolerate "paid a month early" / "paid a month late" without letting a
 * payment drift into the next annual cycle's window.
 */
export const MATCH_PROXIMITY_DAYS = 60;

/**
 * Default amount tolerance when the obligation row doesn't supply its
 * own override. 30% absorbs normal premium inflation (insurance rises
 * 15-25% y/y are common) without letting wildly-off amounts sneak in.
 */
import {
  DEFAULT_OBLIGATION_AMOUNT_TOLERANCE_RATIO,
  amountWithinTolerance,
} from '../../domain/obligations/amount-tolerance.js';

/** @deprecated Use {@link DEFAULT_OBLIGATION_AMOUNT_TOLERANCE_RATIO}. */
export const DEFAULT_AMOUNT_TOLERANCE_RATIO = DEFAULT_OBLIGATION_AMOUNT_TOLERANCE_RATIO;

/**
 * Flattened projection of an {@link OutgoingObligation} into the shape
 * the pure matcher needs. Keeps the matcher domain-agnostic — future
 * non-insurance callers can project into the same struct.
 */
export interface MatcherSlot {
  id: string;
  merchant: string;
  account: string | null;
  dueDate: string;
  expectedAmount: number;
  /** Override for {@link DEFAULT_AMOUNT_TOLERANCE_RATIO}, as a decimal. */
  amountTolerance: number | null;
}

/**
 * Narrow an arbitrary {@link OutgoingObligation} to the subset the
 * matcher accepts: must have a due date, must be annual or one-off, and
 * must not be `tax-manual` (handled by the HMRC seeders).
 */
export function isEligibleForMatcher(
  c: OutgoingObligation,
): c is Extract<OutgoingObligation, { category: 'insurance' }> {
  if (c.category !== 'insurance') return false;
  if (c.frequency !== 'annual' && c.frequency !== 'one-off') return false;
  return typeof c.dueDate === 'string' && c.dueDate.length > 0;
}

function projectToMatcherSlot(
  c: Extract<OutgoingObligation, { category: 'insurance' }>,
): MatcherSlot | null {
  if (!c.dueDate) return null;
  return {
    id: c.id,
    merchant: c.merchant,
    account: c.account ?? null,
    dueDate: c.dueDate,
    expectedAmount: c.amount,
    amountTolerance: c.amountTolerance ?? null,
  };
}

/** Unsigned day distance `|a - b|` for ISO dates (both YYYY-MM-DD). */
function dayDistanceAbs(a: string, b: string): number {
  return Math.abs(daysBetween(a, b));
}

/**
 * Case-insensitive substring test. Mirrors what the SQL LIKE query
 * would do, so callers who pre-filter via SQL don't get surprise
 * mismatches from the pure matcher. Exported for tests.
 */
export function descriptionMatchesMerchant(description: string, merchant: string): boolean {
  if (merchant.length === 0) return false;
  return description.toLowerCase().includes(merchant.toLowerCase());
}

/**
 * Pure matching core. Takes a batch of eligible obligation slots and
 * the full candidate transaction pool, returns the set of state rows
 * the matcher would write.
 *
 * Algorithm is global-greedy by date proximity (mirrors
 * {@link matchPaymentsToSlots}) with an additional merchant/account/
 * amount-tolerance eligibility filter on each (slot, payment) pair.
 * Global-greedy guarantees no transaction is claimed by two
 * obligations; per-pair eligibility lets two same-merchant-same-account
 * obligations with very different premiums (e.g. Orient PI vs PL)
 * coexist without confusion.
 *
 * Emits rows only when a state override is actually required:
 *   - Match found → `source=auto, status=paid` + paid_*.
 *   - No match and overdue → `source=auto, status=unpaid`.
 *   - No match and not yet due → nothing (default projection handles
 *     `pending`/`not-yet-due` — writing a row here would be redundant).
 */
export function matchManualObligationsToTransactions(
  slots: readonly MatcherSlot[],
  candidates: readonly ExpenseTransactionMatch[],
  today: Date,
  opts: {
    maxProximityDays?: number;
    defaultToleranceRatio?: number;
  } = {},
): ObligationStateRow[] {
  if (slots.length === 0) return [];
  const maxProximity = opts.maxProximityDays ?? MATCH_PROXIMITY_DAYS;
  const defaultTolerance = opts.defaultToleranceRatio ?? DEFAULT_AMOUNT_TOLERANCE_RATIO;
  const todayIso = toIsoDate(today);

  interface CandidatePair {
    slotIndex: number;
    paymentIndex: number;
    distance: number;
  }

  const pairs: CandidatePair[] = [];
  for (let si = 0; si < slots.length; si++) {
    const slot = slots[si];
    const tolerance = slot.amountTolerance ?? defaultTolerance;
    for (let pi = 0; pi < candidates.length; pi++) {
      const payment = candidates[pi];
      if (!descriptionMatchesMerchant(payment.description, slot.merchant)) continue;
      if (slot.account !== null && payment.account !== slot.account) continue;
      const distance = dayDistanceAbs(payment.date, slot.dueDate);
      if (distance > maxProximity) continue;
      const paymentAmountAbs = Math.abs(payment.amount);
      if (!amountWithinTolerance(paymentAmountAbs, slot.expectedAmount, tolerance)) continue;
      pairs.push({ slotIndex: si, paymentIndex: pi, distance });
    }
  }

  // Global ascending by distance, then by payment date, then by slot id
  // — fully deterministic, no dependence on input order.
  pairs.sort((a, b) => {
    if (a.distance !== b.distance) return a.distance - b.distance;
    const dateCmp = candidates[a.paymentIndex].date.localeCompare(candidates[b.paymentIndex].date);
    if (dateCmp !== 0) return dateCmp;
    return slots[a.slotIndex].id.localeCompare(slots[b.slotIndex].id);
  });

  const matchedSlot = new Map<number, ExpenseTransactionMatch>();
  const claimedPayment = new Set<number>();
  for (const p of pairs) {
    if (matchedSlot.has(p.slotIndex) || claimedPayment.has(p.paymentIndex)) continue;
    matchedSlot.set(p.slotIndex, candidates[p.paymentIndex]);
    claimedPayment.add(p.paymentIndex);
  }

  const out: ObligationStateRow[] = [];
  for (let si = 0; si < slots.length; si++) {
    const slot = slots[si];
    const match = matchedSlot.get(si);
    if (match) {
      const link = paidFieldsFromTransactionMatch(match);
      out.push({
        id: slot.id,
        status: 'paid',
        paidAmount: link.paidAmount,
        paidDate: link.paidDate,
        paidFromAccount: link.paidFromAccount,
        paidFromTxHash: link.paidFromTxHash,
        source: 'auto',
      });
      continue;
    }
    if (slot.dueDate < todayIso) {
      out.push({
        id: slot.id,
        status: 'unpaid',
        paidAmount: null,
        paidDate: null,
        paidFromAccount: null,
        paidFromTxHash: null,
        source: 'auto',
      });
    }
  }
  return out;
}

/**
 * Impure shell. Reads the obligations registry + current state CSV,
 * queries the transactions table for each eligible obligation's
 * candidate renewal debits, runs the pure matcher, and writes the
 * refreshed state file.
 *
 * Write policy: rebuilds all `source=auto` rows from scratch each run
 * (so stale auto-rows from deleted/edited transactions naturally fall
 * out) while preserving every `source=user` row byte-for-byte. One
 * atomic CSV write per invocation.
 *
 * Intended to run alongside the HMRC auto-seeders at startup and
 * after every CSV upload — see {@link server/db/index.ts#initDatabase}.
 */
export function deriveAndWriteAutoObligationStates(opts: { today?: Date } = {}): void {
  const today = opts.today ?? new Date();
  const registry = buildObligationRegistry(OBLIGATIONS_DIR);
  const stateCsvPath = getObligationStateCsvPath(OBLIGATIONS_DIR);

  const existingState = readObligationStateFromFile(stateCsvPath);
  const userRows: ObligationStateRow[] = [];
  const userOwnedIds = new Set<string>();
  for (const row of existingState.values()) {
    if (row.source === 'user') {
      userRows.push(row);
      userOwnedIds.add(row.id);
    }
  }

  const slots: MatcherSlot[] = [];
  for (const c of registry.outgoing) {
    if (!isEligibleForMatcher(c)) continue;
    if (userOwnedIds.has(c.id)) continue;
    const slot = projectToMatcherSlot(c);
    if (slot) slots.push(slot);
  }

  const candidates = gatherCandidateTransactions(slots);
  const autoRows = matchManualObligationsToTransactions(slots, candidates, today);

  // Only touch the file when something actually changes — avoids noisy
  // mtime churn during boot when nothing differs.
  const existingAutoIds = new Set<string>();
  for (const row of existingState.values()) {
    if (row.source === 'auto') existingAutoIds.add(row.id);
  }
  const nextAutoIds = new Set(autoRows.map(r => r.id));
  const autoChanged = existingAutoIds.size !== nextAutoIds.size
    || [...existingAutoIds].some(id => !nextAutoIds.has(id))
    || autoRows.some(r => {
      const prior = existingState.get(r.id);
      return !prior || !rowsEqual(prior, r);
    });

  if (!autoChanged) return;

  writeObligationStateToFile(stateCsvPath, [...userRows, ...autoRows]);

  if (autoRows.length > 0) {
    console.log(`[Database] Derived ${autoRows.length} auto obligation state row(s) from transaction data`);
  }
}

function rowsEqual(a: ObligationStateRow, b: ObligationStateRow): boolean {
  return a.id === b.id
    && a.status === b.status
    && a.paidAmount === b.paidAmount
    && a.paidDate === b.paidDate
    && a.paidFromAccount === b.paidFromAccount
    && a.paidFromTxHash === b.paidFromTxHash
    && a.source === b.source;
}

/**
 * Fetch the union of candidate transactions for every slot in one
 * query per slot (slots are few — current data: 3 rows). Each slot
 * pulls only its own window + account + merchant-pattern, so the
 * aggregate cost stays tiny and the pure matcher sees a pre-filtered
 * pool (reduces work + avoids false positives from unrelated
 * merchants).
 */
function gatherCandidateTransactions(slots: readonly MatcherSlot[]): ExpenseTransactionMatch[] {
  if (slots.length === 0) return [];
  const byHash = new Map<string, ExpenseTransactionMatch>();
  for (const slot of slots) {
    const startDate = shiftIsoDate(slot.dueDate, -MATCH_PROXIMITY_DAYS);
    const endDate = shiftIsoDate(slot.dueDate, MATCH_PROXIMITY_DAYS);
    const accounts = slot.account !== null ? [slot.account] : undefined;
    const rows = findExpenseTransactionsByDescriptionPatterns({
      patterns: [`%${slot.merchant}%`],
      accounts,
      startDate,
      endDate,
    });
    for (const r of rows) {
      // Same (date, account, amount, description) can't meaningfully be
      // two different transactions; de-dupe to keep the candidate pool
      // tight when two slots pull the same merchant on the same account.
      const hash = `${r.date}|${r.account}|${r.amount}|${r.description}`;
      if (!byHash.has(hash)) byHash.set(hash, r);
    }
  }
  return [...byHash.values()];
}
