/**
 * Pure budget nudge computation: identifies high-spend merchants that are not
 * fixed recurring expenses and don't already have a budget for their dominant
 * category. No DB, no Express — fully testable and reusable.
 */

import type { CategoryName } from './categorizer.js';
import type { RawTransaction, PipelineResult } from './recurring-pipeline.js';
import { buildRecurringExpenseKeySet, classifyAdHocExpense } from './ad-hoc-spend-classifier.js';
import { expenseTxnMatchesMerchantModal } from './merchant-drill-search.js';
import { round2 } from './math.js';
import { getMerchantLogoUrl } from './merchant-logos.js';
import type { Debt } from '../db/repositories/debts.js';

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
  /** When set, expense debits that match an active debt are excluded (registered repayments). */
  activeDebts?: readonly Debt[];
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
  const { expenseTransactions, pipeline, budgetedCategories, activeDebts, options } = input;
  const minTotal = options?.minTotal ?? DEFAULT_MIN_TOTAL;
  const maxRows = options?.maxRows ?? DEFAULT_MAX_ROWS;

  const recurringKeys = buildRecurringExpenseKeySet(pipeline);

  const buckets = new Map<string, MerchantBucket>();

  for (const txn of expenseTransactions) {
    const adHoc = classifyAdHocExpense(txn, { recurringKeys, activeDebts });
    if (adHoc === null) continue;
    if (!expenseTxnMatchesMerchantModal(txn, adHoc.displayMerchant)) continue;

    let bucket = buckets.get(adHoc.displayMerchant);
    if (!bucket) {
      bucket = {
        merchant: adHoc.displayMerchant,
        totalSpend: 0,
        count: 0,
        lastDate: txn.date,
        categoryTotals: new Map(),
      };
      buckets.set(adHoc.displayMerchant, bucket);
    }

    bucket.totalSpend += adHoc.absAmount;
    bucket.count += 1;
    if (txn.date > bucket.lastDate) bucket.lastDate = txn.date;
    bucket.categoryTotals.set(
      adHoc.category,
      (bucket.categoryTotals.get(adHoc.category) ?? 0) + adHoc.absAmount,
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
