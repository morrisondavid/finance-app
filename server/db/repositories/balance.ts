import { getDb } from '../connection.js';
import { getFinancialYearRange, type DashboardFilters } from '../utils/financial-year.js';
import { ACCOUNTS, type AccountName } from '../../types.js';
import { upsertOpeningBalanceRowAndPersist } from '../opening-balances-csv.js';

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
 * Persist the opening anchor for running-balance queries.
 *
 * When `date` is set, it is the **inclusive** first calendar day whose
 * `transactions` rows count toward {@link getAccountBalance}: movements
 * strictly before that day are already represented inside `balance`
 * (or out of scope for this ledger).
 */
export function setOpeningBalance(account: AccountName, balance: number, date?: string): void {
  upsertOpeningBalanceRowAndPersist(account, balance, date ?? null, getDb());
}

/**
 * Running balance for an account.
 *
 * `currentBalance = openingBalance + transactionTotal`, where `transactionTotal`
 * is the sum of rows matching the filters below.
 *
 * When `opening_balance_date` is **non-null**, only transactions with
 * **`date >= opening_balance_date`** are summed (inclusive start of ledger
 * processing). When it is **null**, **all** rows for the account are summed
 * (legacy behaviour).
 *
 * Optional `financialYear` further restricts to that FY’s `[startDate, endDate]`,
 * intersecting with the opening-date window when both apply.
 *
 * Optional `asOfDate` (inclusive) caps the window: only transactions with
 * `date <= asOfDate` are summed. When earlier than `opening_balance_date`,
 * the result is the opening balance alone (no in-window rows).
 */
export function getAccountBalance(account: AccountName, filters: DashboardFilters = {}): AccountBalance {
  const db = getDb();
  const opening = getOpeningBalance(account);

  let whereClause = 'WHERE account = ?';
  const params: (string | number)[] = [account];

  if (opening.date !== null && opening.date !== '') {
    whereClause += ' AND date >= ?';
    params.push(opening.date);
  }

  if (filters.financialYear) {
    const range = getFinancialYearRange(filters.financialYear);
    whereClause += ' AND date >= ? AND date <= ?';
    params.push(range.startDate, range.endDate);
  }

  if (filters.asOfDate !== undefined && filters.asOfDate !== '') {
    whereClause += ' AND date <= ?';
    params.push(filters.asOfDate);
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
  
  const result = {
    account,
    openingBalance: opening.balance,
    openingBalanceDate: opening.date,
    transactionTotal: stats.total,
    currentBalance: opening.balance + stats.total,
    oldestTransaction: stats.oldest,
    newestTransaction: stats.newest,
    transactionCount: stats.count
  };

  return result;
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
