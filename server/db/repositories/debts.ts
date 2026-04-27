/**
 * Debts: external creditors (loans, finance agreements, mortgages) without
 * statement feeds. DB mirrors canonical CSV at debts/debts.csv; every mutation
 * re-exports the CSV so the file is always authoritative on disk. Derived
 * summaries (currentBalance, paidSinceOpening, payoffProgress) are computed
 * from the transactions table by matching the merchant substring +
 * source-account set. Mortgages use a static balance (interest-only payments
 * don't reduce principal).
 */

import { getDb, DEBTS_DIR } from '../connection.js';
import type { AccountName } from '../../types.js';
import { isValidAccountName } from '../../domain/accounts/index.js';
import { round2 } from '../../utils/math.js';
import {
  readDebtsFromCsvFile,
  writeDebtsToCsvFile,
  ensureDebtsCsvWithDefaults,
  getDebtsCsvPath,
  DEFAULT_DEBT_ROWS,
  type DebtCsvRow,
  type DebtKind,
  type RepaymentType,
} from '../debts-csv.js';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type { DebtKind, RepaymentType };

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
  /**
   * Payment amounts the matcher should recognise on the transaction feed.
   *
   * Convention:
   *   - `matchAmounts[0]` is the **current contractual monthly payment**.
   *     Read this for "what does this debt cost per month?" (leverage,
   *     runway, advisor maths). Never sum the array.
   *   - Subsequent entries are alternative values (post-rate-reset
   *     amount, partial fees, historical rate) that the matcher should
   *     also identify in the bank feed.
   *
   * Active (non-archived) debts must list at least one positive value;
   * the matcher uses {@link matchTolerancePct} for fuzzy bands.
   */
  matchAmounts: number[];
  /**
   * Fuzzy-match band as a fraction (0–1). When `> 0`, transactions whose
   * `|amount|` is within `matchAmount × (1 ± pct)` of any entry are
   * matched. Used for debts whose payment naturally drifts (e.g. Bounce
   * Back Loan: 6% interest on declining balance).
   */
  matchTolerancePct: number;
  kind: DebtKind;
  interestRate: number | null;
  fixedRateEndDate: string | null;
  repaymentType: RepaymentType | null;
  propertyValueEstimate: number | null;
  propertyId: string | null;
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
  matchAmounts?: number[];
  matchTolerancePct?: number;
  kind?: DebtKind;
  interestRate?: number | null;
  fixedRateEndDate?: string | null;
  repaymentType?: RepaymentType | null;
  propertyValueEstimate?: number | null;
  propertyId?: string | null;
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
  matchAmounts?: number[];
  matchTolerancePct?: number;
  kind?: DebtKind;
  interestRate?: number | null;
  fixedRateEndDate?: string | null;
  repaymentType?: RepaymentType | null;
  propertyValueEstimate?: number | null;
  propertyId?: string | null;
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
  match_amounts: string;
  match_tolerance_pct: number;
  kind: string;
  interest_rate: number | null;
  fixed_rate_end_date: string | null;
  repayment_type: string | null;
  property_value_estimate: number | null;
  property_id: string | null;
  archived: number;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// DRY: shared SQL column lists for SELECT / INSERT — one place to edit when
// columns are added.
// ---------------------------------------------------------------------------

const DEBT_COLUMNS = `id, name, merchant_pattern, source_accounts,
  original_loan_amount, original_loan_date,
  opening_balance, opening_balance_date,
  match_amounts, match_tolerance_pct,
  kind, interest_rate, fixed_rate_end_date,
  repayment_type, property_value_estimate, property_id,
  archived, updated_at`;

const DEBT_INSERT_COLS = `id, name, merchant_pattern, source_accounts,
  original_loan_amount, original_loan_date,
  opening_balance, opening_balance_date,
  match_amounts, match_tolerance_pct,
  kind, interest_rate, fixed_rate_end_date,
  repayment_type, property_value_estimate, property_id,
  archived, updated_at`;

const DEBT_INSERT_PLACEHOLDERS = `?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now')`;

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

function parseKind(raw: string): DebtKind {
  return raw === 'mortgage' ? 'mortgage' : 'consumer';
}

function parseRepaymentType(raw: string | null): RepaymentType | null {
  if (raw === 'repayment' || raw === 'interest-only') return raw;
  return null;
}

function parseMatchAmounts(raw: string): number[] {
  if (!raw || raw.trim() === '') return [];
  return raw.split(';').map(t => t.trim()).filter(t => t.length > 0).map(t => round2(Number(t)));
}

function serializeMatchAmounts(amounts: readonly number[]): string {
  return amounts.map(a => String(round2(a))).join(';');
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
    matchAmounts: parseMatchAmounts(row.match_amounts),
    matchTolerancePct: row.match_tolerance_pct ?? 0,
    kind: parseKind(row.kind),
    interestRate: row.interest_rate == null ? null : round2(row.interest_rate),
    fixedRateEndDate: row.fixed_rate_end_date,
    repaymentType: parseRepaymentType(row.repayment_type),
    propertyValueEstimate: row.property_value_estimate == null ? null : round2(row.property_value_estimate),
    propertyId: row.property_id,
    updatedAt: row.updated_at,
  };
}

function rowToCsvRow(r: DebtRowShape): DebtCsvRow {
  return {
    id: r.id,
    name: r.name,
    merchantPattern: r.merchant_pattern,
    sourceAccounts: parseSourceAccountsColumn(r.source_accounts),
    originalLoanAmount: round2(r.original_loan_amount),
    originalLoanDate: r.original_loan_date,
    openingBalance: round2(r.opening_balance),
    openingBalanceDate: r.opening_balance_date,
    archived: r.archived === 1,
    matchAmounts: parseMatchAmounts(r.match_amounts),
    matchTolerancePct: r.match_tolerance_pct ?? 0,
    kind: parseKind(r.kind),
    interestRate: r.interest_rate == null ? null : round2(r.interest_rate),
    fixedRateEndDate: r.fixed_rate_end_date,
    repaymentType: parseRepaymentType(r.repayment_type),
    propertyValueEstimate: r.property_value_estimate == null ? null : round2(r.property_value_estimate),
    propertyId: r.property_id,
  };
}

/**
 * Ordered parameter tuple matching {@link DEBT_INSERT_COLS} (minus the
 * trailing `datetime('now')` for `updated_at`).
 */
function csvRowToInsertParams(r: DebtCsvRow): (string | number | null)[] {
  return [
    r.id,
    r.name,
    r.merchantPattern,
    serializeSourceAccounts(r.sourceAccounts),
    r.originalLoanAmount,
    r.originalLoanDate,
    r.openingBalance,
    r.openingBalanceDate,
    serializeMatchAmounts(r.matchAmounts),
    r.matchTolerancePct,
    r.kind,
    r.interestRate,
    r.fixedRateEndDate,
    r.repaymentType,
    r.propertyValueEstimate,
    r.propertyId,
    r.archived ? 1 : 0,
  ];
}

/**
 * Build the shared `WHERE` clause used by every query that matches a debt's
 * transactions: account whitelist + description LIKE, plus the optional exact
 * amount filter. Callers append their own date clause and pass the returned
 * params first. `ROUND(..., 2)` avoids float-compare flakiness for the amount
 * filter; when `matchAmount` is null the clause degrades to the original
 * (account + description) shape so existing non-amount-disambiguated debts
 * behave identically.
 */
interface DebtMatchClause {
  sql: string;
  params: (string | number)[];
}

function buildDebtMatchClause(debt: Debt): DebtMatchClause {
  const placeholders = debt.sourceAccounts.map(() => '?').join(',');
  const params: (string | number)[] = [...debt.sourceAccounts, `%${debt.merchantPattern}%`];
  let sql = `type = 'expense' AND account IN (${placeholders}) AND description LIKE ?`;
  if (debt.matchAmounts.length === 0) {
    return { sql, params };
  }
  if (debt.matchTolerancePct === 0) {
    // Exact match: round both sides to 2dp and check membership.
    const amtPlaceholders = debt.matchAmounts.map(() => 'ROUND(?, 2)').join(',');
    sql += ` AND ROUND(ABS(amount), 2) IN (${amtPlaceholders})`;
    params.push(...debt.matchAmounts);
    return { sql, params };
  }
  // Fuzzy band: OR a `BETWEEN min AND max` per matchAmount. Each amount gets
  // its own ±tolerance window so tightly-spaced debts (bathroom A 232.22 vs
  // bathroom B 192.66 on the same merchant pattern) stay disambiguated even
  // with a non-zero tolerance.
  const tol = debt.matchTolerancePct;
  const ors = debt.matchAmounts.map(() => 'ABS(amount) BETWEEN ? AND ?').join(' OR ');
  sql += ` AND (${ors})`;
  for (const a of debt.matchAmounts) {
    params.push(round2(a * (1 - tol)));
    params.push(round2(a * (1 + tol)));
  }
  return { sql, params };
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
  if (input.matchAmounts !== undefined) {
    for (const a of input.matchAmounts) {
      if (!Number.isFinite(a) || a <= 0) {
        throw new Error('Every matchAmounts entry must be > 0');
      }
    }
    // For new (create) inputs, matchAmounts is required to be non-empty
    // when the debt isn't being explicitly archived. Updates leave it
    // alone if not supplied; createDebt always seeds with the provided
    // value (default `[]` historically). Enforce the active-row gate
    // here too.
    if ('id' in input && input.matchAmounts.length === 0) {
      const isArchived = 'archived' in input && input.archived === true;
      if (!isArchived) {
        throw new Error(
          'Active debts must have at least one positive matchAmounts entry. ' +
            'Set archived=true if the debt is no longer active.',
        );
      }
    }
  }
  if ('matchTolerancePct' in input && input.matchTolerancePct !== undefined) {
    const tol = input.matchTolerancePct;
    if (!Number.isFinite(tol) || tol < 0 || tol >= 1) {
      throw new Error('matchTolerancePct must be a number in [0, 1)');
    }
  }
  if ('interestRate' in input && input.interestRate !== undefined && input.interestRate !== null) {
    if (!Number.isFinite(input.interestRate) || input.interestRate <= 0) {
      throw new Error('interestRate must be > 0 or null');
    }
  }
  if ('fixedRateEndDate' in input && input.fixedRateEndDate !== undefined && input.fixedRateEndDate !== null) {
    if (!ISO_DATE_RE.test(input.fixedRateEndDate)) {
      throw new Error('fixedRateEndDate must be YYYY-MM-DD or null');
    }
  }
  if ('propertyValueEstimate' in input && input.propertyValueEstimate !== undefined && input.propertyValueEstimate !== null) {
    if (!Number.isFinite(input.propertyValueEstimate) || input.propertyValueEstimate <= 0) {
      throw new Error('propertyValueEstimate must be > 0 or null');
    }
  }
}

/**
 * Replace DB debts from CSV (file is source of truth on startup).
 *
 * Also self-heals by appending any `DEFAULT_DEBT_ROWS` whose id is absent from
 * the CSV. This lets new defaults land on existing installs without hand-
 * editing the file. Removing a default is done by archiving it (row stays in
 * the CSV with `archived=true`), which keeps the top-up a no-op.
 */
export function loadDebtsFromFileIntoDb(): void {
  const db = getDb();
  ensureDebtsCsvWithDefaults(csvPath());
  const rows = readDebtsFromCsvFile(csvPath());

  const existingIds = new Set(rows.map(r => r.id));
  const missingDefaults = DEFAULT_DEBT_ROWS.filter(d => !existingIds.has(d.id));
  const finalRows: DebtCsvRow[] = missingDefaults.length > 0 ? [...rows, ...missingDefaults] : rows;

  db.prepare('DELETE FROM debts').run();
  const insert = db.prepare(
    `INSERT INTO debts (${DEBT_INSERT_COLS}) VALUES (${DEBT_INSERT_PLACEHOLDERS})`,
  );
  const run = db.transaction((list: readonly DebtCsvRow[]) => {
    for (const r of list) {
      insert.run(...csvRowToInsertParams(r));
    }
  });
  run(finalRows);

  if (missingDefaults.length > 0) {
    exportDebtsFromDbToFile();
    console.log(
      `[Database] Loaded ${rows.length} debt row(s) from CSV; topped up ${missingDefaults.length} missing default(s): ${missingDefaults.map(d => d.id).join(', ')}`,
    );
  } else {
    console.log(`[Database] Loaded ${rows.length} debt row(s) from CSV`);
  }
}

/**
 * Export all DB rows to CSV (after mutations). Atomic rewrite.
 */
export function exportDebtsFromDbToFile(): void {
  const db = getDb();
  const rows = db
    .prepare(`SELECT ${DEBT_COLUMNS} FROM debts ORDER BY id`)
    .all() as DebtRowShape[];
  writeDebtsToCsvFile(csvPath(), rows.map(rowToCsvRow));
}

export function listDebts(opts: { includeArchived?: boolean } = {}): Debt[] {
  const db = getDb();
  const sql = opts.includeArchived
    ? `SELECT ${DEBT_COLUMNS} FROM debts ORDER BY archived ASC, name ASC`
    : `SELECT ${DEBT_COLUMNS} FROM debts WHERE archived = 0 ORDER BY name ASC`;
  const rows = db.prepare(sql).all() as DebtRowShape[];
  return rows.map(rowToDebt);
}

export function getDebt(id: string): Debt | null {
  const db = getDb();
  const row = db
    .prepare(`SELECT ${DEBT_COLUMNS} FROM debts WHERE id = ?`)
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
  const { sql: matchSql, params } = buildDebtMatchClause(debt);
  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(ABS(amount)), 0) AS paid_since_opening,
         MAX(date) AS last_date,
         COUNT(*) AS n
       FROM transactions
       WHERE ${matchSql}
         AND date > ?`,
    )
    .get(...params, debt.openingBalanceDate) as {
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
  const { sql: matchSql, params } = buildDebtMatchClause(debt);
  const row = db
    .prepare(
      `SELECT date, amount
       FROM transactions
       WHERE ${matchSql}
         AND date > ?
       ORDER BY date DESC
       LIMIT 1`,
    )
    .get(...params, debt.openingBalanceDate) as
    | { date: string; amount: number }
    | undefined;
  if (!row) return null;
  return { date: row.date, amount: round2(Math.abs(row.amount)) };
}

export function getDebtSummary(debt: Debt): DebtSummary {
  const agg = computeAggregates(debt);
  const last = fetchLastPayment(debt);

  // Mortgages use a static balance — interest-only payments don't reduce
  // principal, so subtracting paidSinceOpening would be incorrect.
  const currentBalance = debt.kind === 'mortgage'
    ? round2(debt.openingBalance)
    : round2(Math.max(0, debt.openingBalance - agg.paidSinceOpening));

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

export interface DebtSummariesResult {
  debts: DebtSummary[];
  consumerTotal: number;
  mortgageTotal: number;
  totalOutstanding: number;
  totalPropertyValue: number;
  netEquity: number;
}

export function getAllDebtSummaries(opts: { includeArchived?: boolean } = {}): DebtSummariesResult {
  const debts = listDebts({ includeArchived: opts.includeArchived });
  const summaries = debts.map(d => getDebtSummary(d));
  const active = summaries.filter(s => !s.archived);

  const consumerTotal = round2(
    active.filter(s => s.kind === 'consumer').reduce((sum, s) => sum + s.currentBalance, 0),
  );
  const mortgageTotal = round2(
    active.filter(s => s.kind === 'mortgage').reduce((sum, s) => sum + s.currentBalance, 0),
  );
  const totalOutstanding = round2(consumerTotal + mortgageTotal);
  const totalPropertyValue = round2(
    active
      .filter(s => s.kind === 'mortgage' && s.propertyValueEstimate != null)
      .reduce((sum, s) => sum + (s.propertyValueEstimate ?? 0), 0),
  );
  const netEquity = round2(totalPropertyValue - mortgageTotal);

  return { debts: summaries, consumerTotal, mortgageTotal, totalOutstanding, totalPropertyValue, netEquity };
}

export function createDebt(input: DebtCreateInput): Debt {
  assertValidDebtInput(input);
  const db = getDb();
  const existing = db.prepare('SELECT 1 FROM debts WHERE id = ?').get(input.id);
  if (existing) {
    throw new Error(`Debt with id "${input.id}" already exists`);
  }
  const matchAmounts = input.matchAmounts ?? [];
  if (matchAmounts.length === 0) {
    throw new Error(
      'Active debts must have at least one positive matchAmounts entry. ' +
        'Set archived=true after creation if the debt is no longer active.',
    );
  }
  const csvRow: DebtCsvRow = {
    id: input.id,
    name: input.name.trim(),
    merchantPattern: input.merchantPattern.trim(),
    sourceAccounts: input.sourceAccounts,
    originalLoanAmount: input.originalLoanAmount,
    originalLoanDate: input.originalLoanDate ?? null,
    openingBalance: input.openingBalance,
    openingBalanceDate: input.openingBalanceDate,
    archived: false,
    matchAmounts,
    matchTolerancePct: input.matchTolerancePct ?? 0,
    kind: input.kind ?? 'consumer',
    interestRate: input.interestRate ?? null,
    fixedRateEndDate: input.fixedRateEndDate ?? null,
    repaymentType: input.repaymentType ?? null,
    propertyValueEstimate: input.propertyValueEstimate ?? null,
    propertyId: input.propertyId ?? null,
  };
  db.prepare(
    `INSERT INTO debts (${DEBT_INSERT_COLS}) VALUES (${DEBT_INSERT_PLACEHOLDERS})`,
  ).run(...csvRowToInsertParams(csvRow));
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
    matchAmounts: patch.matchAmounts !== undefined ? patch.matchAmounts : existing.matchAmounts,
    matchTolerancePct:
      patch.matchTolerancePct !== undefined ? patch.matchTolerancePct : existing.matchTolerancePct,
    kind: patch.kind ?? existing.kind,
    interestRate: patch.interestRate !== undefined ? patch.interestRate : existing.interestRate,
    fixedRateEndDate: patch.fixedRateEndDate !== undefined ? patch.fixedRateEndDate : existing.fixedRateEndDate,
    repaymentType: patch.repaymentType !== undefined ? patch.repaymentType : existing.repaymentType,
    propertyValueEstimate: patch.propertyValueEstimate !== undefined ? patch.propertyValueEstimate : existing.propertyValueEstimate,
    propertyId: patch.propertyId !== undefined ? patch.propertyId : existing.propertyId,
  };

  if (!next.archived && next.matchAmounts.length === 0) {
    throw new Error(
      'Active debts must have at least one positive matchAmounts entry. ' +
        'Set archived=true if the debt is no longer active.',
    );
  }

  const db = getDb();
  db.prepare(
    `UPDATE debts SET
      name = ?, merchant_pattern = ?, source_accounts = ?,
      original_loan_amount = ?, original_loan_date = ?,
      opening_balance = ?, opening_balance_date = ?,
      match_amounts = ?, match_tolerance_pct = ?,
      kind = ?, interest_rate = ?, fixed_rate_end_date = ?,
      repayment_type = ?, property_value_estimate = ?, property_id = ?,
      archived = ?, updated_at = datetime('now')
    WHERE id = ?`,
  ).run(
    next.name,
    next.merchantPattern,
    serializeSourceAccounts(next.sourceAccounts),
    next.originalLoanAmount,
    next.originalLoanDate,
    next.openingBalance,
    next.openingBalanceDate,
    serializeMatchAmounts(next.matchAmounts),
    next.matchTolerancePct,
    next.kind,
    next.interestRate,
    next.fixedRateEndDate,
    next.repaymentType,
    next.propertyValueEstimate,
    next.propertyId,
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
    // Mortgage payments include interest, so adding historical payment totals
    // to the opening balance would inflate it. Mortgage opening dates/balances
    // are managed manually instead.
    if (debt.kind === 'mortgage') continue;
    const { sql: matchSql, params } = buildDebtMatchClause(debt);
    const row = db
      .prepare(
        `SELECT MIN(date) AS earliest,
                COALESCE(SUM(ABS(amount)), 0) AS paid_on_or_before
         FROM transactions
         WHERE ${matchSql}
           AND date <= ?`,
      )
      .get(...params, debt.openingBalanceDate) as {
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
