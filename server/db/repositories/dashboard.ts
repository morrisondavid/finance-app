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
  const { clause, params } = buildDashboardFilters({ financialYear: filters.financialYear });

  for (const account of ACCOUNTS) {
    result[account] = { income: 0, expenses: 0, transactionCount: 0, newestTransaction: null };
  }

  type AggRow = {
    account: string;
    type: string;
    cnt: number;
    income_sum: number;
    expense_sum: number;
    transfer_in: number;
    transfer_out: number;
  };

  const aggRows = db.prepare(`
    SELECT account,
           type,
           COUNT(*) AS cnt,
           SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) AS income_sum,
           SUM(CASE WHEN type = 'expense' THEN ABS(amount) ELSE 0 END) AS expense_sum,
           SUM(CASE WHEN type = 'transfer' AND amount > 0 THEN amount ELSE 0 END) AS transfer_in,
           SUM(CASE WHEN type = 'transfer' AND amount < 0 THEN ABS(amount) ELSE 0 END) AS transfer_out
    FROM transactions
    WHERE 1=1${clause}
    GROUP BY account, type
  `).all(...params) as AggRow[];

  const byAccountAgg = new Map<string, AggRow[]>();
  for (const row of aggRows) {
    const bucket = byAccountAgg.get(row.account);
    if (bucket) bucket.push(row);
    else byAccountAgg.set(row.account, [row]);
  }

  const newestOverallRows = db.prepare(
    `SELECT account, MAX(date) AS newest FROM transactions GROUP BY account`,
  ).all() as Array<{ account: string; newest: string | null }>;

  const newestByAccount = new Map(newestOverallRows.map(r => [r.account, r.newest]));

  for (const account of ACCOUNTS) {
    const includeTransfers = shouldIncludeTransfersAsIncome(account);
    const rows = byAccountAgg.get(account) ?? [];
    let income = 0;
    let expenses = 0;
    let transactionCount = 0;

    for (const row of rows) {
      if (row.type === 'income') {
        income += row.income_sum;
        transactionCount += row.cnt;
      } else if (row.type === 'expense') {
        expenses += row.expense_sum;
        transactionCount += row.cnt;
      } else if (row.type === 'transfer') {
        if (includeTransfers) {
          income += row.transfer_in;
          expenses += row.transfer_out;
          transactionCount += row.cnt;
        }
      }
    }

    result[account] = {
      income: round2(income),
      expenses: round2(expenses),
      transactionCount,
      newestTransaction: newestByAccount.get(account) ?? null,
    };
  }

  return result;
}
