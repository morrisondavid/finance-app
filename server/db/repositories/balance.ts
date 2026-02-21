import { getDb } from '../connection.js';
import { getFinancialYearRange, type DashboardFilters } from '../utils/financial-year.js';
import { ACCOUNTS, type AccountName } from '../../types.js';

export interface AccountBalance {
  account: AccountName;
  openingBalance: number;
  openingBalanceDate: string | null;
  transactionTotal: number;
  currentBalance: number;
  oldestTransaction: string | null;
  newestTransaction: string | null;
  transactionCount: number;
}

/**
 * Get the opening balance for an account
 */
export function getOpeningBalance(account: AccountName): { balance: number; date: string | null } {
  const db = getDb();
  const row = db.prepare(`
    SELECT opening_balance, opening_balance_date
    FROM account_balances
    WHERE account = ?
  `).get(account) as { opening_balance: number; opening_balance_date: string | null } | undefined;
  
  return {
    balance: row?.opening_balance ?? 0,
    date: row?.opening_balance_date ?? null
  };
}

/**
 * Set the opening balance for an account
 */
export function setOpeningBalance(account: AccountName, balance: number, date?: string): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO account_balances (account, opening_balance, opening_balance_date, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(account) DO UPDATE SET
      opening_balance = excluded.opening_balance,
      opening_balance_date = excluded.opening_balance_date,
      updated_at = CURRENT_TIMESTAMP
  `).run(account, balance, date || null);
}

/**
 * Calculate the current balance for an account
 * Current balance = opening balance + sum of all transactions
 */
export function getAccountBalance(account: AccountName, filters: DashboardFilters = {}): AccountBalance {
  const db = getDb();
  const opening = getOpeningBalance(account);
  
  // Build filter conditions
  let whereClause = 'WHERE account = ?';
  const params: (string | number)[] = [account];
  
  if (filters.financialYear) {
    const range = getFinancialYearRange(filters.financialYear);
    whereClause += ' AND date >= ? AND date <= ?';
    params.push(range.startDate, range.endDate);
  }
  
  // Get transaction totals and date range
  const stats = db.prepare(`
    SELECT 
      COALESCE(SUM(amount), 0) as total,
      MIN(date) as oldest,
      MAX(date) as newest,
      COUNT(*) as count
    FROM transactions
    ${whereClause}
  `).get(...params) as { total: number; oldest: string | null; newest: string | null; count: number };
  
  return {
    account,
    openingBalance: opening.balance,
    openingBalanceDate: opening.date,
    transactionTotal: stats.total,
    currentBalance: opening.balance + stats.total,
    oldestTransaction: stats.oldest,
    newestTransaction: stats.newest,
    transactionCount: stats.count
  };
}

/**
 * Get balances for all accounts
 */
export function getAllAccountBalances(filters: DashboardFilters = {}): Record<AccountName, AccountBalance> {
  const result: Record<AccountName, AccountBalance> = {} as Record<AccountName, AccountBalance>;
  
  for (const account of ACCOUNTS) {
    result[account] = getAccountBalance(account, filters);
  }
  
  return result;
}
