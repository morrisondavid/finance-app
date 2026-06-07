import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import type { Transaction } from '../types.js';
import { formatDateISO } from '../../shared/date-format.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DB_PATH = path.join(__dirname, '../../data/transactions.db');
export const STATEMENTS_DIR = path.join(__dirname, '../../statements');
/** Canonical category budgets CSV lives here (see budgets-csv.ts). */
export const BUDGETS_DIR = path.join(__dirname, '../../budgets');
/**
 * Single source of truth for every obligations artefact:
 *  - `obligations-seed.csv` — bootstrap rows committed to git.
 *  - `obligations.csv` — user-editable rows (merged with seed at registry build).
 *  - `obligation-state.csv` — per-occurrence paid/confirmed state.
 *  - `obligation-dismissals.csv` — hidden auto-seeded slots.
 *
 * See {@link server/domain/obligations/registry.ts} +
 * {@link server/domain/obligations/obligation-state.ts}.
 */
export const OBLIGATIONS_DIR = path.join(__dirname, '../../obligations');
/** Canonical debts CSV lives here (see debts-csv.ts). */
export const DEBTS_DIR = path.join(__dirname, '../../debts');
/**
 * Canonical deadlines CSV lives here (see deadlines-csv.ts).
 *
 * A Deadline is a non-financial reminder with a due date (Companies
 * House confirmation statement, MOT renewal, insurance cert expiry, …).
 * It lives in its own folder for the same reason `obligations/`,
 * `debts/`, and `budgets/` do — one folder per domain aggregate root
 * keeps the mental model clean.
 */
export const DEADLINES_DIR = path.join(__dirname, '../../deadlines');
/** Canonical net-worth snapshots CSV (`net-worth-snapshots.csv`). §3.1 */
export const NET_WORTH_DIR = path.join(__dirname, '../../net-worth');

let db: Database.Database;

/**
 * Get the database instance
 */
export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initConnection() first.');
  }
  return db;
}

/**
 * Initialize the database connection
 */
export function initConnection(): void {
  // Ensure data directory exists
  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // Open database connection
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  // Enables `column REGEXP pattern` in queries (used for merchant drill-down word boundaries).
  db.function(
    'regexp',
    { deterministic: true },
    (pattern: unknown, text: unknown) => {
      if (typeof pattern !== 'string' || typeof text !== 'string') return 0;
      try {
        // SQLite passes the pattern string from SQL; JS does not support (?i) the same way — use flag `i`.
        const body = pattern.replace(/^\(\?i\)/, '');
        return new RegExp(body, 'i').test(text) ? 1 : 0;
      } catch {
        return 0;
      }
    },
  );
}

/**
 * Close the database connection
 */
export function closeConnection(): void {
  if (db) {
    db.close();
  }
}

/**
 * Normalize a description for hashing
 * - Lowercase
 * - Trim leading/trailing whitespace
 * - Collapse multiple spaces/tabs to single space
 */
export function normalizeDescription(desc: string): string {
  return desc
    .toLowerCase()
    .trim()
    .replace(/[\t\s]+/g, ' ');
}

/**
 * Generate a unique hash for a transaction to detect duplicates.
 * When `externalId` is set (Monzo Transaction ID, etc.), identity is id + signed amount
 * so FX debit/credit legs with the same id are not collapsed.
 */
export function generateTransactionHash(t: Transaction): string {
  const externalId = t.externalId?.trim();
  if (externalId !== undefined && externalId !== '') {
    const key = `${t.account}|externalId:${externalId}|${t.amount.toFixed(2)}`;
    return crypto.createHash('md5').update(key).digest('hex');
  }
  const dateStr = formatDateISO(t.date);
  const descNormalized = normalizeDescription(t.description);
  // Occurrence should always be set (1 for non-duplicates), but default to 1 for safety
  const occurrence = (t.occurrence !== undefined && t.occurrence !== null) ? t.occurrence : 1;
  const key = `${t.account}|${dateStr}|${t.amount.toFixed(2)}|${descNormalized}|${occurrence}`;
  return crypto.createHash('md5').update(key).digest('hex');
}

/**
 * Initialize the database - creates tables and indexes
 * Note: account_balances table persists across reinits to preserve user-set opening balances
 */
export function initSchema(): void {
  db.exec(`
    DROP TABLE IF EXISTS transactions;
    DROP TABLE IF EXISTS processed_files;
    
    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash TEXT UNIQUE NOT NULL,
      date TEXT NOT NULL,
      description TEXT NOT NULL,
      amount REAL NOT NULL,
      account TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('income', 'expense', 'transfer')),
      linked_transaction_id INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (linked_transaction_id) REFERENCES transactions(id)
    );
    
    CREATE INDEX idx_transactions_date ON transactions(date);
    CREATE INDEX idx_transactions_account ON transactions(account);
    CREATE INDEX idx_transactions_type ON transactions(type);
    CREATE INDEX idx_transactions_hash ON transactions(hash);
    CREATE INDEX idx_transactions_amount ON transactions(amount);
    CREATE INDEX idx_transactions_type_date ON transactions(type, date);
    
    CREATE TABLE processed_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      account TEXT NOT NULL,
      transaction_count INTEGER NOT NULL,
      processed_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    
    -- Account balances table (persists across reinits)
    CREATE TABLE IF NOT EXISTS account_balances (
      account TEXT PRIMARY KEY,
      opening_balance REAL NOT NULL DEFAULT 0,
      opening_balance_date TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- category_budgets: one row per (account, category). amount = monthly cap or FY yearly cap; budget_period disambiguates.
    CREATE TABLE IF NOT EXISTS category_budgets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account TEXT NOT NULL,
      category TEXT NOT NULL,
      amount REAL NOT NULL CHECK(amount >= 0),
      budget_period TEXT NOT NULL DEFAULT 'monthly',
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(account, category)
    );

    CREATE INDEX IF NOT EXISTS idx_category_budgets_account
      ON category_budgets(account);

    -- warning_snapshots: one row per warning at the time the consolidated
    -- /api/warnings/entity-foundation route is read. Lets the
    -- 1.8 improvement-feedback emitter diff today warnings against an
    -- earlier snapshot and surface warning-cleared / warning-improved
    -- entries when risk drops over time.
    CREATE TABLE IF NOT EXISTS warning_snapshots (
      snapshot_at TEXT NOT NULL,
      warning_id TEXT NOT NULL,
      code TEXT NOT NULL,
      severity TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      entity_id TEXT,
      title TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_warning_snapshots_snapshot_at
      ON warning_snapshots(snapshot_at);
    CREATE INDEX IF NOT EXISTS idx_warning_snapshots_fingerprint
      ON warning_snapshots(fingerprint);

    -- §2.3 — per-fingerprint snooze / ack (single local user; fingerprint matches warning_snapshots.fingerprint)
    CREATE TABLE IF NOT EXISTS warning_user_state (
      fingerprint TEXT PRIMARY KEY NOT NULL,
      snoozed_until TEXT,
      acknowledged_at TEXT,
      surface TEXT CHECK(surface IS NULL OR surface IN ('dashboard', 'agent', 'both')),
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- debts: external creditors (loans, finance agreements) we don't have
    -- statement feeds for. Canonical source is debts/debts.csv; this table is
    -- reloaded from CSV on startup and re-exported to CSV on every mutation.
    CREATE TABLE IF NOT EXISTS debts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      merchant_pattern TEXT NOT NULL,
      source_accounts TEXT NOT NULL,
      original_loan_amount REAL NOT NULL CHECK(original_loan_amount > 0),
      original_loan_date TEXT,
      opening_balance REAL NOT NULL DEFAULT 0 CHECK(opening_balance >= 0),
      opening_balance_date TEXT NOT NULL,
      match_amounts TEXT NOT NULL DEFAULT '',
      match_tolerance_pct REAL NOT NULL DEFAULT 0 CHECK(match_tolerance_pct >= 0 AND match_tolerance_pct < 1),
      kind TEXT NOT NULL DEFAULT 'consumer' CHECK(kind IN ('consumer', 'mortgage')),
      interest_rate REAL,
      fixed_rate_end_date TEXT,
      repayment_type TEXT CHECK(repayment_type IS NULL OR repayment_type IN ('repayment', 'interest-only')),
      property_value_estimate REAL,
      property_id TEXT,
      archived INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_debts_archived ON debts(archived);
  `);

  console.log('[Database] Schema initialized');
}

/**
 * One-time shape change: drop financial_year; one row per (account, category).
 * Keeps the row with the largest id per pair (most recently added).
 */
export function migrateCategoryBudgetsIfNeeded(): void {
  const db = getDb();
  const cols = db.prepare(`PRAGMA table_info('category_budgets')`).all() as Array<{ name: string }>;
  if (cols.length === 0) return;
  const hasFy = cols.some(c => c.name === 'financial_year');
  if (!hasFy) return;

  db.exec(`
    CREATE TABLE category_budgets__new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account TEXT NOT NULL,
      category TEXT NOT NULL,
      amount REAL NOT NULL CHECK(amount >= 0),
      budget_period TEXT NOT NULL DEFAULT 'monthly',
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(account, category)
    );

    INSERT INTO category_budgets__new (account, category, amount, budget_period, updated_at)
    SELECT b.account, b.category, b.amount, 'monthly', b.updated_at
    FROM category_budgets b
    INNER JOIN (
      SELECT account, category, MAX(id) AS max_id
      FROM category_budgets
      GROUP BY account, category
    ) w ON b.account = w.account AND b.category = w.category AND b.id = w.max_id;

    DROP TABLE category_budgets;
    ALTER TABLE category_budgets__new RENAME TO category_budgets;

    CREATE INDEX IF NOT EXISTS idx_category_budgets_account ON category_budgets(account);
  `);
  console.log('[Database] Migrated category_budgets to permanent (account, category) rows');
}

/**
 * Convenience migration for developers who don't nuke their DB on pull. The
 * authoritative source for debts is `debts/debts.csv`; `rm data/transactions.db`
 * followed by a restart fully rebuilds the table with the updated schema.
 */
export function migrateDebtsMatchAmountsIfNeeded(): void {
  const db = getDb();
  const cols = db.prepare(`PRAGMA table_info('debts')`).all() as Array<{ name: string }>;
  if (cols.length === 0) return;
  const colNames = new Set(cols.map(c => c.name));
  if (colNames.has('match_amounts')) return;
  if (colNames.has('match_amount')) {
    db.exec(`ALTER TABLE debts ADD COLUMN match_amounts TEXT NOT NULL DEFAULT ''`);
    db.exec(`UPDATE debts SET match_amounts = CAST(match_amount AS TEXT) WHERE match_amount IS NOT NULL AND match_amount != ''`);
    console.log('[Database] Migrated debts.match_amount → debts.match_amounts');
  } else {
    db.exec(`ALTER TABLE debts ADD COLUMN match_amounts TEXT NOT NULL DEFAULT ''`);
    console.log('[Database] Added debts.match_amounts');
  }
}

/**
 * Add the per-debt fuzzy-match band column. Safe to call repeatedly.
 */
export function migrateDebtsMatchTolerancePctIfNeeded(): void {
  const db = getDb();
  const cols = db.prepare(`PRAGMA table_info('debts')`).all() as Array<{ name: string }>;
  if (cols.length === 0) return;
  const colNames = new Set(cols.map(c => c.name));
  if (colNames.has('match_tolerance_pct')) return;
  db.exec(
    `ALTER TABLE debts ADD COLUMN match_tolerance_pct REAL NOT NULL DEFAULT 0 ` +
      `CHECK(match_tolerance_pct >= 0 AND match_tolerance_pct < 1)`,
  );
  console.log('[Database] Added debts.match_tolerance_pct');
}

/**
 * Convenience migration for existing DBs: adds the six mortgage-related columns
 * (kind, interest_rate, fixed_rate_end_date, repayment_type,
 * property_value_estimate, property_id) to the debts table. Safe to call
 * repeatedly — skips if the columns already exist.
 */
export function migrateDebtsMortgageFieldsIfNeeded(): void {
  const db = getDb();
  const cols = db.prepare(`PRAGMA table_info('debts')`).all() as Array<{ name: string }>;
  if (cols.length === 0) return;
  const colNames = new Set(cols.map(c => c.name));
  if (colNames.has('kind')) return;
  db.exec(`
    ALTER TABLE debts ADD COLUMN kind TEXT NOT NULL DEFAULT 'consumer' CHECK(kind IN ('consumer', 'mortgage'));
    ALTER TABLE debts ADD COLUMN interest_rate REAL;
    ALTER TABLE debts ADD COLUMN fixed_rate_end_date TEXT;
    ALTER TABLE debts ADD COLUMN repayment_type TEXT CHECK(repayment_type IS NULL OR repayment_type IN ('repayment', 'interest-only'));
    ALTER TABLE debts ADD COLUMN property_value_estimate REAL;
    ALTER TABLE debts ADD COLUMN property_id TEXT;
  `);
  console.log('[Database] Added mortgage fields to debts table');
}

/** Add budget_period column for DBs created before monthly/yearly budgets. */
export function migrateCategoryBudgetsBudgetPeriodIfNeeded(): void {
  const db = getDb();
  const cols = db.prepare(`PRAGMA table_info('category_budgets')`).all() as Array<{ name: string }>;
  if (cols.length === 0) return;
  if (cols.some(c => c.name === 'budget_period')) return;
  db.exec(`ALTER TABLE category_budgets ADD COLUMN budget_period TEXT NOT NULL DEFAULT 'monthly'`);
  console.log('[Database] Added category_budgets.budget_period');
}

/** Fixed Expenses tab: persisted simulation excludes (line_key from overview payload). */
export function migrateFixedExpenseSimulationExclusionsIfNeeded(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS fixed_expense_simulation_exclusions (
      line_key TEXT PRIMARY KEY NOT NULL
    );
  `);
}

export function migrateObligationsIfNeeded(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS financial_obligations (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      entity TEXT NOT NULL,
      frequency TEXT NOT NULL,
      expected_amount REAL,
      naive_amount REAL,
      adjustment_basis TEXT,
      adjustment_source TEXT,
      due_date TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      paid_amount REAL,
      paid_date TEXT,
      paid_from_account TEXT,
      paid_from_tx_hash TEXT,
      notes TEXT,
      person_id TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const columns = db.prepare("PRAGMA table_info(financial_obligations)").all() as Array<{ name: string }>;
  // Backfill column on databases created before Self Assessment support.
  if (!columns.some(c => c.name === 'person_id')) {
    db.exec('ALTER TABLE financial_obligations ADD COLUMN person_id TEXT');
  }
  // Rename the pre-existing `recurrence` column to `frequency`. The canonical
  // term for how often something repeats is `frequency` across the entire
  // domain (obligations registry, UpcomingRecurring, RecurringExpense) — the
  // obligations table was the one holdout and the duplication caused real
  // bugs during the refactor. SQLite 3.25+ supports RENAME COLUMN directly.
  if (columns.some(c => c.name === 'recurrence') && !columns.some(c => c.name === 'frequency')) {
    db.exec('ALTER TABLE financial_obligations RENAME COLUMN recurrence TO frequency');
  }

  let cols = db.prepare('PRAGMA table_info(financial_obligations)').all() as Array<{ name: string }>;
  if (!cols.some(c => c.name === 'naive_amount')) {
    db.exec('ALTER TABLE financial_obligations ADD COLUMN naive_amount REAL');
    cols = db.prepare('PRAGMA table_info(financial_obligations)').all() as Array<{ name: string }>;
  }
  if (!cols.some(c => c.name === 'adjustment_basis')) {
    db.exec('ALTER TABLE financial_obligations ADD COLUMN adjustment_basis TEXT');
    cols = db.prepare('PRAGMA table_info(financial_obligations)').all() as Array<{ name: string }>;
  }
  if (!cols.some(c => c.name === 'adjustment_source')) {
    db.exec('ALTER TABLE financial_obligations ADD COLUMN adjustment_source TEXT');
    cols = db.prepare('PRAGMA table_info(financial_obligations)').all() as Array<{ name: string }>;
  }
  if (!cols.some(c => c.name === 'paid_from_tx_hash')) {
    db.exec('ALTER TABLE financial_obligations ADD COLUMN paid_from_tx_hash TEXT');
  }
}

/** Composite index for `type` + `date` filters (rolling expense windows, consolidated warnings). */
export function migrateTransactionsTypeDateIndexIfNeeded(): void {
  const db = getDb();
  const row = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_transactions_type_date'`)
    .get();
  if (row !== undefined) return;
  db.exec('CREATE INDEX IF NOT EXISTS idx_transactions_type_date ON transactions(type, date)');
  console.log('[Database] Added idx_transactions_type_date');
}

/**
 * Ensures the `deadlines` table exists. Canonical source is
 * `deadlines/deadlines.csv`; the SQLite table is a read-projection
 * rebuilt on startup by `loadDeadlinesFromCsv()` and re-exported to
 * CSV on every mutation via the deadlines repository.
 */
export function migrateDeadlinesIfNeeded(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS deadlines (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      due_date TEXT NOT NULL,
      recurrence TEXT NOT NULL,
      notes TEXT,
      url TEXT,
      completed_date TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_deadlines_due_date ON deadlines(due_date);
  `);
}

/**
 * Ensures the {@link obligation_dismissals} table exists. Keyed by the auto
 * row id (e.g. `auto-sa-david-2026-01-31`, `auto-vat-2025-05-01`) so the
 * auto-seeders can consult this set before inserting and skip any slot the
 * user has hidden. Survives the seeders' DELETE-and-rebuild cycle because
 * dismissals live in their own table.
 */
export function migrateObligationDismissalsIfNeeded(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS obligation_dismissals (
      obligation_id TEXT PRIMARY KEY,
      reason TEXT,
      dismissed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}
