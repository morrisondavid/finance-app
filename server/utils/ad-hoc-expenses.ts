/**
 * Ad hoc (non–fixed-recurring) expense groups vs the same pipeline as /overview.
 */

import type { AccountName } from '../types.js';
import { ROLLING_MONTHS } from './math.js';
import {
  accumulationFromTxn,
  recurringKey,
  type PipelineResult,
  type RawTransaction,
} from './recurring-pipeline.js';

export const AD_HOC_DEFAULT_MONTHS = 12;
export const AD_HOC_DEFAULT_MIN_TOTAL = 200;
export const AD_HOC_DEFAULT_LIMIT = 25;
export const AD_HOC_MAX_LIMIT = 100;

export interface AdHocExpenseRow {
  category: string;
  merchant: string;
  total: number;
  count: number;
  lastDate: string;
  sampleDescription: string;
}

export interface ComputeAdHocInput {
  pipeline: PipelineResult;
  account: AccountName;
  expenseTransactions: RawTransaction[];
  minTotal: number;
  limit: number;
}

/**
 * Expense txns should be type=expense for `account`, dates already filtered by caller.
 */
export function computeAdHocExpenseGroups(input: ComputeAdHocInput): AdHocExpenseRow[] {
  const { pipeline, account, expenseTransactions, minTotal, limit } = input;

  const surfaced = new Set<string>();
  for (const e of pipeline.monthlyExpenseRecurring) {
    if (e.sourceAccount === account) surfaced.add(recurringKey(e));
  }
  for (const e of pipeline.annualExpenseRecurring) {
    if (e.sourceAccount === account) surfaced.add(recurringKey(e));
  }

  interface AggRow {
    category: string;
    merchant: string;
    total: number;
    count: number;
    lastDate: string;
    sampleDescription: string;
  }

  const byKey = new Map<string, AggRow>();

  for (const txn of expenseTransactions) {
    const bucket = accumulationFromTxn(txn, 'expense');
    if (!bucket) continue;
    if (surfaced.has(bucket.key)) continue;

    const abs = Math.abs(txn.amount);
    const prev = byKey.get(bucket.key);
    if (prev) {
      prev.total += abs;
      prev.count += 1;
      if (txn.date > prev.lastDate) {
        prev.lastDate = txn.date;
        prev.sampleDescription = txn.description;
      }
    } else {
      byKey.set(bucket.key, {
        category: bucket.category,
        merchant: bucket.displayMerchant,
        total: abs,
        count: 1,
        lastDate: txn.date,
        sampleDescription: txn.description,
      });
    }
  }

  return Array.from(byKey.values())
    .filter(r => r.total >= minTotal)
    .sort((a, b) => {
      const byDate = b.lastDate.localeCompare(a.lastDate);
      if (byDate !== 0) return byDate;
      return b.total - a.total;
    })
    .slice(0, limit);
}

export function pipelineWindowMonths(): number {
  return ROLLING_MONTHS;
}
