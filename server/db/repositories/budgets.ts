/**
 * Category budgets: DB mirrors canonical CSV; use upsert/delete here so file and DB stay aligned.
 * One permanent monthly cap per (account, category); comparisons use the dashboard’s selected FY for spend only.
 */
import { getDb, BUDGETS_DIR } from '../connection.js';
import type { AccountName } from '../../types.js';
import { isValidAccountName } from '../../types.js';
import type { CategoryName } from '../../utils/categorizer.js';
import { CATEGORY_NAMES } from '../../utils/categorizer.js';
import { getCategoryExpenseFyAndByMonth } from '../../utils/category-expense-totals.js';
import {
  listFyMonthKeysThroughDate,
  formatFinancialYearMonthLabel,
} from '../utils/financial-year.js';
import {
  readBudgetsFromCsvFile,
  writeBudgetsToCsvFile,
  getBudgetCsvPath,
  ensureBudgetCsvWithHeader,
  type BudgetCsvRow,
} from '../budgets-csv.js';

export interface BudgetRow {
  id: number;
  account: AccountName;
  category: CategoryName;
  /** Permanent monthly cap. */
  amount: number;
}

export interface BudgetMonthComparison {
  monthKey: string;
  monthLabel: string;
  budget: number;
  spent: number;
  /** spent minus budget (negative = under budget). */
  difference: number;
}

export interface BudgetComparison {
  category: CategoryName;
  monthlyBudget: number;
  /** Elapsed FY months for the dashboard window (past FY = all 12; current FY through current month). */
  months: BudgetMonthComparison[];
}

function csvPath(): string {
  return getBudgetCsvPath(BUDGETS_DIR);
}

/**
 * Replace DB budgets from CSV (file is source of truth on startup).
 */
export function loadBudgetsFromFileIntoDb(): void {
  const db = getDb();
  ensureBudgetCsvWithHeader(csvPath());
  const rows = readBudgetsFromCsvFile(csvPath());
  db.prepare('DELETE FROM category_budgets').run();
  const insert = db.prepare(`
    INSERT INTO category_budgets (account, category, amount, updated_at)
    VALUES (?, ?, ?, datetime('now'))
  `);
  const run = db.transaction((list: BudgetCsvRow[]) => {
    for (const r of list) {
      insert.run(r.account, r.category, r.amount);
    }
  });
  run(rows);
  console.log(`[Database] Loaded ${rows.length} budget row(s) from CSV`);
}

/**
 * Export all DB rows to CSV (after mutations).
 */
export function exportBudgetsFromDbToFile(): void {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT account, category, amount
       FROM category_budgets
       ORDER BY account, category`,
    )
    .all() as BudgetCsvRow[];
  writeBudgetsToCsvFile(csvPath(), rows);
}

export function listBudgets(filters: { account?: AccountName }): BudgetRow[] {
  const db = getDb();
  let sql = 'SELECT id, account, category, amount FROM category_budgets WHERE 1=1';
  const params: string[] = [];
  if (filters.account) {
    sql += ' AND account = ?';
    params.push(filters.account);
  }
  sql += ' ORDER BY account, category';
  const raw = db.prepare(sql).all(...params) as Array<{
    id: number;
    account: string;
    category: string;
    amount: number;
  }>;
  return raw.map(r => ({
    id: r.id,
    account: r.account as AccountName,
    category: r.category as CategoryName,
    amount: Math.round(r.amount * 100) / 100,
  }));
}

export function upsertBudget(row: {
  account: AccountName;
  category: CategoryName;
  amount: number;
}): BudgetRow {
  if (!isValidAccountName(row.account)) {
    throw new Error('Invalid account');
  }
  if (!CATEGORY_NAMES.includes(row.category)) {
    throw new Error('Invalid category');
  }
  if (row.amount < 0 || !Number.isFinite(row.amount)) {
    throw new Error('Invalid amount');
  }

  const db = getDb();
  db.prepare(
    `
    INSERT INTO category_budgets (account, category, amount, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(account, category) DO UPDATE SET
      amount = excluded.amount,
      updated_at = datetime('now')
  `,
  ).run(row.account, row.category, row.amount);

  const inserted = db
    .prepare(
      `SELECT id, account, category, amount
       FROM category_budgets
       WHERE account = ? AND category = ?`,
    )
    .get(row.account, row.category) as {
    id: number;
    account: string;
    category: string;
    amount: number;
  };
  exportBudgetsFromDbToFile();
  return {
    id: inserted.id,
    account: inserted.account as AccountName,
    category: inserted.category as CategoryName,
    amount: Math.round(inserted.amount * 100) / 100,
  };
}

export function deleteBudgetById(id: number): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM category_budgets WHERE id = ?').run(id);
  if (result.changes > 0) {
    exportBudgetsFromDbToFile();
    return true;
  }
  return false;
}

/**
 * Pure merge: one row per month key with budget, spent, and signed difference (spent − budget).
 */
export function mergeBudgetsWithMonthlySpend(
  budgets: Array<{ category: string; amount: number }>,
  byMonth: ReadonlyMap<string, ReadonlyMap<string, number>>,
  monthKeysInOrder: readonly string[],
): BudgetComparison[] {
  return budgets.map(b => {
    const category = b.category as CategoryName;
    const monthlyBudget = Math.round(b.amount * 100) / 100;
    const months: BudgetMonthComparison[] = [];
    for (const mk of monthKeysInOrder) {
      const monthMap = byMonth.get(mk);
      const raw = monthMap?.get(category) ?? 0;
      const monthSpend = Math.round(raw * 100) / 100;
      const difference = Math.round((monthSpend - monthlyBudget) * 100) / 100;
      months.push({
        monthKey: mk,
        monthLabel: formatFinancialYearMonthLabel(mk),
        budget: monthlyBudget,
        spent: monthSpend,
        difference,
      });
    }
    return {
      category,
      monthlyBudget,
      months,
    };
  });
}

export function getBudgetVsActual(
  account: AccountName,
  financialYear: string,
): BudgetComparison[] {
  const db = getDb();
  const fyNorm = financialYear.replace('-', '/');
  const budgets = db
    .prepare(
      `SELECT category, amount FROM category_budgets
       WHERE account = ?`,
    )
    .all(account) as Array<{ category: string; amount: number }>;

  const { byMonth } = getCategoryExpenseFyAndByMonth(account, financialYear);
  const monthKeys = listFyMonthKeysThroughDate(fyNorm, new Date());

  return mergeBudgetsWithMonthlySpend(budgets, byMonth, monthKeys);
}
