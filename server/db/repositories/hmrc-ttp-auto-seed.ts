/**
 * HMRC Time-To-Pay (TTP) auto-seeder.
 *
 * HMRC bills time-to-pay instalments, penalty direct debits and similar
 * recurring arrangements through the NDDS (National Direct Debit Service)
 * and ETMP gateways. From the ledger these look like a monthly debit of
 * the same amount hitting the same account — exactly what the existing
 * recurring-expense pipeline already surfaces.
 *
 * Rather than re-implement cadence detection, this seeder sits on top of
 * {@link runExpensesOverviewPipeline} (shared with the /overview endpoint)
 * and filters its `monthlyExpenseRecurring` output down to HMRC-narrative
 * groups. Every historical debit attached to a qualifying accumulator is
 * emitted as a `paid` obligation (one per instalment — ids carry the
 * transaction date so they're idempotent across reseeds), and one
 * `not-yet-due` obligation is emitted for the next predicted cycle so
 * the upcoming instalment shows on the Obligations page.
 *
 * This design keeps two invariants:
 * 1. The orphan HMRC feed automatically drops every instalment that is
 *    now represented by an obligation (the existing NOT EXISTS clause in
 *    `findUnmatchedHmrcPayments` matches on
 *    `(paid_date, paid_amount, paid_from_account)`).
 * 2. No new cadence logic — the seeder imports `predictNextChargeDate`
 *    and `resolveLastChargeDate` verbatim from the recurring pipeline.
 */

import { getDb } from '../connection.js';
import { runExpensesOverviewPipeline } from '../../utils/expenses-overview-pipeline.js';
import {
  predictNextChargeDate,
  resolveLastChargeDate,
} from '../../utils/recurring-upcoming.js';
import { recurringKey, type Accumulator } from '../../utils/recurring-pipeline.js';
import type { RecurringExpense } from '../../../shared/api-contracts.js';
import { insertAutoObligation } from './obligations.js';
import { isDismissed } from './obligation-dismissals.js';
import { round2 } from '../../utils/math.js';

/**
 * Merchant display name produced by {@link normalizeMerchant} for any
 * description containing the HMRC token. All TTP / NDDS / ETMP / SA / VAT
 * narratives collapse to this single value so we can filter the recurring
 * pipeline with a straight equality check.
 */
const HMRC_MERCHANT = 'HMRC';

/**
 * Stable identifier for an HMRC TTP obligation row. The account + bucketed
 * amount pair uniquely identifies the recurring group (two installment
 * plans on different accounts, or different amounts, don't collide), and
 * the date identifies the specific instalment within that group.
 */
function ttpObligationId(expense: RecurringExpense, dateIso: string): string {
  const amountBucket = Math.round(expense.amount * 100);
  const accountSlug = slugifyAccount(expense.sourceAccount);
  return `auto-ttp-${accountSlug}-${amountBucket}-${dateIso}`;
}

function slugifyAccount(account: string): string {
  return account.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Friendly name that surfaces the arrangement clearly on the Obligations
 * page. Example: "HMRC payment plan — £643.69 / mo (barclays-current)".
 */
function ttpObligationName(expense: RecurringExpense): string {
  const amount = expense.amount.toFixed(2);
  return `HMRC payment plan — £${amount} / mo (${expense.sourceAccount})`;
}

/**
 * Derive and insert auto HMRC Time-To-Pay obligations. Idempotent — all
 * prior `source='auto' AND type='hmrc-ttp'` rows are removed first.
 *
 * One row is inserted per historical instalment already attached to the
 * detected recurring accumulator (status=`paid`, paid_* populated), plus
 * a single forward-looking row for the next predicted cycle
 * (status=`not-yet-due`).
 *
 * Dismissal is per-row: dismissing an upcoming row suppresses only that
 * specific predicted date. Historical paid rows are idempotent and
 * re-emit on every run from the ledger — they exist primarily so the
 * orphan feed's NOT EXISTS clause strikes the corresponding bank debits.
 */
export function deriveAndInsertAutoTtpObligations(referenceDate: Date = new Date()): void {
  const db = getDb();
  db.prepare("DELETE FROM financial_obligations WHERE source = 'auto' AND type = 'hmrc-ttp'").run();

  const pipeline = runExpensesOverviewPipeline();
  const hmrcRecurring = pipeline.monthlyExpenseRecurring.filter(
    e => e.merchant === HMRC_MERCHANT,
  );
  if (hmrcRecurring.length === 0) return;

  let inserted = 0;

  for (const expense of hmrcRecurring) {
    const acc = pipeline.expenseAccumulators.get(recurringKey(expense));
    if (!acc) continue;

    inserted += emitHistoricalInstalments(expense, acc);
    inserted += emitUpcomingInstalment(expense, acc, referenceDate);
  }

  if (inserted > 0) {
    console.log(`[Database] Derived ${inserted} auto HMRC payment-plan obligation(s)`);
  }
}

/**
 * One `paid` obligation per transaction attached to the HMRC recurring
 * accumulator. The date-scoped id keeps this idempotent across reseeds —
 * rebuilding the DB from a clean ledger produces the exact same row set.
 */
function emitHistoricalInstalments(
  expense: RecurringExpense,
  acc: Accumulator,
): number {
  let inserted = 0;
  const seenIds = new Set<string>();

  for (const txn of acc.transactions) {
    const id = ttpObligationId(expense, txn.date);
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    if (isDismissed(id)) continue;

    insertAutoObligation({
      id,
      type: 'hmrc-ttp',
      name: ttpObligationName(expense),
      entity: 'HMRC',
      recurrence: 'monthly',
      expectedAmount: expense.amount,
      dueDate: txn.date,
      status: 'paid',
      paidAmount: round2(txn.amount),
      paidDate: txn.date,
      paidFromAccount: acc.sourceAccount,
      notes: 'Detected HMRC direct-debit installment (NDDS / ETMP / payment plan).',
    });
    inserted++;
  }

  return inserted;
}

/**
 * One `not-yet-due` obligation for the next predicted cycle so the user
 * sees the upcoming direct debit before it hits. Uses the recurring-
 * pipeline helpers verbatim so prediction stays in one place.
 *
 * Returns 0 when the next-due cannot be predicted (missing billing day,
 * or the accumulator has no attached transactions yet). Also 0 when the
 * predicted id has been dismissed by the user.
 */
function emitUpcomingInstalment(
  expense: RecurringExpense,
  acc: Accumulator,
  referenceDate: Date,
): number {
  const lastCharge = resolveLastChargeDate(expense, new Map([[recurringKey(expense), acc]]));

  // `predictNextChargeDate` returns null when `lastCharge` already falls
  // inside the current calendar month (i.e. "already paid this period").
  // For TTP we want the NEXT cycle regardless, so in that case we advance
  // the reference date past the current cycle and ask again with no
  // last-charge context.
  let nextDue = predictNextChargeDate(
    'monthly',
    expense.billingDayOfMonth,
    null,
    referenceDate,
    lastCharge,
  );
  if (nextDue === null) {
    const advanced = new Date(referenceDate.getTime());
    advanced.setUTCMonth(advanced.getUTCMonth() + 1);
    nextDue = predictNextChargeDate(
      'monthly',
      expense.billingDayOfMonth,
      null,
      advanced,
      null,
    );
  }
  if (nextDue === null) return 0;

  const id = ttpObligationId(expense, nextDue);
  if (isDismissed(id)) return 0;

  // Guard: never double-emit an upcoming row that already exists as a
  // historical `paid` row (can only happen when a payment lands on the
  // predicted date in the same pipeline run — defensive).
  const db = getDb();
  const existing = db.prepare(
    'SELECT 1 AS hit FROM financial_obligations WHERE id = ?',
  ).get(id) as { hit: number } | undefined;
  if (existing) return 0;

  insertAutoObligation({
    id,
    type: 'hmrc-ttp',
    name: ttpObligationName(expense),
    entity: 'HMRC',
    recurrence: 'monthly',
    expectedAmount: expense.amount,
    dueDate: nextDue,
    status: 'not-yet-due',
    paidAmount: null,
    paidDate: null,
    paidFromAccount: null,
    notes: 'Predicted next installment of an active HMRC direct-debit arrangement.',
  });
  return 1;
}
