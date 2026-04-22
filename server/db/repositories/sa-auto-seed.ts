/**
 * Self Assessment auto-seeder.
 *
 * Surfaces upcoming SA deadlines on the Obligations page by writing auto
 * rows derived from {@link estimateSaForPerson} into `financial_obligations`.
 * The UI treats these as estimates; the moment the user adds a manual SA
 * obligation for the same person + deadline window, the auto row is
 * suppressed on the next seed run so nothing double-counts.
 *
 * Payment attribution: any `HMRC GOV.UK SA…` debit landing within
 * {@link SA_MATCH_PROXIMITY_DAYS} of a slot's due date is auto-attributed.
 * SA is personal tax so the search covers business + personal payment
 * accounts — restricting to business would silently orphan every personal-
 * account SA payment. Attribution never overrides a manual obligation.
 */

import { getDb } from '../connection.js';
import { saFilers, type PersonId } from '../../domain/people/index.js';
import {
  estimateSaForPerson,
  getSaTaxYearForDate,
  getSaTaxYearRange,
} from '../../utils/sa-estimator.js';
import { insertAutoObligation } from './obligations.js';
import { isDismissed } from './obligation-dismissals.js';
import { findHmrcPayments, type HmrcPaymentMatch } from './tax.js';
import { HMRC_PATTERNS } from '../../domain/payees/index.js';
import { businessAndPersonalPaymentAccounts } from '../../domain/accounts/index.js';
import { matchPaymentsToSlots } from '../../utils/payment-matcher.js';
import { round2 } from '../../utils/math.js';

/**
 * Self Assessment payment "slot". The UK SA calendar books two payments per
 * tax year for most filers — balancing payment + first payment on account on
 * 31 Jan, and a second payment on account on 31 Jul. We enumerate only
 * deadlines within a window around today so historic deadlines do not
 * clutter the registry.
 */
export interface SaSlot {
  personId: PersonId;
  /** Tax year the slot settles (UK: 6 Apr → 5 Apr). Stored as the start year. */
  taxYearStartYear: number;
  /** ISO due date. */
  dueDate: string;
  /** 'jan' = balancing + POA1, 'jul' = POA2. */
  kind: 'jan' | 'jul';
}

/**
 * Number of months before / after today to surface SA deadlines. Generous
 * enough to keep last January's deadline visible for a couple of months
 * (for late filers / tax-return reconciliation) while still teasing next
 * January into view a full 18 months ahead for forward planning.
 */
export const SA_WINDOW_PAST_MONTHS = 12;
export const SA_WINDOW_FUTURE_MONTHS = 18;

/**
 * Match window around a due date used to decide whether a manual
 * obligation should suppress an auto row. 31 days absorbs both the
 * "user pays a few days late" and "user enters the obligation with
 * rounded-to-month date" cases without bleeding into the next slot.
 */
export const MANUAL_SUPERSEDE_WINDOW_DAYS = 31;

/**
 * Proximity window (days either side of a slot due date) used when
 * attributing HMRC SA bank debits to SA slots. 60 days is half the
 * 6-month gap between the Jan and Jul deadlines, so the ranges never
 * overlap — a payment can belong to at most one slot. Generous enough
 * to absorb typical "paid a week early" / "paid a month late" patterns.
 */
export const SA_MATCH_PROXIMITY_DAYS = 60;

/** Stable matcher key for an SA slot. */
function saSlotKey(slot: { personId: PersonId; dueDate: string }): string {
  return `${slot.personId}-${slot.dueDate}`;
}

/**
 * Enumerate every SA slot (Jan + Jul) whose due date falls in the
 * configured window relative to {@link referenceDate}, for every person
 * flagged `filesSelfAssessment: true` in the people config.
 */
export function enumerateSaSlots(referenceDate: Date = new Date()): SaSlot[] {
  const windowStart = new Date(referenceDate);
  windowStart.setMonth(windowStart.getMonth() - SA_WINDOW_PAST_MONTHS);
  const windowEnd = new Date(referenceDate);
  windowEnd.setMonth(windowEnd.getMonth() + SA_WINDOW_FUTURE_MONTHS);

  const filers = saFilers();
  const slots: SaSlot[] = [];

  // Cover the tax years that can possibly emit a deadline within the window.
  const startTaxYear = getSaTaxYearForDate(windowStart) - 1;
  const endTaxYear = getSaTaxYearForDate(windowEnd) + 1;

  for (const filer of filers) {
    for (let ty = startTaxYear; ty <= endTaxYear; ty++) {
      // Jan slot: balancing payment + POA1 for tax year `ty` falls on 31 Jan of (ty+2).
      const janDue = `${ty + 2}-01-31`;
      if (withinWindow(janDue, windowStart, windowEnd)) {
        slots.push({ personId: filer.id, taxYearStartYear: ty, dueDate: janDue, kind: 'jan' });
      }
      // Jul slot: POA2 for tax year `ty` falls on 31 Jul of (ty+2).
      const julDue = `${ty + 2}-07-31`;
      if (withinWindow(julDue, windowStart, windowEnd)) {
        slots.push({ personId: filer.id, taxYearStartYear: ty, dueDate: julDue, kind: 'jul' });
      }
    }
  }

  slots.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  return slots;
}

function withinWindow(iso: string, start: Date, end: Date): boolean {
  const d = new Date(`${iso}T00:00:00`);
  return d >= start && d <= end;
}

/**
 * True if a manual SA obligation exists for this person + slot. Uses a
 * ± {@link MANUAL_SUPERSEDE_WINDOW_DAYS} window on due_date so
 * "user entered it with today's date" or "user entered the month's 1st"
 * still suppresses correctly. A manual row wins unconditionally.
 */
function hasManualSupersede(slot: SaSlot): boolean {
  const db = getDb();
  const windowStart = shiftIso(slot.dueDate, -MANUAL_SUPERSEDE_WINDOW_DAYS);
  const windowEnd = shiftIso(slot.dueDate, MANUAL_SUPERSEDE_WINDOW_DAYS);

  const row = db.prepare(`
    SELECT 1 AS hit FROM financial_obligations
    WHERE source = 'manual'
      AND type = 'self-assessment'
      AND person_id = ?
      AND due_date IS NOT NULL
      AND due_date >= ?
      AND due_date <= ?
    LIMIT 1
  `).get(slot.personId, windowStart, windowEnd) as { hit: number } | undefined;

  return row !== undefined;
}

function shiftIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Build the auto-obligation payload for a slot. POA2 is modelled as 50% of
 * the prior tax year's estimated tax — a deliberate simplification over HMRC's
 * "50% of last year's balancing payment" rule. Good enough as a peace-of-mind
 * figure; the user is expected to replace it with a manual entry once their
 * accountant sends through the real numbers.
 */
function buildSaObligationForSlot(slot: SaSlot): {
  id: string;
  expectedAmount: number;
  name: string;
  notes: string;
} {
  const db = getDb();
  const { start, end } = getSaTaxYearRange(slot.taxYearStartYear);
  const fullYearEstimate = estimateSaForPerson(slot.personId, start, end, db);

  const expectedAmount = slot.kind === 'jan'
    ? fullYearEstimate.estimatedTax
    : roundHalfUp2(fullYearEstimate.estimatedTax * 0.5);

  const taxYearLabel = `${slot.taxYearStartYear}/${String(slot.taxYearStartYear + 1).slice(-2)}`;
  const kindLabel = slot.kind === 'jan' ? 'Balancing + POA1' : 'POA2';
  const name = `Self Assessment — ${fullYearEstimate.displayName} (${slot.dueDate})`;

  return {
    id: `auto-sa-${slot.personId}-${slot.dueDate}`,
    expectedAmount,
    name,
    notes: `Estimate based on ${taxYearLabel} tax year (${kindLabel}). Add a manual obligation when you know the real figure.`,
  };
}

function roundHalfUp2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Pull every SA-narrative HMRC debit from the ledger, across both business
 * and personal payment accounts. SA is personal tax; limiting this to
 * business-only would silently orphan payments routed through the
 * director's own current account.
 *
 * Returned payments are the candidate pool the matcher pairs with SA slots.
 */
function fetchSaPayments(): HmrcPaymentMatch[] {
  return findHmrcPayments({
    patterns: HMRC_PATTERNS.SELF_ASSESSMENT,
    accounts: [...businessAndPersonalPaymentAccounts()],
    startDate: '0000-01-01',
    endDate: '9999-12-31',
  });
}

/**
 * Derive and insert auto Self Assessment obligations for every SA filer.
 * Runs after the VAT seed so its failure never blocks VAT visibility.
 *
 * Contract:
 * - One auto row per (personId, dueDate) slot.
 * - Zero-estimate slots are skipped — a £0 SA row is more noise than signal
 *   and clutters the overdue hero once the deadline passes.
 * - A manual SA obligation for the same person in a ± 31-day window
 *   suppresses the auto row entirely.
 * - Any `HMRC GOV.UK SA…` debit within ±{@link SA_MATCH_PROXIMITY_DAYS} of
 *   the slot's due date is auto-attributed to the slot (status becomes
 *   `paid`, paid_* fields populated). Matches are globally greedy: no
 *   payment can be attributed to two slots.
 */
export function deriveAndInsertAutoSaObligations(): void {
  const db = getDb();
  db.prepare("DELETE FROM financial_obligations WHERE source = 'auto' AND type = 'self-assessment'").run();

  const slots = enumerateSaSlots();
  if (slots.length === 0) return;

  const payments = fetchSaPayments();
  const paymentBySlot = matchPaymentsToSlots(
    slots.map(s => ({ key: saSlotKey(s), dueDate: s.dueDate })),
    payments,
    SA_MATCH_PROXIMITY_DAYS,
  );

  let inserted = 0;

  for (const slot of slots) {
    if (hasManualSupersede(slot)) continue;

    const payload = buildSaObligationForSlot(slot);
    if (payload.expectedAmount <= 0) continue;

    // User-level suppression: if this exact slot id is in the dismissals
    // table, skip it so the hidden reminder never rematerialises across
    // restarts or mid-session reseeds.
    if (isDismissed(payload.id)) continue;

    const match = paymentBySlot.get(saSlotKey(slot)) ?? null;

    insertAutoObligation({
      id: payload.id,
      type: 'self-assessment',
      name: payload.name,
      entity: 'HMRC',
      frequency: 'annual',
      expectedAmount: payload.expectedAmount,
      dueDate: slot.dueDate,
      status: match ? 'paid' : 'pending',
      paidAmount: match ? round2(Math.abs(match.amount)) : null,
      paidDate: match?.date ?? null,
      paidFromAccount: match?.account ?? null,
      notes: payload.notes,
      personId: slot.personId,
    });
    inserted++;
  }

  if (inserted > 0) {
    console.log(`[Database] Derived ${inserted} auto Self Assessment obligation(s)`);
  }
}
