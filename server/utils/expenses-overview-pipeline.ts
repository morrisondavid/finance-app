/**
 * Shared pipeline helpers:
 * - buildExpensePipelineForAccount: single-account expense pipeline (used by /ad-hoc, /recurring, nudges)
 * - runExpensesOverviewPipeline: all-accounts rolling-window pipeline (used by /overview)
 */

import type { RecurringExpense } from '../../shared/api-contracts.js';
import { ACCOUNTS } from '../types.js';
import type { AccountName } from '../types.js';
import { getFixedExpenseSimulationExclusions } from '../db/repositories/fixed-expense-simulation-exclusions.js';
import { getTransactions } from '../db/repositories/transactions.js';
import { detectPassThrough } from './pass-through-detector.js';
import { recurringLineKey } from './expenses-pipeline-to-sheet.js';
import { buildRecurringPipeline, type PipelineResult, type RawTransaction } from './recurring-pipeline.js';
import { ROLLING_MONTHS, rollingCutoffIsoDate } from './math.js';

export interface ExpensePipelineOptions {
  /** Keep simulation-excluded recurring rows. Default false — projections hide them. */
  includeSimulationExcluded?: boolean;
}

/** Drop recurring rows whose lineKey is in the persisted Fixed Expenses exclusion set. */
export function applySimulationExclusionsToPipeline(pipeline: PipelineResult): PipelineResult {
  const excluded = new Set(getFixedExpenseSimulationExclusions());
  if (excluded.size === 0) return pipeline;
  const keep = (direction: 'expense' | 'income', frequency: 'monthly' | 'annual') =>
    (e: RecurringExpense): boolean => !excluded.has(recurringLineKey(direction, frequency, e));
  return {
    ...pipeline,
    monthlyExpenseRecurring: pipeline.monthlyExpenseRecurring.filter(keep('expense', 'monthly')),
    annualExpenseRecurring: pipeline.annualExpenseRecurring.filter(keep('expense', 'annual')),
    monthlyIncomeRecurring: pipeline.monthlyIncomeRecurring.filter(keep('income', 'monthly')),
    annualIncomeRecurring: pipeline.annualIncomeRecurring.filter(keep('income', 'annual')),
  };
}

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
  options: ExpensePipelineOptions = {},
): PipelineResult {
  const scopedRows = getTransactions({
    account,
    financialYear: financialYear ?? undefined,
  });
  const allTimeRows = getTransactions({ account });
  const pipeline = buildRecurringPipeline({
    scopedTransactions: scopedRows.map(transactionRowToRaw),
    allTimeTransactions: allTimeRows.map(transactionRowToRaw),
    includeIncome: false,
    accountScope: [account],
  });
  return options.includeSimulationExcluded ? pipeline : applySimulationExclusionsToPipeline(pipeline);
}

export function runExpensesOverviewPipeline(
  options: ExpensePipelineOptions = {},
): PipelineResult {
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
  const pipeline = buildRecurringPipeline({
    scopedTransactions,
    allTimeTransactions,
    passThroughIds,
    includeIncome: true,
  });
  return options.includeSimulationExcluded ? pipeline : applySimulationExclusionsToPipeline(pipeline);
}
