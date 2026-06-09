/**
 * Canonical definition of an "ad-hoc discretionary expense": a debit that is
 * NOT a registered debt repayment, NOT already surfaced as a fixed recurring
 * expense, and whose category is budgetable. The single source of truth shared
 * by budget nudges and the discretionary-spend warnings.
 */

import { CATEGORY_CONFIG } from './categorizer.js';
import type { CategoryName } from './categorizer.js';
import type { PipelineResult, RawTransaction } from './recurring-pipeline.js';
import {
  accumulationFromTxn,
  classifyTransactionSide,
  recurringKey,
} from './recurring-pipeline.js';
import { transactionMatchesAnyActiveDebt } from '../domain/debts/match-transaction.js';
import type { Debt } from '../db/repositories/debts.js';

/** Recurring accumulator keys already surfaced as monthly/annual fixed expenses (all accounts). */
export function buildRecurringExpenseKeySet(pipeline: PipelineResult): Set<string> {
  const keys = new Set<string>();
  for (const e of pipeline.monthlyExpenseRecurring) keys.add(recurringKey(e));
  for (const e of pipeline.annualExpenseRecurring) keys.add(recurringKey(e));
  return keys;
}

export interface AdHocExpense {
  readonly category: CategoryName;
  readonly displayMerchant: string;
  readonly absAmount: number;
}

export interface ClassifyAdHocExpenseDeps {
  readonly recurringKeys: ReadonlySet<string>;
  readonly activeDebts?: readonly Debt[];
}

/**
 * Returns the category/merchant/amount to aggregate, or null when the txn is
 * not ad-hoc discretionary spend. The "unbudgeted" filter is deliberately NOT
 * applied here — callers scope it differently (budget nudges by a merchant's
 * dominant category; spend warnings by the category itself).
 */
export function classifyAdHocExpense(
  txn: RawTransaction,
  deps: ClassifyAdHocExpenseDeps,
): AdHocExpense | null {
  if (classifyTransactionSide(txn) !== 'expense') return null;
  if (
    deps.activeDebts !== undefined &&
    deps.activeDebts.length > 0 &&
    transactionMatchesAnyActiveDebt(txn, deps.activeDebts)
  ) {
    return null;
  }
  const acc = accumulationFromTxn(txn, 'expense');
  if (acc === null) return null;
  if (deps.recurringKeys.has(acc.key)) return null;
  if (!CATEGORY_CONFIG[acc.category].budgetable) return null;
  return { category: acc.category, displayMerchant: acc.displayMerchant, absAmount: Math.abs(txn.amount) };
}
