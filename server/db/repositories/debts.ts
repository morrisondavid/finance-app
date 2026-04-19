/**
 * Debts: external creditors (loans, finance agreements) without statement feeds.
 * DB mirrors canonical CSV at debts/debts.csv; every mutation re-exports the CSV
 * so the file is always authoritative on disk. Derived summaries (currentBalance,
 * paidSinceOpening, payoffProgress) are computed from the transactions table by
 * matching the merchant substring + source-account set.
 */

import { getDb, DEBTS_DIR } from '../connection.js';
import type { AccountName } from '../../types.js';
import { isValidAccountName } from '../../types.js';
import { round2 } from '../../utils/math.js';
import {
  readDebtsFromCsvFile,
  writeDebtsToCsvFile,
  ensureDebtsCsvWithDefaults,
  getDebtsCsvPath,
  type DebtCsvRow,
} from '../debts-csv.js';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface Debt {
  id: string;
  name: string;
  merchantPattern: string;
  sourceAccounts: AccountName[];
  originalLoanAmount: number;
  originalLoanDate: string | null;
  openingBalance: number;
  openingBalanceDate: string;
  archived: boolean;
  updatedAt: string;
}

export interface DebtSummary extends Debt {
  currentBalance: number;
  paidSinceOpening: number;
  lastPaymentDate: string | null;
  lastPaymentAmount: number | null;
  matchedTransactionCount: number;
  payoffProgress: number;
}

export interface DebtCreateInput {
  id: string;
  name: string;
  merchantPattern: string;
  sourceAccounts: AccountName[];
  originalLoanAmount: number;
  originalLoanDate?: string | null;
  openingBalance: number;
  openingBalanceDate: string;
}

export interface DebtUpdateInput {
  name?: string;
  merchantPattern?: string;
  sourceAccounts?: AccountName[];
  originalLoanAmount?: number;
  originalLoanDate?: string | null;
  openingBalance?: number;
  openingBalanceDate?: string;
  archived?: boolean;
}

interface DebtRowShape {
  id: string;
  name: string;
  merchant_pattern: string;
  source_accounts: string;
  original_loan_amount: number;
  original_loan_date: string | null;
  opening_balance: number;
  opening_balance_date: string;
  archived: number;
  updated_at: string;
}

function csvPath(): string {
  return getDebtsCsvPath(DEBTS_DIR);
}

function parseSourceAccountsColumn(raw: string): AccountName[] {
  return raw
    .split(';')
    .map(t => t.trim())
    .filter((t): t is AccountName => t.length > 0 && isValidAccountName(t));
}

function serializeSourceAccounts(accounts: readonly AccountName[]): string {
  return accounts.join(';');
}

function rowToDebt(row: DebtRowShape): Debt {
  return {
    id: row.id,
    name: row.name,
    merchantPattern: row.merchant_pattern,
    sourceAccounts: parseSourceAccountsColumn(row.source_accounts),
    originalLoanAmount: round2(row.original_loan_amount),
    originalLoanDate: row.original_loan_date,
    openingBalance: round2(row.opening_balance),
    openingBalanceDate: row.opening_balance_date,
    archived: row.archived === 1,
    updatedAt: row.updated_at,
  };
}

function assertValidDebtInput(input: DebtCreateInput | (DebtUpdateInput & { id?: string })): void {
  if ('id' in input && input.id !== undefined) {
    if (typeof input.id !== 'string' || input.id.trim() === '') {
      throw new Error('Debt id must be a non-empty string');
    }
    if (!/^[a-z0-9][a-z0-9-]*$/.test(input.id)) {
      throw new Error('Debt id must be a lowercase slug (a-z, 0-9, hyphens)');
    }
  }
  if (input.name !== undefined && input.name.trim() === '') {
    throw new Error('Debt name must be non-empty');
  }
  if (input.merchantPattern !== undefined && input.merchantPattern.trim() === '') {
    throw new Error('Debt merchantPattern must be non-empty');
  }
  if (input.sourceAccounts !== undefined) {
    if (!Array.isArray(input.sourceAccounts) || input.sourceAccounts.length === 0) {
      throw new Error('Debt must have at least one source account');
    }
    for (const a of input.sourceAccounts) {
      if (!isValidAccountName(a)) {
        throw new Error(`Invalid source account: ${a}`);
      }
    }
  }
  if (input.originalLoanAmount !== undefined) {
    if (!Number.isFinite(input.originalLoanAmount) || input.originalLoanAmount <= 0) {
      throw new Error('originalLoanAmount must be > 0');
    }
  }
  if (input.openingBalance !== undefined) {
    if (!Number.isFinite(input.openingBalance) || input.openingBalance < 0) {
      throw new Error('openingBalance must be >= 0');
    }
  }
  if (input.openingBalanceDate !== undefined && !ISO_DATE_RE.test(input.openingBalanceDate)) {
    throw new Error('openingBalanceDate must be YYYY-MM-DD');
  }
  if (
    input.originalLoanDate !== undefined &&
    input.originalLoanDate !== null &&
    !ISO_DATE_RE.test(input.originalLoanDate)
  ) {
    throw new Error('originalLoanDate must be YYYY-MM-DD or null');
  }
}

/**
 * Replace DB debts from CSV (file is source of truth on startup).
 */
export function loadDebtsFromFileIntoDb(): void {
  const db = getDb();
  ensureDebtsCsvWithDefaults(csvPath());
  const rows = readDebtsFromCsvFile(csvPath());
  db.prepare('DELETE FROM debts').run();
  const insert = db.prepare(`
    INSERT INTO debts (
      id, name, merchant_pattern, source_accounts,
      original_loan_amount, original_loan_date,
      opening_balance, opening_balance_date,
      archived, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);
  const run = db.transaction((list: readonly DebtCsvRow[]) => {
    for (const r of list) {
      insert.run(
        r.id,
        r.name,
        r.merchantPattern,
        serializeSourceAccounts(r.sourceAccounts),
        r.originalLoanAmount,
        r.originalLoanDate,
        r.openingBalance,
        r.openingBalanceDate,
        r.archived ? 1 : 0,
      );
    }
  });
  run(rows);
  console.log(`[Database] Loaded ${rows.length} debt row(s) from CSV`);
}

/**
 * Export all DB rows to CSV (after mutations). Atomic rewrite.
 */
export function exportDebtsFromDbToFile(): void {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, name, merchant_pattern, source_accounts,
              original_loan_amount, original_loan_date,
              opening_balance, opening_balance_date,
              archived, updated_at
       FROM debts
       ORDER BY id`,
    )
    .all() as DebtRowShape[];
  const csvRows: DebtCsvRow[] = rows.map(r => ({
    id: r.id,
    name: r.name,
    merchantPattern: r.merchant_pattern,
    sourceAccounts: parseSourceAccountsColumn(r.source_accounts),
    originalLoanAmount: round2(r.original_loan_amount),
    originalLoanDate: r.original_loan_date,
    openingBalance: round2(r.opening_balance),
    openingBalanceDate: r.opening_balance_date,
    archived: r.archived === 1,
  }));
  writeDebtsToCsvFile(csvPath(), csvRows);
}

export function listDebts(opts: { includeArchived?: boolean } = {}): Debt[] {
  const db = getDb();
  const sql = opts.includeArchived
    ? `SELECT id, name, merchant_pattern, source_accounts,
              original_loan_amount, original_loan_date,
              opening_balance, opening_balance_date,
              archived, updated_at
       FROM debts
       ORDER BY archived ASC, name ASC`
    : `SELECT id, name, merchant_pattern, source_accounts,
              original_loan_amount, original_loan_date,
              opening_balance, opening_balance_date,
              archived, updated_at
       FROM debts
       WHERE archived = 0
       ORDER BY name ASC`;
  const rows = db.prepare(sql).all() as DebtRowShape[];
  return rows.map(rowToDebt);
}

export function getDebt(id: string): Debt | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, name, merchant_pattern, source_accounts,
              original_loan_amount, original_loan_date,
              opening_balance, opening_balance_date,
              archived, updated_at
       FROM debts
       WHERE id = ?`,
    )
    .get(id) as DebtRowShape | undefined;
  return row ? rowToDebt(row) : null;
}

interface MatchAggregates {
  paidSinceOpening: number;
  lastPaymentDate: string | null;
  matchedTransactionCount: number;
}

interface LastPayment {
  date: string;
  amount: number;
}

function computeAggregates(debt: Debt): MatchAggregates {
  if (debt.sourceAccounts.length === 0) {
    return { paidSinceOpening: 0, lastPaymentDate: null, matchedTransactionCount: 0 };
  }
  const db = getDb();
  const placeholders = debt.sourceAccounts.map(() => '?').join(',');
  const sql = `
    SELECT
      COALESCE(SUM(ABS(amount)), 0) AS paid_since_opening,
      MAX(date) AS last_date,
      COUNT(*) AS n
    FROM transactions
    WHERE type = 'expense'
      AND account IN (${placeholders})
      AND description LIKE ?
      AND date > ?
  `;
  const likePattern = `%${debt.merchantPattern}%`;
  const row = db
    .prepare(sql)
    .get(...debt.sourceAccounts, likePattern, debt.openingBalanceDate) as {
    paid_since_opening: number;
    last_date: string | null;
    n: number;
  };
  return {
    paidSinceOpening: round2(row.paid_since_opening),
    lastPaymentDate: row.last_date,
    matchedTransactionCount: row.n,
  };
}

function fetchLastPayment(debt: Debt): LastPayment | null {
  if (debt.sourceAccounts.length === 0) return null;
  const db = getDb();
  const placeholders = debt.sourceAccounts.map(() => '?').join(',');
  const sql = `
    SELECT date, amount
    FROM transactions
    WHERE type = 'expense'
      AND account IN (${placeholders})
      AND description LIKE ?
      AND date > ?
    ORDER BY date DESC
    LIMIT 1
  `;
  const likePattern = `%${debt.merchantPattern}%`;
  const row = db
    .prepare(sql)
    .get(...debt.sourceAccounts, likePattern, debt.openingBalanceDate) as
    | { date: string; amount: number }
    | undefined;
  if (!row) return null;
  return { date: row.date, amount: round2(Math.abs(row.amount)) };
}

export function getDebtSummary(debt: Debt): DebtSummary {
  const agg = computeAggregates(debt);
  const last = fetchLastPayment(debt);
  const currentBalance = round2(Math.max(0, debt.openingBalance - agg.paidSinceOpening));
  const paidTowardsPrincipal = debt.originalLoanAmount - currentBalance;
  const payoffProgress = debt.originalLoanAmount > 0
    ? Math.max(0, Math.min(1, paidTowardsPrincipal / debt.originalLoanAmount))
    : 0;
  return {
    ...debt,
    currentBalance,
    paidSinceOpening: agg.paidSinceOpening,
    lastPaymentDate: last ? last.date : agg.lastPaymentDate,
    lastPaymentAmount: last ? last.amount : null,
    matchedTransactionCount: agg.matchedTransactionCount,
    payoffProgress,
  };
}

export function getAllDebtSummaries(opts: { includeArchived?: boolean } = {}): {
  debts: DebtSummary[];
  totalOutstanding: number;
} {
  const debts = listDebts({ includeArchived: opts.includeArchived });
  const summaries = debts.map(d => getDebtSummary(d));
  const totalOutstanding = round2(
    summaries.filter(s => !s.archived).reduce((sum, s) => sum + s.currentBalance, 0),
  );
  return { debts: summaries, totalOutstanding };
}

export function createDebt(input: DebtCreateInput): Debt {
  assertValidDebtInput(input);
  const db = getDb();
  const existing = db.prepare('SELECT 1 FROM debts WHERE id = ?').get(input.id);
  if (existing) {
    throw new Error(`Debt with id "${input.id}" already exists`);
  }
  db.prepare(
    `
    INSERT INTO debts (
      id, name, merchant_pattern, source_accounts,
      original_loan_amount, original_loan_date,
      opening_balance, opening_balance_date,
      archived, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, datetime('now'))
  `,
  ).run(
    input.id,
    input.name.trim(),
    input.merchantPattern.trim(),
    serializeSourceAccounts(input.sourceAccounts),
    input.originalLoanAmount,
    input.originalLoanDate ?? null,
    input.openingBalance,
    input.openingBalanceDate,
  );
  const debt = getDebt(input.id);
  if (!debt) throw new Error('Failed to create debt');
  exportDebtsFromDbToFile();
  return debt;
}

export function updateDebt(id: string, patch: DebtUpdateInput): Debt {
  const existing = getDebt(id);
  if (!existing) {
    throw new Error(`Debt with id "${id}" not found`);
  }
  assertValidDebtInput(patch);

  const next: Debt = {
    ...existing,
    name: patch.name !== undefined ? patch.name.trim() : existing.name,
    merchantPattern:
      patch.merchantPattern !== undefined ? patch.merchantPattern.trim() : existing.merchantPattern,
    sourceAccounts: patch.sourceAccounts ?? existing.sourceAccounts,
    originalLoanAmount: patch.originalLoanAmount ?? existing.originalLoanAmount,
    originalLoanDate:
      patch.originalLoanDate !== undefined ? patch.originalLoanDate : existing.originalLoanDate,
    openingBalance: patch.openingBalance ?? existing.openingBalance,
    openingBalanceDate: patch.openingBalanceDate ?? existing.openingBalanceDate,
    archived: patch.archived ?? existing.archived,
  };

  const db = getDb();
  db.prepare(
    `
    UPDATE debts SET
      name = ?,
      merchant_pattern = ?,
      source_accounts = ?,
      original_loan_amount = ?,
      original_loan_date = ?,
      opening_balance = ?,
      opening_balance_date = ?,
      archived = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `,
  ).run(
    next.name,
    next.merchantPattern,
    serializeSourceAccounts(next.sourceAccounts),
    next.originalLoanAmount,
    next.originalLoanDate,
    next.openingBalance,
    next.openingBalanceDate,
    next.archived ? 1 : 0,
    id,
  );
  const debt = getDebt(id);
  if (!debt) throw new Error('Failed to update debt');
  exportDebtsFromDbToFile();
  return debt;
}

export function archiveDebt(id: string): Debt {
  return updateDebt(id, { archived: true });
}

export function setOpeningDebtBalance(id: string, balance: number, date: string): Debt {
  return updateDebt(id, { openingBalance: balance, openingBalanceDate: date });
}

/**
 * Return the ISO (YYYY-MM-DD) date one calendar day before the given ISO date.
 * Uses UTC arithmetic so we never cross a day boundary due to host TZ.
 */
function subtractOneDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Shift each debt's `openingBalanceDate` back to one day before its earliest
 * matching transaction, bumping `openingBalance` upward by the sum of matches
 * that fell on or before the previous opening date. The arithmetic is exactly
 * balance-preserving (see plan), so `currentBalance` is unchanged while every
 * historical match now lives inside the post-opening window — which means
 * `paidSinceOpening`, `matchedTransactionCount`, and `lastPayment*` populate
 * correctly.
 *
 * Idempotent: once shifted, subsequent runs find zero pre-opening matches and
 * leave the row alone. Safe to run on every startup; also re-runs naturally
 * pull the date back further if older transactions are imported later.
 *
 * Re-exports `debts.csv` once at the end if any rows were shifted.
 */
export function reconcileDebtOpeningDates(): void {
  const db = getDb();
  const debts = listDebts({ includeArchived: true });
  let shifted = 0;
  for (const debt of debts) {
    if (debt.sourceAccounts.length === 0) continue;
    const placeholders = debt.sourceAccounts.map(() => '?').join(',');
    const row = db
      .prepare(
        `SELECT MIN(date) AS earliest,
                COALESCE(SUM(ABS(amount)), 0) AS paid_on_or_before
         FROM transactions
         WHERE type = 'expense'
           AND account IN (${placeholders})
           AND description LIKE ?
           AND date <= ?`,
      )
      .get(...debt.sourceAccounts, `%${debt.merchantPattern}%`, debt.openingBalanceDate) as {
      earliest: string | null;
      paid_on_or_before: number;
    };
    if (!row.earliest) continue;
    if (row.paid_on_or_before <= 0) continue;
    const newDate = subtractOneDay(row.earliest);
    const newBalance = round2(debt.openingBalance + row.paid_on_or_before);
    db.prepare(
      `UPDATE debts
         SET opening_balance = ?, opening_balance_date = ?, updated_at = datetime('now')
       WHERE id = ?`,
    ).run(newBalance, newDate, debt.id);
    shifted++;
  }
  if (shifted > 0) {
    exportDebtsFromDbToFile();
    console.log(`[Database] Reconciled opening dates for ${shifted} debt(s)`);
  }
}
