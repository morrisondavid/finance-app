/**
 * Pure budget nudge computation: identifies high-spend merchants that are not
 * fixed recurring expenses and don't already have a budget for their dominant
 * category. No DB, no Express — fully testable and reusable.
 */

import { CATEGORY_CONFIG } from './categorizer.js';
import type { CategoryName } from './categorizer.js';
import type { RawTransaction, PipelineResult } from './recurring-pipeline.js';
import { accumulationFromTxn, classifyTransactionSide, recurringKey } from './recurring-pipeline.js';
import { round2 } from './math.js';
import { getMerchantLogoUrl } from './merchant-logos.js';

export interface BudgetNudgeRow {
  merchant: string;
  suggestedCategory: CategoryName;
  totalSpend: number;
  transactionCount: number;
  lastDate: string;
  logoUrl: string | null;
}

export interface BudgetNudgesInput {
  expenseTransactions: readonly RawTransaction[];
  pipeline: PipelineResult;
  budgetedCategories: ReadonlySet<string>;
  options?: {
    minTotal?: number;
    maxRows?: number;
  };
}

const DEFAULT_MIN_TOTAL = 50;
const DEFAULT_MAX_ROWS = 6;

interface MerchantBucket {
  merchant: string;
  totalSpend: number;
  count: number;
  lastDate: string;
  categoryTotals: Map<CategoryName, number>;
}

export function computeBudgetNudges(input: BudgetNudgesInput): BudgetNudgeRow[] {
  const { expenseTransactions, pipeline, budgetedCategories, options } = input;
  const minTotal = options?.minTotal ?? DEFAULT_MIN_TOTAL;
  const maxRows = options?.maxRows ?? DEFAULT_MAX_ROWS;

  const recurringKeys = new Set<string>();
  for (const e of pipeline.monthlyExpenseRecurring) {
    recurringKeys.add(recurringKey(e));
  }
  for (const e of pipeline.annualExpenseRecurring) {
    recurringKeys.add(recurringKey(e));
  }

  const buckets = new Map<string, MerchantBucket>();

  for (const txn of expenseTransactions) {
    const side = classifyTransactionSide(txn);
    if (side !== 'expense') continue;

    const acc = accumulationFromTxn(txn, 'expense');
    if (!acc) continue;
    if (recurringKeys.has(acc.key)) continue;
    const catConfig = CATEGORY_CONFIG[acc.category];
    if (!catConfig || !catConfig.budgetable) continue;

    const absAmount = Math.abs(txn.amount);
    const merchant = acc.displayMerchant;

    let bucket = buckets.get(merchant);
    if (!bucket) {
      bucket = {
        merchant,
        totalSpend: 0,
        count: 0,
        lastDate: txn.date,
        categoryTotals: new Map(),
      };
      buckets.set(merchant, bucket);
    }

    bucket.totalSpend += absAmount;
    bucket.count += 1;
    if (txn.date > bucket.lastDate) bucket.lastDate = txn.date;
    bucket.categoryTotals.set(
      acc.category,
      (bucket.categoryTotals.get(acc.category) ?? 0) + absAmount,
    );
  }

  const rows: BudgetNudgeRow[] = [];

  for (const bucket of buckets.values()) {
    if (bucket.totalSpend < minTotal) continue;

    let dominantCategory: CategoryName | undefined;
    let dominantTotal = 0;
    for (const [cat, total] of bucket.categoryTotals) {
      if (total > dominantTotal) {
        dominantTotal = total;
        dominantCategory = cat;
      }
    }

    if (!dominantCategory) continue;
    if (budgetedCategories.has(dominantCategory)) continue;

    rows.push({
      merchant: bucket.merchant,
      suggestedCategory: dominantCategory,
      totalSpend: round2(bucket.totalSpend),
      transactionCount: bucket.count,
      lastDate: bucket.lastDate,
      logoUrl: getMerchantLogoUrl(bucket.merchant),
    });
  }

  rows.sort((a, b) => b.totalSpend - a.totalSpend);
  return rows.slice(0, maxRows);
}
