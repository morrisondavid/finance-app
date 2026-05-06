/**
 * Pure helpers that turn detected recurring expenses into upcoming-charge
 * predictions for the Obligations page.
 *
 * Kept free of SQL / IO so they can be unit-tested without a database; the
 * route is a thin wrapper that calls `runExpensesOverviewPipeline` and
 * passes the result through `buildUpcomingRecurring`.
 */

import type { RecurringExpense, UpcomingRecurring } from '../../shared/api-contracts.js';
import type { PipelineResult, Accumulator } from './recurring-pipeline.js';
import { recurringKey } from './recurring-pipeline.js';
import { toIsoDate } from '../../shared/iso-date.js';

/**
 * ISO date (YYYY-MM-DD) for the next calendar day matching `billingDayOfMonth`
 * (and, for annual items, `billingMonth` — 1-indexed) that is strictly after
 * `today`. Returns `null` when the item is considered already paid this period:
 *   - monthly: `lastChargeDate` falls in the current calendar month.
 *   - annual: `lastChargeDate` falls within the preceding 365 days.
 *
 * If required fields are missing (e.g. billingDayOfMonth null for a monthly
 * item, or billingMonth null for an annual item) the function returns `null`.
 */
export function predictNextChargeDate(
  frequency: 'monthly' | 'annual',
  billingDayOfMonth: number | null,
  billingMonth: number | null,
  today: Date,
  lastChargeDate: string | null,
): string | null {
  if (billingDayOfMonth === null) return null;

  if (frequency === 'monthly') {
    if (lastChargeDate && isInSameCalendarMonth(lastChargeDate, today)) {
      return null;
    }
    const candidate = buildDate(today.getUTCFullYear(), today.getUTCMonth(), billingDayOfMonth);
    if (candidate > today) return toIsoDate(candidate);
    const next = buildDate(today.getUTCFullYear(), today.getUTCMonth() + 1, billingDayOfMonth);
    return toIsoDate(next);
  }

  // annual
  if (billingMonth === null) return null;
  if (lastChargeDate && daysBetween(lastChargeDate, today) < 365) {
    return null;
  }
  const monthIndex = billingMonth - 1;
  const thisYearCandidate = buildDate(today.getUTCFullYear(), monthIndex, billingDayOfMonth);
  if (thisYearCandidate > today) return toIsoDate(thisYearCandidate);
  const nextYearCandidate = buildDate(today.getUTCFullYear() + 1, monthIndex, billingDayOfMonth);
  return toIsoDate(nextYearCandidate);
}

/**
 * Given a detected recurring expense and the accumulator map that produced it,
 * return the most recent transaction date attached to that accumulator (if any).
 * Uses the same `recurringKey` used by the detector — no extra SQL.
 */
export function resolveLastChargeDate(
  expense: RecurringExpense,
  accumulators: Map<string, Accumulator>,
): string | null {
  const acc = accumulators.get(recurringKey(expense));
  if (!acc || acc.transactions.length === 0) return null;
  return acc.transactions.reduce(
    (max, t) => (t.date > max ? t.date : max),
    acc.transactions[0].date,
  );
}

export interface UpcomingRecurringBuckets {
  thisMonth: UpcomingRecurring[];
  thisYear: UpcomingRecurring[];
}

/**
 * Turn a full expense pipeline result into upcoming-recurring buckets:
 *   - `thisMonth`: monthly + annual items whose predicted date is in the
 *      current calendar month.
 *   - `thisYear`: annual items predicted within the next 365 days.
 * Items that predict `null` (already paid this period) are skipped entirely.
 * Both buckets are sorted ascending by `nextExpectedDate`.
 */
export function buildUpcomingRecurring(
  pipeline: PipelineResult,
  today: Date,
): UpcomingRecurringBuckets {
  const thisMonth: UpcomingRecurring[] = [];
  const thisYear: UpcomingRecurring[] = [];

  const in365Days = addDays(today, 365);
  const monthStart = buildDate(today.getUTCFullYear(), today.getUTCMonth(), 1);
  const monthEnd = buildDate(today.getUTCFullYear(), today.getUTCMonth() + 1, 0);

  const pushItem = (
    expense: RecurringExpense,
    frequency: 'monthly' | 'annual',
  ) => {
    const lastChargeDate = resolveLastChargeDate(expense, pipeline.expenseAccumulators);
    const nextExpectedDate = predictNextChargeDate(
      frequency,
      expense.billingDayOfMonth,
      expense.billingMonth,
      today,
      lastChargeDate,
    );
    if (!nextExpectedDate) return;

    const item: UpcomingRecurring = {
      merchant: expense.merchant,
      category: expense.category,
      colour: expense.colour,
      logoUrl: expense.logoUrl,
      amount: expense.amount,
      frequency,
      sourceAccount: expense.sourceAccount,
      nextExpectedDate,
      lastChargeDate,
    };
    if (expense.declaredObligationId !== undefined) {
      item.declaredObligationId = expense.declaredObligationId;
    }

    const next = parseIsoDate(nextExpectedDate);
    if (next >= monthStart && next <= monthEnd) {
      thisMonth.push(item);
    }
    if (frequency === 'annual' && next <= in365Days && next >= today) {
      thisYear.push(item);
    }
  };

  for (const e of pipeline.monthlyExpenseRecurring) pushItem(e, 'monthly');
  for (const e of pipeline.annualExpenseRecurring) pushItem(e, 'annual');

  thisMonth.sort((a, b) => a.nextExpectedDate.localeCompare(b.nextExpectedDate));
  thisYear.sort((a, b) => a.nextExpectedDate.localeCompare(b.nextExpectedDate));

  return { thisMonth, thisYear };
}

/**
 * Upcoming charge buckets for **detected income** (rental, transfers in, etc.),
 * parallel to {@link buildUpcomingRecurring} for expenses. Scenario runway uses
 * this so sandbox income toggles map to real forecast inflows.
 */
export function buildUpcomingIncomeRecurring(
  pipeline: PipelineResult,
  today: Date,
): UpcomingRecurringBuckets {
  const thisMonth: UpcomingRecurring[] = [];
  const thisYear: UpcomingRecurring[] = [];

  const in365Days = addDays(today, 365);
  const monthStart = buildDate(today.getUTCFullYear(), today.getUTCMonth(), 1);
  const monthEnd = buildDate(today.getUTCFullYear(), today.getUTCMonth() + 1, 0);

  const pushItem = (expense: RecurringExpense, frequency: 'monthly' | 'annual') => {
    const lastChargeDate = resolveLastChargeDate(expense, pipeline.incomeAccumulators);
    const nextExpectedDate = predictNextChargeDate(
      frequency,
      expense.billingDayOfMonth,
      expense.billingMonth,
      today,
      lastChargeDate,
    );
    if (!nextExpectedDate) return;

    const item: UpcomingRecurring = {
      merchant: expense.merchant,
      category: expense.category,
      colour: expense.colour,
      logoUrl: expense.logoUrl,
      amount: expense.amount,
      frequency,
      sourceAccount: expense.sourceAccount,
      nextExpectedDate,
      lastChargeDate,
    };
    if (expense.declaredObligationId !== undefined) {
      item.declaredObligationId = expense.declaredObligationId;
    }

    const next = parseIsoDate(nextExpectedDate);
    if (next >= monthStart && next <= monthEnd) {
      thisMonth.push(item);
    }
    if (frequency === 'annual' && next <= in365Days && next >= today) {
      thisYear.push(item);
    }
  };

  for (const e of pipeline.monthlyIncomeRecurring) pushItem(e, 'monthly');
  for (const e of pipeline.annualIncomeRecurring) pushItem(e, 'annual');

  thisMonth.sort((a, b) => a.nextExpectedDate.localeCompare(b.nextExpectedDate));
  thisYear.sort((a, b) => a.nextExpectedDate.localeCompare(b.nextExpectedDate));

  return { thisMonth, thisYear };
}

// ---------- date helpers (UTC-based, calendar semantics) ----------

function buildDate(year: number, monthIndex: number, day: number): Date {
  return new Date(Date.UTC(year, monthIndex, day));
}

function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function isInSameCalendarMonth(iso: string, reference: Date): boolean {
  const d = parseIsoDate(iso);
  return d.getUTCFullYear() === reference.getUTCFullYear()
    && d.getUTCMonth() === reference.getUTCMonth();
}

function daysBetween(iso: string, reference: Date): number {
  const d = parseIsoDate(iso);
  const diffMs = reference.getTime() - d.getTime();
  return Math.floor(diffMs / (24 * 60 * 60 * 1000));
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d.getTime());
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}
