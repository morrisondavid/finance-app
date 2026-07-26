import type { Transaction, TransactionType, AccountName } from '../../types.js';
import {
  isCreditCard,
  isCrossAccountBusinessToBusinessTransfer,
  getAccountConfig,
  isValidAccountName,
} from '../../domain/accounts/index.js';
import type { CurrencyCode } from '../../types.js';
import { getDb, generateTransactionHash } from '../connection.js';
import { formatDateISO } from '../../../shared/date-format.js';
import { getFinancialYearRange, buildDashboardFilters, type DashboardFilters } from '../utils/financial-year.js';
import {
  isTransferDescription,
  isBounceDescription,
  bounceDescriptionSqlPrefilter,
  isHmrcTaxPaymentDescription,
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

/**
 * Savings (and similar) accounts treat inbound internal transfers as real
 * income for balance / cash-flow views, while still excluding them from
 * VAT-applicable ledgers via `vat.applicable`.
 */
function preserveInboundAsIncome(account: string): boolean {
  if (!isValidAccountName(account)) return false;
  return !getAccountConfig(account as AccountName).excludeTransfersFromIncome;
}

/**
 * Clear transfer pairing so {@link detectTransfers} can re-derive
 * classification from current rules (e.g. after an HMRC exclusion fix).
 */
export function resetTransferClassification(): void {
  const db = getDb();
  db.prepare(`
    UPDATE transactions
    SET type = CASE WHEN amount >= 0 THEN 'income' ELSE 'expense' END,
        linked_transaction_id = NULL
    WHERE type = 'transfer'
  `).run();
}

import {
  expenseTxnMatchesMerchantModal,
  merchantDrillSearchSql,
} from '../../utils/merchant-drill-search.js';
import { buildMerchantModalDescriptionPredicate } from '../../utils/merchant-modal-description-sql.js';
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
  /**
   * Inclusive lower bound on `date` (`YYYY-MM-DD`). Used by consolidated warnings /
   * tax-reserve paths to align with rolling pipeline windows instead of hydrating all rows.
   */
  minDateInclusive?: string;
  /**
   * Inclusive ISO bounds on stored `date` (`YYYY-MM-DD`).
   *
   * **Precedence:** API / agent callers should treat this range as **mutually exclusive**
   * with `financialYear` and with `(year, month)` — enforce at validation (Wave 03 Zod on
   * routes/MCP tools). If combined here, predicates are ANDed (intersection); unknown
   * callers should not rely on that.
   *
   * Malformed strings are ignored. If both bounds parse and `dateFrom > dateTo`, the result
   * is an empty array (stable invariant rather than widening the query).
   */
  dateFrom?: string;
  /** @see {@link TransactionFilters.dateFrom} */
  dateTo?: string;
}

/** Escape `%`, `_`, and `\` for SQL `LIKE` when using `ESCAPE '\\'`. */
function escapeLikePatternSegment(fragment: string): string {
  return fragment.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

const ISO_BOUND_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Returns a trimmed ISO `YYYY-MM-DD` or undefined if absent / malformed. */
function parseIsoTransactionDateBound(raw?: string): string | undefined {
  const t = raw?.trim();
  if (!t) return undefined;
  if (!ISO_BOUND_RE.test(t)) return undefined;
  return t;
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
        if (isHmrcTaxPaymentDescription(expense.description)) continue;
        if (isHmrcTaxPaymentDescription(income.description)) continue;
      } else if (
        !isCrossAccountBusinessToBusinessTransfer(expense.account, income.account)
      ) {
        // Business → personal (or unknown account): not an internal transfer
        continue;
      }

      // HMRC tax settlements are never legs of an internal transfer pair.
      if (isHmrcTaxPaymentDescription(expense.description)) continue;
      if (isHmrcTaxPaymentDescription(income.description)) continue;
      
      // Found a match! Mark both as transfers
      // EXCEPT: For credit cards, keep the credit card side as income (debt repayment)
      const incomeIsCreditCard = isCreditCard(income.account as AccountName);
      const keepIncomeAsIncome = preserveInboundAsIncome(income.account);
      console.log(`[Transfer Detection] Matching ${expense.account} -> ${income.account}, income is credit card: ${incomeIsCreditCard}`);
      db.transaction(() => {
        // updateStmt.run(linkedId, id) - updates transaction with `id`, links to `linkedId`
        // Only mark income as transfer if it's NOT a credit card / savings inbound
        if (!incomeIsCreditCard && !keepIncomeAsIncome) {
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
      AND ${bounceDescriptionSqlPrefilter()}
  `).all() as Array<{
    id: number;
    date: string;
    description: string;
    amount: number;
  }>;
  
  for (const bounce of unmatchedBounces) {
    if (matchedIds.has(bounce.id)) continue;
    if (!isBouncedPayment(bounce.description)) continue;

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

    // Inbound credits on savings stay `income` for balance / cash-flow views.
    if (transfer.amount > 0 && preserveInboundAsIncome(transfer.account)) continue;
    
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
        OR LOWER(description) LIKE '%david morrison & heena tailor%'
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

    // Savings inbound draws (OPTIONAL FT, etc.) remain `income`.
    if (preserveInboundAsIncome(income.account)) continue;
    
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
 * Shared SQL `WHERE` tail (after `WHERE 1=1`) + params for transaction listing / aggregates.
 * When {@link TransactionFilterCompileResult.merchantModalNeedsJsFallback} is true, the SQL
 * intentionally omits merchant-modal description predicates; callers must post-filter with
 * {@link expenseTxnMatchesMerchantModal} (see {@link getTransactions}).
 */
export interface TransactionFilterCompileResult {
  readonly earlyEmpty: boolean;
  readonly merchantModalNeedsJsFallback: boolean;
  readonly modalLabelTrimmed?: string;
  /** Append to `... WHERE 1=1` (leading ` AND ...`). */
  readonly whereSql: string;
  readonly params: (string | number)[];
}

export function compileTransactionFilterSql(filters: TransactionFilters): TransactionFilterCompileResult {
  const isoFrom = parseIsoTransactionDateBound(filters.dateFrom);
  const isoTo = parseIsoTransactionDateBound(filters.dateTo);
  if (isoFrom !== undefined && isoTo !== undefined && isoFrom > isoTo) {
    return {
      earlyEmpty: true,
      merchantModalNeedsJsFallback: false,
      whereSql: '',
      params: [],
    };
  }

  const modalLabelTrimmed = filters.merchantModalLabel?.trim();
  const modalPred =
    modalLabelTrimmed !== undefined &&
    modalLabelTrimmed.length > 0 &&
    filters.type === 'expense'
      ? buildMerchantModalDescriptionPredicate(modalLabelTrimmed)
      : null;
  const merchantModalNeedsJsFallback =
    Boolean(modalLabelTrimmed && filters.type === 'expense') && modalPred === null;

  const { merchantModalLabel: _omitMerchantModal, ...restFilters } = filters;
  const sqlFilters: TransactionFilters = { ...restFilters };
  if (modalLabelTrimmed !== undefined && modalLabelTrimmed.length > 0 && filters.type === 'expense') {
    sqlFilters.search = undefined;
  }

  let sql = '';
  const params: (string | number)[] = [];

  if (sqlFilters.minDateInclusive !== undefined && sqlFilters.minDateInclusive.length > 0) {
    sql += ' AND date >= ?';
    params.push(sqlFilters.minDateInclusive);
  }

  const includeTransfers = shouldIncludeTransfersAsIncome(sqlFilters.account);

  if (sqlFilters.account) {
    sql += ' AND account = ?';
    params.push(sqlFilters.account);
  }

  if (sqlFilters.year) {
    sql += ' AND strftime(\'%Y\', date) = ?';
    params.push(sqlFilters.year);
  }

  if (sqlFilters.month) {
    sql += ' AND strftime(\'%m\', date) = ?';
    params.push(sqlFilters.month.padStart(2, '0'));
  }

  if (sqlFilters.type) {
    if (includeTransfers) {
      if (sqlFilters.type === 'income') {
        sql += ` AND ${getIncomeCondition(true)}`;
      } else if (sqlFilters.type === 'expense') {
        sql += ` AND ${getExpenseCondition(true)}`;
      } else {
        sql += ' AND type = ?';
        params.push(sqlFilters.type);
      }
    } else {
      sql += ' AND type = ?';
      params.push(sqlFilters.type);
    }
  }

  if (sqlFilters.financialYear) {
    const range = getFinancialYearRange(sqlFilters.financialYear);
    sql += ' AND date >= ? AND date <= ?';
    params.push(range.startDate, range.endDate);
  }

  if (isoFrom !== undefined) {
    sql += ' AND date >= ?';
    params.push(isoFrom);
  }

  if (isoTo !== undefined) {
    sql += ' AND date <= ?';
    params.push(isoTo);
  }

  if (sqlFilters.search) {
    const needle = sqlFilters.search.trim();
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

  if (modalPred !== null) {
    sql += ` AND (${modalPred.clause})`;
    params.push(...modalPred.params);
  }

  return {
    earlyEmpty: false,
    merchantModalNeedsJsFallback,
    modalLabelTrimmed,
    whereSql: sql,
    params,
  };
}

export interface TransactionAccountAggregateRow {
  readonly account: string;
  readonly rowCount: number;
  readonly sumAmount: number;
}

/**
 * `COUNT` / `SUM(amount)` grouped by account for the same filter surface as {@link getTransactions}.
 * When merchant modal needs JS fallback, delegates to {@link getTransactions} and aggregates in-process.
 */
export function summarizeTransactionsByAccount(filters: TransactionFilters = {}): TransactionAccountAggregateRow[] {
  const compiled = compileTransactionFilterSql(filters);
  if (compiled.earlyEmpty) {
    return [];
  }
  const db = getDb();

  if (!compiled.merchantModalNeedsJsFallback) {
    const sql =
      'SELECT account, COUNT(*) AS row_count, SUM(amount) AS sum_amount FROM transactions WHERE 1=1' +
      compiled.whereSql +
      ' GROUP BY account ORDER BY account ASC';
    const raw = db.prepare(sql).all(...compiled.params) as Array<{
      account: string;
      row_count: number;
      sum_amount: number;
    }>;
    return raw.map(r => ({
      account: r.account,
      rowCount: r.row_count,
      sumAmount: r.sum_amount,
    }));
  }

  const rows = getTransactions(filters);
  const byAccount = new Map<string, { rowCount: number; sumAmount: number }>();
  for (const r of rows) {
    const cur = byAccount.get(r.account) ?? { rowCount: 0, sumAmount: 0 };
    cur.rowCount += 1;
    cur.sumAmount += r.amount;
    byAccount.set(r.account, cur);
  }
  return [...byAccount.entries()]
    .map(([account, v]) => ({ account, rowCount: v.rowCount, sumAmount: v.sumAmount }))
    .sort((a, b) => a.account.localeCompare(b.account));
}

/**
 * Get transactions with optional filters
 * Respects account config for including transfers as income/expense
 */
export function getTransactions(filters: TransactionFilters = {}): TransactionRow[] {
  const compiled = compileTransactionFilterSql(filters);
  if (compiled.earlyEmpty) {
    return [];
  }

  const db = getDb();
  const sql = 'SELECT * FROM transactions WHERE 1=1' + compiled.whereSql + ' ORDER BY date DESC';
  const rows = db.prepare(sql).all(...compiled.params) as TransactionRow[];

  if (!compiled.merchantModalNeedsJsFallback || !compiled.modalLabelTrimmed) {
    return rows;
  }

  const modalLabel = compiled.modalLabelTrimmed;
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
