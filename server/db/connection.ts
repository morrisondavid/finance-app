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
 * - Take first 50 chars
 */
export function normalizeDescription(desc: string): string {
  return desc
    .toLowerCase()
    .trim()
    .replace(/[\t\s]+/g, ' ')  // Collapse tabs and multiple spaces to single space
    .substring(0, 50);
}

/**
 * Generate a unique hash for a transaction to detect duplicates
 * Uses: account + date + amount + normalized description (first 50 chars) + occurrence
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
  `);
  
  // Insert default opening balances if they don't exist
  db.prepare(`
    INSERT OR IGNORE INTO account_balances (account, opening_balance, opening_balance_date, updated_at)
    VALUES ('capital-on-tap', 30000, '2023-01-01', CURRENT_TIMESTAMP)
  `).run();
  db.prepare(`
    INSERT OR IGNORE INTO account_balances (account, opening_balance, opening_balance_date, updated_at)
    VALUES ('barclays-current', 475.05, '2023-12-29', CURRENT_TIMESTAMP)
  `).run();
  
  console.log('[Database] Schema initialized');
}
