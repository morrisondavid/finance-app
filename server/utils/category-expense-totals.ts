/**
 * Per-category expense totals for an account (and optional FY),
 * matching GET /api/dashboard/categories semantics.
 *
 * FY totals and per-month buckets share one transaction pass so payroll
 * and transfer-exclusion rules cannot drift.
 */

import type { AccountName, TransactionType } from '../types.js';
import { getTransactions } from '../db/repositories/transactions.js';
import { transactionCategoryWithPayroll } from '../config/payroll.js';
import type { CategoryName } from './categorizer.js';
import { SPECIAL_CATEGORY } from './category-constants.js';
import { monthKeyFromIsoDate } from './math.js';

export interface CategoryExpenseTransaction {
  date: string;
  description: string;
  amount: number;
  account: string;
  type: TransactionType;
  /**
   * Stable transaction hash. Optional to stay backwards-compatible
   * with legacy callers; when present, the categoriser consults the
   * per-transaction override registry before pattern matching.
   */
  hash?: string;
}

export interface CategoryAggregation {
  breakdown: Map<CategoryName, { total: number; count: number }>;
  byMonth: Map<string, Map<CategoryName, number>>;
}

/**
 * Pure aggregation: group expense transactions by category, optionally bucketed per month.
 * No DB or I/O — fully testable and reusable from any caller that already has transactions loaded.
 */
export function aggregateCategoryExpenses(
  transactions: readonly CategoryExpenseTransaction[],
  includeByMonth: boolean,
): CategoryAggregation {
  const breakdown = new Map<CategoryName, { total: number; count: number }>();
  const byMonth = new Map<string, Map<CategoryName, number>>();

  for (const t of transactions) {
    const category = transactionCategoryWithPayroll(
      t.description,
      t.amount,
      t.account,
      t.type,
      t.hash,
    );
    if (category === SPECIAL_CATEGORY.transfers) continue;
    const amt = Math.abs(t.amount);
    const entry = breakdown.get(category) ?? { total: 0, count: 0 };
    entry.total += amt;
    entry.count += 1;
    breakdown.set(category, entry);

    if (includeByMonth) {
      const mk = monthKeyFromIsoDate(t.date);
      const monthMap = byMonth.get(mk) ?? new Map<CategoryName, number>();
      monthMap.set(category, (monthMap.get(category) ?? 0) + amt);
      byMonth.set(mk, monthMap);
    }
  }

  return { breakdown, byMonth };
}

function buildCategoryExpenseAggregation(
  account: AccountName,
  financialYear: string | undefined,
): CategoryAggregation {
  const transactions = getTransactions({
    account,
    type: 'expense',
    ...(financialYear ? { financialYear } : {}),
  });
  return aggregateCategoryExpenses(transactions, !!financialYear);
}

/**
 * Sum of ABS(amount) per category for expenses in scope (transfers excluded).
 */
export function getCategoryExpenseTotals(
  account: AccountName,
  financialYear: string | undefined,
): Map<CategoryName, number> {
  const { breakdown } = buildCategoryExpenseAggregation(account, financialYear);
  const out = new Map<CategoryName, number>();
  for (const [k, v] of breakdown) {
    out.set(k, v.total);
  }
  return out;
}

/**
 * Totals and transaction counts per category (for /api/dashboard/categories).
 */
export function getCategoryExpenseBreakdown(
  account: AccountName,
  financialYear: string | undefined,
): Map<CategoryName, { total: number; count: number }> {
  return buildCategoryExpenseAggregation(account, financialYear).breakdown;
}

export interface CategoryExpenseFyAndByMonth {
  fyTotals: Map<CategoryName, number>;
  byMonth: Map<string, Map<CategoryName, number>>;
}

/**
 * FY totals plus per-month spend per category in one pass (financial year required).
 */
export function getCategoryExpenseFyAndByMonth(
  account: AccountName,
  financialYear: string,
): CategoryExpenseFyAndByMonth {
  const { breakdown, byMonth } = buildCategoryExpenseAggregation(account, financialYear);
  const fyTotals = new Map<CategoryName, number>();
  for (const [k, v] of breakdown) {
    fyTotals.set(k, v.total);
  }
  return { fyTotals, byMonth };
}
