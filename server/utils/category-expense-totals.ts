/**
 * Per-category expense totals for an account (and optional FY),
 * matching GET /api/dashboard/categories semantics.
 */

import type { AccountName } from '../types.js';
import { getTransactions } from '../db/repositories/transactions.js';
import { transactionCategoryWithPayroll } from '../config/payroll.js';
import type { CategoryName } from './categorizer.js';
import { SPECIAL_CATEGORY } from './category-constants.js';

function buildCategoryExpenseMap(
  account: AccountName,
  financialYear: string | undefined,
): Map<CategoryName, { total: number; count: number }> {
  const transactions = getTransactions({
    account,
    type: 'expense',
    ...(financialYear ? { financialYear } : {}),
  });

  const totals = new Map<CategoryName, { total: number; count: number }>();

  for (const t of transactions) {
    const category = transactionCategoryWithPayroll(
      t.description,
      t.amount,
      t.account,
      t.type,
    );
    if (category === SPECIAL_CATEGORY.transfers) continue;
    const entry = totals.get(category) ?? { total: 0, count: 0 };
    entry.total += Math.abs(t.amount);
    entry.count += 1;
    totals.set(category, entry);
  }

  return totals;
}

/**
 * Sum of ABS(amount) per category for expenses in scope (transfers excluded).
 */
export function getCategoryExpenseTotals(
  account: AccountName,
  financialYear: string | undefined,
): Map<CategoryName, number> {
  const map = buildCategoryExpenseMap(account, financialYear);
  const out = new Map<CategoryName, number>();
  for (const [k, v] of map) {
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
  return buildCategoryExpenseMap(account, financialYear);
}
