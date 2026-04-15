/**
 * Shared “load all accounts → rolling window → pass-through → recurring pipeline”
 * used by GET /api/expenses/overview and GET /api/expenses/ad-hoc.
 */

import { ACCOUNTS } from '../types.js';
import { getTransactions } from '../db/repositories/transactions.js';
import { detectPassThrough } from './pass-through-detector.js';
import { buildRecurringPipeline, type RawTransaction } from './recurring-pipeline.js';
import { ROLLING_MONTHS, rollingCutoffIsoDate } from './math.js';

export function runExpensesOverviewPipeline(): ReturnType<typeof buildRecurringPipeline> {
  const cutoff = rollingCutoffIsoDate(ROLLING_MONTHS);
  const scopedTransactions: RawTransaction[] = [];
  const allTimeTransactions: RawTransaction[] = [];

  for (const account of ACCOUNTS) {
    const txns = getTransactions({ account });
    for (const t of txns) {
      const row: RawTransaction = {
        id: t.id,
        date: t.date,
        description: t.description,
        amount: t.amount,
        account: t.account,
        type: t.type,
      };
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
