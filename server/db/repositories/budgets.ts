/**
 * Category budgets: DB mirrors canonical CSV; use upsert/delete here so file and DB stay aligned.
 * One row per (account, category): `amount` is a monthly cap or full FY cap per `budget_period`.
 */
import { getDb, BUDGETS_DIR } from '../connection.js';
import type { AccountName } from '../../types.js';
import { isValidAccountName } from '../../types.js';
import type { CategoryName } from '../../utils/categorizer.js';
import { CATEGORY_NAMES } from '../../utils/categorizer.js';
import { round2 } from '../../utils/math.js';
import { getCategoryExpenseFyAndByMonth } from '../../utils/category-expense-totals.js';
import {
  listFyMonthKeysThroughDate,
  formatFinancialYearMonthLabel,
  normalizeFinancialYear,
} from '../utils/financial-year.js';
import {
  readBudgetsFromCsvFile,
  writeBudgetsToCsvFile,
  getBudgetCsvPath,
  ensureBudgetCsvWithHeader,
  type BudgetCsvRow,
} from '../budgets-csv.js';
import {
  BudgetPeriodSchema,
  type BudgetPeriod,
  type YearlyBudgetComparison,
} from '../../../shared/api-contracts.js';

export interface BudgetRow {
  id: number;
  account: AccountName;
  category: CategoryName;
  amount: number;
  period: BudgetPeriod;
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

function normalizeBudgetPeriod(raw: string | null | undefined): BudgetPeriod {
  const p = BudgetPeriodSchema.safeParse(raw);
  return p.success ? p.data : 'monthly';
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
    INSERT INTO category_budgets (account, category, amount, budget_period, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `);
  const run = db.transaction((list: BudgetCsvRow[]) => {
    for (const r of list) {
      insert.run(r.account, r.category, r.amount, r.period);
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
      `SELECT account, category, amount, COALESCE(budget_period, 'monthly') AS budget_period
       FROM category_budgets
       ORDER BY account, category`,
    )
    .all() as Array<{ account: string; category: string; amount: number; budget_period: string }>;
  const csvRows: BudgetCsvRow[] = rows.map(r => ({
    account: r.account as AccountName,
    category: r.category as CategoryName,
    amount: round2(r.amount),
    period: normalizeBudgetPeriod(r.budget_period),
  }));
  writeBudgetsToCsvFile(csvPath(), csvRows);
}

export function listBudgets(filters: { account?: AccountName }): BudgetRow[] {
  const db = getDb();
  let sql =
    'SELECT id, account, category, amount, COALESCE(budget_period, \'monthly\') AS budget_period FROM category_budgets WHERE 1=1';
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
    budget_period: string;
  }>;
  return raw.map(r => ({
    id: r.id,
    account: r.account as AccountName,
    category: r.category as CategoryName,
    amount: round2(r.amount),
    period: normalizeBudgetPeriod(r.budget_period),
  }));
}

export function upsertBudget(row: {
  account: AccountName;
  category: CategoryName;
  amount: number;
  period: BudgetPeriod;
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
  const p = BudgetPeriodSchema.safeParse(row.period);
  if (!p.success) {
    throw new Error('Invalid budget period');
  }

  const db = getDb();
  db.prepare(
    `
    INSERT INTO category_budgets (account, category, amount, budget_period, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(account, category) DO UPDATE SET
      amount = excluded.amount,
      budget_period = excluded.budget_period,
      updated_at = datetime('now')
  `,
  ).run(row.account, row.category, row.amount, p.data);

  const inserted = db
    .prepare(
      `SELECT id, account, category, amount, COALESCE(budget_period, 'monthly') AS budget_period
       FROM category_budgets
       WHERE account = ? AND category = ?`,
    )
    .get(row.account, row.category) as {
    id: number;
    account: string;
    category: string;
    amount: number;
    budget_period: string;
  };
  exportBudgetsFromDbToFile();
  return {
    id: inserted.id,
    account: inserted.account as AccountName,
    category: inserted.category as CategoryName,
    amount: round2(inserted.amount),
    period: normalizeBudgetPeriod(inserted.budget_period),
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
    const monthlyBudget = round2(b.amount);
    const months: BudgetMonthComparison[] = [];
    for (const mk of monthKeysInOrder) {
      const monthMap = byMonth.get(mk);
      const raw = monthMap?.get(category) ?? 0;
      const monthSpend = round2(raw);
      const difference = round2(monthSpend - monthlyBudget);
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

/**
 * Pure merge: FY total spend vs yearly cap per category.
 */
export function mergeYearlyBudgetsWithFySpend(
  budgets: Array<{ category: string; amount: number }>,
  fyTotals: ReadonlyMap<CategoryName, number>,
): YearlyBudgetComparison[] {
  return budgets.map(b => {
    const category = b.category;
    const yearlyBudget = round2(b.amount);
    const spent = round2(fyTotals.get(category as CategoryName) ?? 0);
    const difference = round2(spent - yearlyBudget);
    return {
      category,
      yearlyBudget,
      spent,
      difference,
    };
  });
}

export interface BudgetComparisonsForFy {
  monthly: BudgetComparison[];
  yearly: YearlyBudgetComparison[];
}

/**
 * Single FY expense pass; splits budgets by period and returns monthly + yearly comparisons.
 */
export function getBudgetComparisonsForFy(
  account: AccountName,
  financialYear: string,
): BudgetComparisonsForFy {
  const db = getDb();
  const fyNorm = normalizeFinancialYear(financialYear);
  const budgetRows = db
    .prepare(
      `SELECT category, amount, COALESCE(budget_period, 'monthly') AS budget_period
       FROM category_budgets
       WHERE account = ?`,
    )
    .all(account) as Array<{ category: string; amount: number; budget_period: string }>;

  const { byMonth, fyTotals } = getCategoryExpenseFyAndByMonth(account, financialYear);
  const monthKeys = listFyMonthKeysThroughDate(fyNorm, new Date());

  const monthlyBudgetRows = budgetRows
    .filter(r => normalizeBudgetPeriod(r.budget_period) === 'monthly')
    .map(({ category, amount }) => ({ category, amount }));
  const yearlyBudgetRows = budgetRows
    .filter(r => normalizeBudgetPeriod(r.budget_period) === 'yearly')
    .map(({ category, amount }) => ({ category, amount }));

  return {
    monthly: mergeBudgetsWithMonthlySpend(monthlyBudgetRows, byMonth, monthKeys),
    yearly: mergeYearlyBudgetsWithFySpend(yearlyBudgetRows, fyTotals),
  };
}

export function getBudgetVsActual(
  account: AccountName,
  financialYear: string,
): BudgetComparison[] {
  return getBudgetComparisonsForFy(account, financialYear).monthly;
}
