/**
 * Shared pipeline helpers:
 * - buildExpensePipelineForAccount: single-account expense pipeline (used by /ad-hoc, /recurring, nudges)
 * - runExpensesOverviewPipeline: all-accounts rolling-window pipeline (used by /overview)
 */

import { ACCOUNTS } from '../types.js';
import type { AccountName } from '../types.js';
import { getTransactions } from '../db/repositories/transactions.js';
import { detectPassThrough } from './pass-through-detector.js';
import { buildRecurringPipeline, type PipelineResult, type RawTransaction } from './recurring-pipeline.js';
import { ROLLING_MONTHS, rollingCutoffIsoDate } from './math.js';

export function transactionRowToRaw(t: { id: number; date: string; description: string; amount: number; account: string; type: 'income' | 'expense' | 'transfer' }): RawTransaction {
  return { id: t.id, date: t.date, description: t.description, amount: t.amount, account: t.account, type: t.type };
}

/**
 * Load scoped + all-time expense transactions for a single account and build
 * the recurring pipeline with `includeIncome: false`.
 * Consolidates the identical load-and-build pattern used by /ad-hoc, /recurring,
 * and the budget nudge endpoint.
 */
export function buildExpensePipelineForAccount(
  account: AccountName,
  financialYear?: string,
): PipelineResult {
  const scopedRows = getTransactions({
    account,
    financialYear: financialYear ?? undefined,
  });
  const allTimeRows = getTransactions({ account });
  return buildRecurringPipeline({
    scopedTransactions: scopedRows.map(transactionRowToRaw),
    allTimeTransactions: allTimeRows.map(transactionRowToRaw),
    includeIncome: false,
  });
}

export function runExpensesOverviewPipeline(): PipelineResult {
  const cutoff = rollingCutoffIsoDate(ROLLING_MONTHS);
  const scopedTransactions: RawTransaction[] = [];
  const allTimeTransactions: RawTransaction[] = [];

  for (const account of ACCOUNTS) {
    const txns = getTransactions({ account });
    for (const t of txns) {
      const row = transactionRowToRaw(t);
      allTimeTransactions.push(row);
      if (t.date >= cutoff) {
        scopedTransactions.push(row);
      }
    }
  }

  const { passThroughIds } = detectPassThrough(scopedTransactions);
  return buildRecurringPipeline({
    scopedTransactions,
    allTimeTransactions,
    passThroughIds,
    includeIncome: true,
  });
}
