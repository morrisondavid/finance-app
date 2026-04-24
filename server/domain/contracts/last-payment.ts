/**
 * Last-invoice-payment lookup — pure helpers that answer
 * "when did the last invoice payment for this contract land in the
 * business account?" without touching the DB.
 *
 * Consumed by the accrual pipeline to rebase `worked_days_to_date`,
 * `leave_days_in_period`, and `accrued_to_date` onto a cash-flow-aware
 * window ("since last payment") instead of the calendar month. The
 * projection window that feeds the Retained / VAT / CT banner still
 * uses the calendar month — this module is ONLY about the owed window.
 *
 * The matcher is deliberately minimal. We don't have an invoices ledger
 * yet; the long-term fix is to record invoice-issued events as they
 * happen and read back their settlement dates from there. Until then,
 * the heuristic is:
 *
 *   1. Normalise both the client's trading/legal names and the
 *      transaction narrative, then look for a substring hit. For agency
 *      contracts the "client" here IS the agency that pays (e.g. La
 *      Fosse) — the end-client field on the Client row is purely
 *      descriptive and doesn't appear on statements.
 *   2. If the narrative match misses and the caller has opted in via
 *      `enableAmountFallback`, accept any income row whose amount sits
 *      within ±5% of `day_rate * N` for a small plausible range of
 *      billable days. This fallback is OFF by default because a false
 *      positive silently shortens the owed window and hides real money
 *      from the user — we'd rather return `null` and fall back to the
 *      month-start than lie.
 *
 * `resolveAccrualWindowStart` is the single source of truth for "when
 * does the owed window start?" and is re-used by the route layer and
 * by future consumers (invoicing reminders, payment-received
 * notifications) so the fallback policy stays consistent.
 */

import type {
  Client,
  Contract,
  Transaction,
} from '../../../shared/api-contracts.js';
import { monthRange, shiftIsoDate } from '../../../shared/iso-date.js';
import {
  buildNarrativeTokens,
  narrativeMatches,
} from '../clients/narrative-match.js';

export interface FindLastPaymentInput {
  readonly contract: Contract;
  /**
   * The row from `clients.csv` referenced by `contract.client_id`. For
   * agency contracts this IS the payer (e.g. La Fosse); the
   * `end_client_*` block on this row is the delivery location and is
   * NOT used for matching because end-client names never appear on
   * bank statements.
   */
  readonly client: Client;
  /**
   * Pre-filtered to the issuing entity's accounts with
   * `type === 'income'`. The matcher iterates this list newest-first
   * and returns the first hit, so callers should not pre-sort it in
   * any particular direction — sorting is handled here.
   */
  readonly incomeTransactions: readonly Transaction[];
  /** ISO `YYYY-MM-DD`. Used only as an upper bound on match dates. */
  readonly today: string;
  /**
   * Enables the amount-tolerance fallback when no narrative match is
   * found. Default `false`. The Invoicing shipment will swap this out
   * for a real invoice ledger; this flag exists so the fallback can
   * be flipped on in specific tests without becoming the default.
   */
  readonly enableAmountFallback?: boolean;
}

/**
 * Candidate day counts for the amount-tolerance fallback. Covers a
 * monthly invoice spanning 15-23 working days and a weekly invoice
 * spanning 4-6 working days. Intentionally inclusive on both ends —
 * a lopsided month with a bank holiday can legitimately invoice 15
 * days at the short end.
 */
const FALLBACK_DAY_COUNTS: readonly number[] = [4, 5, 6, 15, 16, 17, 18, 19, 20, 21, 22, 23];
const FALLBACK_AMOUNT_TOLERANCE = 0.05;

function amountMatchesDayRate(
  amount: number,
  dayRate: number,
): boolean {
  if (dayRate <= 0) return false;
  const absAmount = Math.abs(amount);
  for (const n of FALLBACK_DAY_COUNTS) {
    const expected = dayRate * n;
    const tolerance = expected * FALLBACK_AMOUNT_TOLERANCE;
    if (Math.abs(absAmount - expected) <= tolerance) return true;
  }
  return false;
}

/**
 * Return the date of the most recent invoice payment for `contract`,
 * or `null` if nothing matches. Scans `incomeTransactions` newest-first
 * and returns on the first hit — callers never need to look past the
 * first match because an older payment would always be superseded by
 * a newer one for the same counterparty.
 */
export function findLastInvoicePaymentDate(
  input: FindLastPaymentInput,
): string | null {
  const { contract, client, incomeTransactions, today, enableAmountFallback = false } = input;
  if (incomeTransactions.length === 0) return null;

  const tokens = buildNarrativeTokens(client);

  // Newest-first sort so we return on the first match. Copy the array
  // so we don't mutate the caller's input.
  const sorted = [...incomeTransactions]
    .filter(tx => tx.type === 'income' && tx.date <= today)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  // Pass 1: narrative match (authoritative).
  for (const tx of sorted) {
    if (narrativeMatches(tx.description, tokens)) return tx.date;
  }

  // Pass 2: amount-tolerance fallback, opt-in only.
  if (enableAmountFallback) {
    for (const tx of sorted) {
      if (amountMatchesDayRate(tx.amount, contract.day_rate)) return tx.date;
    }
  }

  return null;
}

/**
 * Canonical start of the "owed since last payment" window.
 *
 * - When a payment date is known, the window starts the day AFTER the
 *   payment (the paid day is already settled).
 * - When no payment is known — new contracts, new entities, or just
 *   contracts whose invoices haven't been paid yet — the window falls
 *   back to the first of the current calendar month. The fallback
 *   deliberately doesn't reach back further: without a payment
 *   anchor, "since last payment" is indistinguishable from the
 *   calendar forecast the banner already shows, and reaching further
 *   back would silently inflate the accrued figure.
 * - Always clamped to `contract.start_date` — a contract can't owe
 *   for work predating its own start.
 */
export function resolveAccrualWindowStart(opts: {
  readonly contract: Contract;
  readonly lastPaymentDate: string | null;
  readonly today: string;
}): string {
  const { contract, lastPaymentDate, today } = opts;
  const base = lastPaymentDate !== null
    ? shiftIsoDate(lastPaymentDate, 1)
    : monthRange(today).start;
  return base < contract.start_date ? contract.start_date : base;
}
