import type { Transaction, TransactionType, AccountName } from '../../types.js';
import { isCreditCard, isCrossAccountBusinessToBusinessTransfer, getAccountConfig, isValidAccountName } from '../../types.js';
import type { CurrencyCode } from '../../types.js';
import { getDb, generateTransactionHash } from '../connection.js';
import { formatDateISO } from '../../../shared/date-format.js';
import { getFinancialYearRange, buildDashboardFilters, type DashboardFilters } from '../utils/financial-year.js';
import { 
  isTransferDescription,
  isBounceDescription
} from '../../config/transfer-patterns.js';
import { 
  shouldIncludeTransfersAsIncome,
  getIncomeCondition,
  getExpenseCondition 
} from '../utils/query-builders.js';
function accountCurrency(account: string): CurrencyCode {
  if (!isValidAccountName(account)) return 'GBP';
  return getAccountConfig(account as AccountName).currency;
}

import {
  expenseTxnMatchesMerchantModal,
  merchantDrillSearchSql,
} from '../../utils/merchant-drill-search.js';
import type { RawTransaction } from '../../utils/recurring-pipeline.js';
import { doAmountsAndDatesMatchForAccounts } from '../../domain/inter-company/pair-finder.js';

export interface TransactionRow {
  id: number;
  hash: string;
  date: string;
  description: string;
  amount: number;
  account: string;
  type: TransactionType;
  linked_transaction_id: number | null;
}

export interface TransactionFilters {
  account?: string;
  year?: string;
  month?: string;
  type?: TransactionType;
  includeTransfers?: boolean;
  financialYear?: string;
  search?: string;
  /** Budget nudge / merchant modal: same rules as {@link expenseTxnMatchesMerchantModal}. */
  merchantModalLabel?: string;
}

/** Escape `%`, `_`, and `\` for SQL `LIKE` when using `ESCAPE '\\'`. */
function escapeLikePatternSegment(fragment: string): string {
  return fragment.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/**
 * Check if a transaction description matches transfer patterns
 */
export function isTransferLikeDescription(description: string): boolean {
  return isTransferDescription(description);
}

/**
 * Check if a transaction description looks like a bounced payment
 */
export function isBouncedPayment(description: string): boolean {
  return isBounceDescription(description);
}

/**
 * Insert a transaction, skipping if duplicate (based on hash)
 * Returns true if inserted, false if duplicate
 */
export function insertTransaction(t: Transaction): boolean {
  const db = getDb();
  const hash = generateTransactionHash(t);
  const dateStr = formatDateISO(t.date);
  
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO transactions (hash, date, description, amount, account, type)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  
  const result = stmt.run(hash, dateStr, t.description, t.amount, t.account, t.type);
  return result.changes > 0;
}

/**
 * Insert multiple transactions in a single transaction
 * Returns count of actually inserted (non-duplicate) transactions
 */
export function insertTransactions(transactions: Transaction[]): { inserted: number; duplicates: number } {
  const db = getDb();
  let inserted = 0;
  let duplicates = 0;
  
  const insertMany = db.transaction((txns: Transaction[]) => {
    for (const t of txns) {
      if (insertTransaction(t)) {
        inserted++;
      } else {
        duplicates++;
      }
    }
  });
  
  insertMany(transactions);
  
  return { inserted, duplicates };
}

/**
 * Detect and mark transfers
 * 
 * Two types of detection:
 * 1. Cross-account: Money OUT of one account, IN to another, matching amounts
 * 2. Within-account: Matching IN/OUT amounts with transfer-like descriptions (e.g., Capital on Tap)
 */
export function detectTransfers(): number {
  const db = getDb();
  console.log('[Database] Detecting transfers...');
  
  const updateStmt = db.prepare(`
    UPDATE transactions 
    SET type = 'transfer', linked_transaction_id = ?
    WHERE id = ?
  `);
  
  const updateSingleStmt = db.prepare(`
    UPDATE transactions 
    SET type = 'transfer'
    WHERE id = ?
  `);
  
  let transferPairs = 0;
  let singleTransfers = 0;
  const matchedIds = new Set<number>();
  
  // ==========================================
  // Step 1: Find matching pairs (same amount, opposite directions)
  // ==========================================
  
  // Find all income transactions with transfer-like descriptions
  const incomeTransactions = db.prepare(`
    SELECT id, date, description, amount, account
    FROM transactions
    WHERE type = 'income' AND linked_transaction_id IS NULL
    ORDER BY date
  `).all() as Array<{
    id: number;
    date: string;
    description: string;
    amount: number;
    account: string;
  }>;
  
  // Find all expense transactions
  const expenseTransactions = db.prepare(`
    SELECT id, date, description, amount, account
    FROM transactions
    WHERE type = 'expense' AND linked_transaction_id IS NULL
    ORDER BY date
  `).all() as Array<{
    id: number;
    date: string;
    description: string;
    amount: number;
    account: string;
  }>;
  
  // Match income and expense transactions
  for (const income of incomeTransactions) {
    if (matchedIds.has(income.id)) continue;

    const incomeAmount = Math.abs(income.amount);
    const incomeIsTransferLike = isTransferLikeDescription(income.description);
    const incomeIsBounce = isBouncedPayment(income.description);

    for (const expense of expenseTransactions) {
      if (matchedIds.has(expense.id)) continue;

      const expenseIsTransferLike = isTransferLikeDescription(expense.description);

      // Shared amount + FX + date tolerance — identical to the
      // predicate `findInterCompanyPairs` uses, so within-entity
      // pairing and inter-company detection cannot drift out of
      // calibration.
      if (
        !doAmountsAndDatesMatchForAccounts({
          expenseAccount: expense.account,
          expenseAmount: expense.amount,
          expenseDate: expense.date,
          incomeAccount: income.account,
          incomeAmount: income.amount,
          incomeDate: income.date,
        })
      ) {
        continue;
      }

      const incomeCur = accountCurrency(income.account);
      const expenseCur = accountCurrency(expense.account);
      const crossCurrency = incomeCur !== expenseCur;

      // For same-account matching, need a reason to pair them:
      // - At least one side is transfer-like (Capital on Tap, etc.)
      // - OR the income side is a bounced payment (REV, insufficient funds)
      if (expense.account === income.account) {
        if (!incomeIsTransferLike && !expenseIsTransferLike && !incomeIsBounce) continue;
      } else if (
        !isCrossAccountBusinessToBusinessTransfer(expense.account, income.account)
      ) {
        // Business → personal (or unknown account): not an internal transfer
        continue;
      }
      
      // Found a match! Mark both as transfers
      // EXCEPT: For credit cards, keep the credit card side as income (debt repayment)
      const incomeIsCreditCard = isCreditCard(income.account as AccountName);
      console.log(`[Transfer Detection] Matching ${expense.account} -> ${income.account}, income is credit card: ${incomeIsCreditCard}`);
      db.transaction(() => {
        // updateStmt.run(linkedId, id) - updates transaction with `id`, links to `linkedId`
        // Only mark income as transfer if it's NOT a credit card
        if (!incomeIsCreditCard) {
          updateStmt.run(expense.id, income.id); // Mark income as transfer, link to expense
        }
        // Always mark expense as transfer
        updateStmt.run(income.id, expense.id); // Mark expense as transfer, link to income
      })();
      
      matchedIds.add(income.id);
      matchedIds.add(expense.id);
      transferPairs++;
      
      const transferType = expense.account === income.account 
        ? (incomeIsBounce ? 'bounce' : 'internal')
        : crossCurrency ? 'cross-currency' : 'cross-account';
      console.log(`[Database] Transfer pair (${transferType}): ${incomeAmount.toFixed(2)} ${incomeCur} (${income.date})`);
      break;
    }
  }
  
  // ==========================================
  // Step 1b: Mark standalone bounced payments as transfers
  // (income that looks like a bounce but no matching expense found)
  // ==========================================
  const unmatchedBounces = db.prepare(`
    SELECT id, date, description, amount
    FROM transactions
    WHERE type = 'income' 
      AND linked_transaction_id IS NULL
      AND (
        description LIKE '%REV%8003%'
        OR description LIKE '%8003%insufficient%'
        OR description LIKE '%insufficient fund%'
      )
  `).all() as Array<{
    id: number;
    date: string;
    description: string;
    amount: number;
  }>;
  
  for (const bounce of unmatchedBounces) {
    if (matchedIds.has(bounce.id)) continue;
    
    updateSingleStmt.run(bounce.id);
    matchedIds.add(bounce.id);
    singleTransfers++;
    
    console.log(`[Database] Bounced payment: £${bounce.amount.toFixed(2)} "${bounce.description.substring(0, 40)}" (${bounce.date})`);
  }
  
  // ==========================================
  // Step 2: Mark remaining credit card transactions as transfers
  // These are payments TO credit cards that don't have a matching withdrawal
  // ==========================================
  
  const remainingCreditCardPayments = db.prepare(`
    SELECT id, date, description, amount, account
    FROM transactions
    WHERE type = 'expense' 
      AND linked_transaction_id IS NULL
      AND (
        LOWER(description) LIKE '%capital on tap%'
        OR LOWER(description) LIKE '%barclaycard%'
        OR LOWER(description) LIKE '%santander%'
        OR description LIKE '%3062%'
      )
  `).all() as Array<{
    id: number;
    date: string;
    description: string;
    amount: number;
    account: string;
  }>;
  
  for (const payment of remainingCreditCardPayments) {
    if (matchedIds.has(payment.id)) continue;
    
    // Skip hardcoded detection for actual credit card accounts
    if (isCreditCard(payment.account as AccountName)) continue;
    
    updateSingleStmt.run(payment.id);
    matchedIds.add(payment.id);
    singleTransfers++;
    
    console.log(`[Database] Credit card payment: £${Math.abs(payment.amount).toFixed(2)} to ${payment.description.substring(0, 30)} (${payment.date})`);
  }
  
  // Mark transfers to savings account (BUSINESS PREMIUM STO = Barclays Savings)
  const remainingSavingsTransfers = db.prepare(`
    SELECT id, date, description, amount, account
    FROM transactions
    WHERE (type = 'expense' OR type = 'income')
      AND linked_transaction_id IS NULL
      AND LOWER(description) LIKE '%business premium%'
  `).all() as Array<{
    id: number;
    date: string;
    description: string;
    amount: number;
    account: string;
  }>;
  
  for (const transfer of remainingSavingsTransfers) {
    if (matchedIds.has(transfer.id)) continue;
    
    // Skip hardcoded detection for credit card accounts
    if (isCreditCard(transfer.account as AccountName)) continue;
    
    updateSingleStmt.run(transfer.id);
    matchedIds.add(transfer.id);
    singleTransfers++;
    
    const direction = transfer.amount < 0 ? 'to' : 'from';
    console.log(`[Database] Savings transfer: £${Math.abs(transfer.amount).toFixed(2)} ${direction} Barclays Savings (${transfer.date})`);
  }
  
  // Mark income from credit cards/transfers as transfers (drawing on credit line)
  const remainingCreditCardIncome = db.prepare(`
    SELECT id, date, description, amount, account
    FROM transactions
    WHERE type = 'income' 
      AND linked_transaction_id IS NULL
      AND (
        LOWER(description) LIKE '%capital on tap%'
        OR LOWER(description) LIKE '%barclaycard%'
        OR LOWER(description) LIKE '%santander%'
        OR description LIKE '%3062%'
        OR LOWER(description) LIKE '%virtualbanktransfer%'
        OR LOWER(description) LIKE '%optional ft%'
        OR description LIKE '%60878820%'
        OR LOWER(description) LIKE '%draw down%'
      )
  `).all() as Array<{
    id: number;
    date: string;
    description: string;
    amount: number;
    account: string;
  }>;
  
  for (const income of remainingCreditCardIncome) {
    if (matchedIds.has(income.id)) continue;
    
    // Skip hardcoded detection for credit card accounts - payments to credit cards are income, not transfers
    if (isCreditCard(income.account as AccountName)) continue;
    
    updateSingleStmt.run(income.id);
    matchedIds.add(income.id);
    singleTransfers++;
    
    console.log(`[Database] Transfer/credit draw: £${income.amount.toFixed(2)} "${income.description.substring(0, 35)}" (${income.date})`);
  }
  
  const totalTransfers = (transferPairs * 2) + singleTransfers;
  console.log(`[Database] Detected ${transferPairs} transfer pairs + ${singleTransfers} single transfers = ${totalTransfers} total`);
  return transferPairs;
}

/**
 * Get transactions with optional filters
 * Respects account config for including transfers as income/expense
 */
export function getTransactions(filters: TransactionFilters = {}): TransactionRow[] {
  const modalLabel = filters.merchantModalLabel?.trim();
  if (modalLabel && filters.type === 'expense') {
    const { merchantModalLabel: _omitModal, search: _omitSearch, ...base } = filters;
    const rows = getTransactions({ ...base, search: undefined });
    return rows.filter(row => {
      const raw: RawTransaction = {
        id: row.id,
        date: row.date,
        description: row.description,
        amount: row.amount,
        account: row.account,
        type: row.type,
      };
      return expenseTxnMatchesMerchantModal(raw, modalLabel);
    });
  }

  const db = getDb();
  let sql = 'SELECT * FROM transactions WHERE 1=1';
  const params: (string | number)[] = [];
  
  // Check if this account should include transfers as income/expense
  const includeTransfers = shouldIncludeTransfersAsIncome(filters.account);
  
  // By default, exclude transfers unless explicitly requested or account config says to include
  if (!filters.includeTransfers && !filters.type && !includeTransfers) {
    sql += ' AND type != \'transfer\'';
  }
  
  if (filters.account) {
    sql += ' AND account = ?';
    params.push(filters.account);
  }
  
  if (filters.year) {
    sql += ' AND strftime(\'%Y\', date) = ?';
    params.push(filters.year);
  }
  
  if (filters.month) {
    sql += ' AND strftime(\'%m\', date) = ?';
    params.push(filters.month.padStart(2, '0'));
  }
  
  // Type filter - for accounts that include transfers, expand the type filter
  if (filters.type) {
    if (includeTransfers) {
      // Include transfers with the appropriate type
      if (filters.type === 'income') {
        sql += ` AND ${getIncomeCondition(true)}`;
      } else if (filters.type === 'expense') {
        sql += ` AND ${getExpenseCondition(true)}`;
      } else {
        // For 'transfer' type, just match transfer
        sql += ' AND type = ?';
        params.push(filters.type);
      }
    } else {
      // Standard type filter
      sql += ' AND type = ?';
      params.push(filters.type);
    }
  }
  
  // Financial year filter
  if (filters.financialYear) {
    const range = getFinancialYearRange(filters.financialYear);
    sql += ' AND date >= ? AND date <= ?';
    params.push(range.startDate, range.endDate);
  }

  if (filters.search) {
    const needle = filters.search.trim();
    const drill = merchantDrillSearchSql(needle);
    if (drill === null) {
      sql += " AND description LIKE ? ESCAPE '\\'";
      params.push(`%${escapeLikePatternSegment(needle)}%`);
    } else if (drill.kind === 'like_lower') {
      sql += " AND LOWER(description) LIKE ? ESCAPE '\\'";
      params.push(drill.pattern);
    } else {
      sql += ' AND regexp(?, description) = 1';
      params.push(drill.pattern);
      if (drill.extraSql) sql += drill.extraSql;
    }
  }

  sql += ' ORDER BY date DESC';
  
  return db.prepare(sql).all(...params) as TransactionRow[];
}

/** Expense rows for one account on or after `sinceDate` (YYYY-MM-DD), oldest first. */
export function getExpensesForAccountSinceAsc(account: string, sinceDate: string): TransactionRow[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM transactions WHERE account = ? AND date >= ? AND type = 'expense' ORDER BY date ASC`,
    )
    .all(account, sinceDate) as TransactionRow[];
}

/**
 * Get transaction count (excluding transfers)
 */
export function getTransactionCount(filters: DashboardFilters = {}): number {
  const db = getDb();
  const { clause, params } = buildDashboardFilters(filters);
  const result = db.prepare(`SELECT COUNT(*) as count FROM transactions WHERE type != 'transfer'${clause}`).get(...params) as { count: number };
  return result.count;
}

/**
 * Get transfer count
 */
export function getTransferCount(filters: DashboardFilters = {}): number {
  const db = getDb();
  const { clause, params } = buildDashboardFilters(filters);
  const result = db.prepare(`SELECT COUNT(*) as count FROM transactions WHERE type = 'transfer'${clause}`).get(...params) as { count: number };
  return result.count;
}
