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
  
  const income = Math.round(incomeResult.total * 100) / 100;
  const expenses = Math.round(expenseResult.total * 100) / 100;
  const net = Math.round((income - expenses) * 100) / 100;
  const vatLiability = Math.round((expenses * 0.2 / 1.2) * 100) / 100;
  const transfersIn = Math.round(transfersInResult.total * 100) / 100;
  const transfersOut = Math.round(transfersOutResult.total * 100) / 100;
  
  return { income, expenses, net, vatLiability, transfersIn, transfersOut };
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
    income: Math.round(row.income * 100) / 100,
    expenses: Math.round(row.expenses * 100) / 100,
    net: Math.round((row.income - row.expenses) * 100) / 100,
    vat: Math.round((row.expenses * 0.2 / 1.2) * 100) / 100
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
    
    result[account] = {
      income: Math.round((row.income || 0) * 100) / 100,
      expenses: Math.round((row.expenses || 0) * 100) / 100,
      transactionCount: row.count,
      newestTransaction: row.newest
    };
  }
  
  return result;
}
