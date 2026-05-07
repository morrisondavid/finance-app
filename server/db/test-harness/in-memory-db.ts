/**
 * Shared in-memory SQLite test harness.
 *
 * Every obligations/tax/debts/deadlines integration test needs the same
 * ingredients:
 *   - an in-memory `better-sqlite3` database,
 *   - every domain table (`transactions`, `financial_obligations`,
 *     `obligation_dismissals`, `deadlines`, `debts`) created up-front,
 *   - a temp folder per CSV-backed domain (obligations, deadlines, debts).
 *
 * Centralising the schema + temp-dir creation here keeps every test file
 * to ~5 lines of setup, guarantees all tests see the same table shapes,
 * and gives us one place to add columns when the real schema evolves.
 *
 * Typical usage:
 * ```ts
 * import { createInMemoryTestDb } from '../test-harness/in-memory-db.js';
 * const harness = createInMemoryTestDb();
 * vi.mock('../connection.js', () => ({
 *   getDb: () => harness.db,
 *   OBLIGATIONS_DIR: harness.obligationsDir,
 *   DEADLINES_DIR: harness.deadlinesDir,
 *   DEBTS_DIR: harness.debtsDir,
 * }));
 * ```
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';

export interface TestDbHandles {
  /** Live in-memory SQLite instance with every domain table already created. */
  db: Database.Database;
  /** Temp folder suitable for stand-in `OBLIGATIONS_DIR`. */
  obligationsDir: string;
  /** Temp folder suitable for stand-in `DEADLINES_DIR`. */
  deadlinesDir: string;
  /** Temp folder suitable for stand-in `DEBTS_DIR`. */
  debtsDir: string;
  /**
   * Close the DB and delete every temp folder created by this handle.
   * Safe to call more than once — subsequent calls are no-ops.
   */
  cleanup: () => void;
}

/**
 * Create a fresh in-memory SQLite instance with every domain table, plus
 * three temp folders for CSV-backed stores. The caller is responsible for
 * invoking `handles.cleanup()` in `afterAll`.
 */
export function createInMemoryTestDb(): TestDbHandles {
  const db = new Database(':memory:');
  createAllDomainTables(db);

  const obligationsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bsa-test-obligations-'));
  const deadlinesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bsa-test-deadlines-'));
  const debtsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bsa-test-debts-'));

  let cleanedUp = false;
  const cleanup = (): void => {
    if (cleanedUp) return;
    cleanedUp = true;
    try { db.close(); } catch { /* ignore */ }
    for (const dir of [obligationsDir, deadlinesDir, debtsDir]) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };

  return { db, obligationsDir, deadlinesDir, debtsDir, cleanup };
}

/**
 * Delete every row from every domain table. Intended for per-test resets
 * when a test suite wants a pristine DB between `it(...)` blocks without
 * paying the cost of rebuilding the schema each time.
 */
export function resetTestData(db: Database.Database): void {
  db.exec(`
    DELETE FROM transactions;
    DELETE FROM financial_obligations;
    DELETE FROM obligation_dismissals;
    DELETE FROM deadlines;
    DELETE FROM debts;
  `);
}

/**
 * Create every domain table in one place. Kept in sync with the real
 * schema in `server/db/connection.ts` — when a column is added there, it
 * must also be added here (and vice versa).
 */
function createAllDomainTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash TEXT UNIQUE NOT NULL,
      date TEXT NOT NULL,
      description TEXT NOT NULL,
      amount REAL NOT NULL,
      account TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('income', 'expense', 'transfer')),
      linked_transaction_id INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

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
      notes TEXT,
      person_id TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS obligation_dismissals (
      obligation_id TEXT PRIMARY KEY,
      reason TEXT,
      dismissed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

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

    CREATE TABLE IF NOT EXISTS account_balances (
      account TEXT PRIMARY KEY,
      opening_balance REAL NOT NULL DEFAULT 0,
      opening_balance_date TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS category_budgets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account TEXT NOT NULL,
      category TEXT NOT NULL,
      amount REAL NOT NULL CHECK(amount >= 0),
      budget_period TEXT NOT NULL DEFAULT 'monthly',
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(account, category)
    );

    CREATE TABLE IF NOT EXISTS fixed_expense_simulation_exclusions (
      line_key TEXT PRIMARY KEY NOT NULL
    );

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
  `);
}
