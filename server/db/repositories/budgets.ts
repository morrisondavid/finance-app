import { getDb, BUDGETS_DIR } from '../connection.js';
import type { AccountName } from '../../types.js';
import { isValidAccountName } from '../../types.js';
import type { CategoryName } from '../../utils/categorizer.js';
import { CATEGORY_NAMES } from '../../utils/categorizer.js';
import { getCategoryExpenseTotals } from '../../utils/category-expense-totals.js';
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
  financialYear: string;
  amount: number;
}

export interface BudgetComparison {
  category: CategoryName;
  budgetAmount: number;
  spent: number;
  remaining: number;
  overBy: number;
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
    INSERT INTO category_budgets (account, category, financial_year, amount, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `);
  const normalizeFy = (fy: string): string => fy.replace('-', '/');
  const run = db.transaction((list: BudgetCsvRow[]) => {
    for (const r of list) {
      insert.run(r.account, r.category, normalizeFy(r.financialYear), r.amount);
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
      `SELECT account, category, financial_year as financialYear, amount
       FROM category_budgets
       ORDER BY account, financial_year, category`,
    )
    .all() as BudgetCsvRow[];
  writeBudgetsToCsvFile(csvPath(), rows);
}

export function listBudgets(filters: {
  account?: AccountName;
  financialYear?: string;
}): BudgetRow[] {
  const db = getDb();
  let sql = 'SELECT id, account, category, financial_year as financialYear, amount FROM category_budgets WHERE 1=1';
  const params: string[] = [];
  if (filters.account) {
    sql += ' AND account = ?';
    params.push(filters.account);
  }
  if (filters.financialYear) {
    sql += ' AND financial_year = ?';
    params.push(filters.financialYear);
  }
  sql += ' ORDER BY financial_year DESC, account, category';
  const raw = db.prepare(sql).all(...params) as Array<{
    id: number;
    account: string;
    category: string;
    financialYear: string;
    amount: number;
  }>;
  return raw.map(r => ({
    id: r.id,
    account: r.account as AccountName,
    category: r.category as CategoryName,
    financialYear: r.financialYear,
    amount: Math.round(r.amount * 100) / 100,
  }));
}

export function upsertBudget(row: {
  account: AccountName;
  category: CategoryName;
  financialYear: string;
  amount: number;
}): BudgetRow {
  if (!isValidAccountName(row.account)) {
    throw new Error('Invalid account');
  }
  if (!CATEGORY_NAMES.includes(row.category)) {
    throw new Error('Invalid category');
  }
  if (!/^\d{4}[/-]\d{2}$/.test(row.financialYear)) {
    throw new Error('Invalid financial year format');
  }
  const normalizedFy = row.financialYear.replace('-', '/');
  if (row.amount < 0 || !Number.isFinite(row.amount)) {
    throw new Error('Invalid amount');
  }

  const db = getDb();
  db.prepare(
    `
    INSERT INTO category_budgets (account, category, financial_year, amount, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(account, category, financial_year) DO UPDATE SET
      amount = excluded.amount,
      updated_at = datetime('now')
  `,
  ).run(row.account, row.category, normalizedFy, row.amount);

  const inserted = db
    .prepare(
      `SELECT id, account, category, financial_year as financialYear, amount
       FROM category_budgets
       WHERE account = ? AND category = ? AND financial_year = ?`,
    )
    .get(row.account, row.category, normalizedFy) as {
    id: number;
    account: string;
    category: string;
    financialYear: string;
    amount: number;
  };
  exportBudgetsFromDbToFile();
  return {
    id: inserted.id,
    account: inserted.account as AccountName,
    category: inserted.category as CategoryName,
    financialYear: inserted.financialYear,
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
 * Pure merge of budget rows with a spend map (used by dashboard and tests).
 */
export function mergeBudgetsWithSpendTotals(
  budgets: Array<{ category: string; amount: number }>,
  spend: ReadonlyMap<string, number>,
): BudgetComparison[] {
  return budgets.map(b => {
    const category = b.category as CategoryName;
    const budgetAmount = Math.round(b.amount * 100) / 100;
    const spent = Math.round((spend.get(category) ?? 0) * 100) / 100;
    const overBy = Math.max(0, spent - budgetAmount);
    const remaining = Math.max(0, budgetAmount - spent);
    return { category, budgetAmount, spent, remaining, overBy };
  });
}

export function getBudgetVsActual(
  account: AccountName,
  financialYear: string,
): BudgetComparison[] {
  const db = getDb();
  const budgets = db
    .prepare(
      `SELECT category, amount FROM category_budgets
       WHERE account = ? AND financial_year = ?`,
    )
    .all(account, financialYear) as Array<{ category: string; amount: number }>;

  const spend = getCategoryExpenseTotals(account, financialYear);

  return mergeBudgetsWithSpendTotals(budgets, spend);
}
