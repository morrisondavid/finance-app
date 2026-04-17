import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import type { Transaction } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DB_PATH = path.join(__dirname, '../../data/transactions.db');
export const STATEMENTS_DIR = path.join(__dirname, '../../statements');
/** Canonical category budgets CSV lives here (see budgets-csv.ts). */
export const BUDGETS_DIR = path.join(__dirname, '../../budgets');

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
 * Format date as YYYY-MM-DD using local time (not UTC)
 * This avoids timezone issues where toISOString() shifts dates
 */
export function formatDateLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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
 * Generate a unique hash for a transaction to detect duplicates
 * Uses: account + date + amount + full normalized description + occurrence
 */
export function generateTransactionHash(t: Transaction): string {
  const dateStr = formatDateLocal(t.date);
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
  `);
  
  // Insert default opening balances if they don't exist
  db.prepare(`
    INSERT OR IGNORE INTO account_balances (account, opening_balance, opening_balance_date, updated_at)
    VALUES ('capital-on-tap', 30000, '2023-01-01', CURRENT_TIMESTAMP)
  `).run();
  db.prepare(`
    INSERT OR IGNORE INTO account_balances (account, opening_balance, opening_balance_date, updated_at)
    VALUES ('barclaycard', 9100, '2023-07-01', CURRENT_TIMESTAMP)
  `).run();
  db.prepare(`
    INSERT OR IGNORE INTO account_balances (account, opening_balance, opening_balance_date, updated_at)
    VALUES ('barclays-current', 475.05, '2023-12-29', CURRENT_TIMESTAMP)
  `).run();
  db.prepare(`
    INSERT INTO account_balances (account, opening_balance, opening_balance_date, updated_at)
    VALUES ('natwest', 3256.79, '2021-01-03', CURRENT_TIMESTAMP)
    ON CONFLICT(account) DO UPDATE SET
      opening_balance = excluded.opening_balance,
      opening_balance_date = excluded.opening_balance_date,
      updated_at = CURRENT_TIMESTAMP
  `).run();
  
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
