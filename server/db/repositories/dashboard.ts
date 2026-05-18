import { getDb } from '../connection.js';
import { buildDashboardFilters, type DashboardFilters } from '../utils/financial-year.js';
import { 
  shouldIncludeTransfersAsIncome, 
  getIncomeCondition, 
  getExpenseCondition,
  getTypeFilter 
} from '../utils/query-builders.js';
import type { MonthlySummary, AccountSummary, DashboardTotals } from '../../types.js';
import { ACCOUNTS } from '../../types.js';
import { getTransactions } from './transactions.js';
import { detectPassThrough } from '../../utils/pass-through-detector.js';
import { VAT } from '../../config/tax-rates.js';
import { round2 } from '../../utils/math.js';

/**
 * Get dashboard totals
 * For most accounts, transfers are included as income
 * For primary business account (barclays-current), transfers are excluded
 */
export function getDashboardTotals(filters: DashboardFilters = {}): DashboardTotals {
  const db = getDb();
  const { clause, params } = buildDashboardFilters(filters);
  const includeTransfers = shouldIncludeTransfersAsIncome(filters.account);
  
  const incomeResult = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE ${getIncomeCondition(includeTransfers)}${clause}
  `).get(...params) as { total: number };
  
  const expenseResult = db.prepare(`
    SELECT COALESCE(SUM(ABS(amount)), 0) as total FROM transactions WHERE ${getExpenseCondition(includeTransfers)}${clause}
  `).get(...params) as { total: number };
  
  const transfersInResult = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE type = 'transfer' AND amount > 0${clause}
  `).get(...params) as { total: number };
  
  const transfersOutResult = db.prepare(`
    SELECT COALESCE(SUM(ABS(amount)), 0) as total FROM transactions WHERE type = 'transfer' AND amount < 0${clause}
  `).get(...params) as { total: number };
  
  const income = round2(incomeResult.total);
  const expenses = round2(expenseResult.total);
  const net = round2(income - expenses);
  const vatLiability = round2(expenses * VAT.FRACTION);
  const transfersIn = round2(transfersInResult.total);
  const transfersOut = round2(transfersOutResult.total);

  // Detect pass-through income for the selected account (or all accounts)
  const txns = getTransactions({
    account: filters.account,
    financialYear: filters.financialYear,
    includeTransfers: true,
  });
  const { totalExcluded } = detectPassThrough(txns);
  const passThroughIncome = round2(totalExcluded);
  
  return { income, expenses, net, vatLiability, transfersIn, transfersOut, passThroughIncome };
}

/**
 * Get monthly summary
 * For most accounts, transfers are included as income/expense
 * For primary business account (barclays-current), transfers are excluded
 */
export function getMonthlySummary(filters: DashboardFilters = {}): MonthlySummary[] {
  const db = getDb();
  const { clause, params } = buildDashboardFilters(filters);
  const includeTransfers = shouldIncludeTransfersAsIncome(filters.account);
  
  const rows = db.prepare(`
    SELECT 
      strftime('%Y-%m', date) as month,
      SUM(CASE WHEN ${getIncomeCondition(includeTransfers)} THEN amount ELSE 0 END) as income,
      SUM(CASE WHEN ${getExpenseCondition(includeTransfers)} THEN ABS(amount) ELSE 0 END) as expenses
    FROM transactions
    WHERE ${getTypeFilter(includeTransfers)}${clause}
    GROUP BY strftime('%Y-%m', date)
    ORDER BY month ASC
  `).all(...params) as Array<{ month: string; income: number; expenses: number }>;
  
  return rows.map(row => ({
    month: row.month,
    income: round2(row.income),
    expenses: round2(row.expenses),
    net: round2(row.income - row.expenses),
    vat: round2(row.expenses * VAT.FRACTION)
  }));
}

/**
 * Get summary by account - for account selector indicators
 * Each account uses its own config to determine if transfers are included
 */
export function getAccountSummary(filters: DashboardFilters = {}): Record<string, AccountSummary> {
  const db = getDb();
  const result: Record<string, AccountSummary> = {};
  const { clause, params } = buildDashboardFilters({ financialYear: filters.financialYear }); // Don't filter by account here
  
  // Initialize all accounts with zeros
  for (const account of ACCOUNTS) {
    result[account] = { income: 0, expenses: 0, transactionCount: 0, newestTransaction: null };
  }
  
  const newestOverallStmt = db.prepare(
    `SELECT MAX(date) as newest FROM transactions WHERE account = ?`,
  );

  // Get raw data for each account and apply account-specific logic
  for (const account of ACCOUNTS) {
    const includeTransfers = shouldIncludeTransfersAsIncome(account);
    
    const row = db.prepare(`
      SELECT 
        SUM(CASE WHEN ${getIncomeCondition(includeTransfers)} THEN amount ELSE 0 END) as income,
        SUM(CASE WHEN ${getExpenseCondition(includeTransfers)} THEN ABS(amount) ELSE 0 END) as expenses,
        COUNT(*) as count,
        MAX(date) as newest
      FROM transactions
      WHERE account = ?${clause}
    `).get(account, ...params) as { income: number | null; expenses: number | null; count: number; newest: string | null };

    const newestOverall = newestOverallStmt.get(account) as { newest: string | null };

    result[account] = {
      income: round2(row.income || 0),
      expenses: round2(row.expenses || 0),
      transactionCount: row.count,
      // "Latest" on account chips + feed-sync `dateFrom` must reflect the true
      // newest row for the account, not MAX(date) inside the selected FY (a
      // transaction in e.g. 2026/27 would not move the FY-scoped MAX when
      // 2025/26 is selected).
      newestTransaction: newestOverall.newest,
    };
  }
  
  return result;
}
