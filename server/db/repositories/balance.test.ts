import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';

const hoisted = vi.hoisted(() => ({
  db: null as Database.Database | null,
}));

vi.mock('../connection.js', () => ({
  getDb: () => {
    if (!hoisted.db) throw new Error('test db not initialised');
    return hoisted.db;
  },
}));

import { getAccountBalance, setOpeningBalance } from './balance.js';
import type { AccountName } from '../../types.js';

const tmpOpeningCsv = path.join(os.tmpdir(), `opening-balances-${process.pid.toString()}.csv`);
const prevOpeningCsvEnv = process.env.BANK_STATEMENTS_OPENING_BALANCES_CSV;

const account: AccountName = 'barclays-current';

function createSchema(): void {
  hoisted.db!.exec(`
    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash TEXT UNIQUE NOT NULL,
      date TEXT NOT NULL,
      description TEXT NOT NULL,
      amount REAL NOT NULL,
      account TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('income', 'expense', 'transfer')),
      linked_transaction_id INTEGER
    );
    CREATE TABLE account_balances (
      account TEXT PRIMARY KEY,
      opening_balance REAL NOT NULL DEFAULT 0,
      opening_balance_date TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function insertTxn(row: {
  hash: string;
  date: string;
  description: string;
  amount: number;
  type: 'income' | 'expense' | 'transfer';
}): void {
  hoisted.db!.prepare(
    `INSERT INTO transactions (hash, date, description, amount, account, type)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(row.hash, row.date, row.description, row.amount, account, row.type);
}

describe('getAccountBalance', () => {
  beforeAll(() => {
    process.env.BANK_STATEMENTS_OPENING_BALANCES_CSV = tmpOpeningCsv;
    try {
      fs.unlinkSync(tmpOpeningCsv);
    } catch {
      /* absent is fine */
    }
    hoisted.db = new Database(':memory:');
    createSchema();
  });

  afterAll(() => {
    hoisted.db?.close();
    if (prevOpeningCsvEnv === undefined) {
      delete process.env.BANK_STATEMENTS_OPENING_BALANCES_CSV;
    } else {
      process.env.BANK_STATEMENTS_OPENING_BALANCES_CSV = prevOpeningCsvEnv;
    }
    try {
      fs.unlinkSync(tmpOpeningCsv);
    } catch {
      /* ignore */
    }
  });

  beforeEach(() => {
    hoisted.db!.exec('DELETE FROM transactions; DELETE FROM account_balances;');
  });

  describe('opening_balance_date window', () => {
    it('sums only transactions on or after opening_balance_date', () => {
      setOpeningBalance(account, 1000, '2024-01-01');
      insertTxn({ hash: 'a', date: '2023-12-31', description: 'old', amount: -100, type: 'expense' });
      insertTxn({ hash: 'b', date: '2024-01-01', description: 'on', amount: 50, type: 'income' });
      insertTxn({ hash: 'c', date: '2024-06-01', description: 'later', amount: -20, type: 'expense' });

      const b = getAccountBalance(account);
      expect(b.transactionTotal).toBe(30);
      expect(b.currentBalance).toBe(1030);
      expect(b.oldestTransaction).toBe('2024-01-01');
      expect(b.newestTransaction).toBe('2024-06-01');
      expect(b.transactionCount).toBe(2);
    });

    it('when no account_balances row exists, sums all transactions', () => {
      insertTxn({ hash: 'a', date: '2023-12-31', description: 'old', amount: -100, type: 'expense' });
      insertTxn({ hash: 'b', date: '2024-01-01', description: 'on', amount: 50, type: 'income' });

      const b = getAccountBalance(account);
      expect(b.openingBalance).toBe(0);
      expect(b.openingBalanceDate).toBeNull();
      expect(b.transactionTotal).toBe(-50);
      expect(b.currentBalance).toBe(-50);
      expect(b.transactionCount).toBe(2);
    });

    it('intersects financial year with opening date window', () => {
      setOpeningBalance(account, 1000, '2024-01-01');
      insertTxn({ hash: 'a', date: '2024-01-01', description: 'before fy', amount: 100, type: 'income' });
      insertTxn({ hash: 'b', date: '2024-06-01', description: 'in fy', amount: -50, type: 'expense' });
      insertTxn({ hash: 'c', date: '2025-03-01', description: 'in fy', amount: -25, type: 'expense' });
      insertTxn({ hash: 'd', date: '2025-05-01', description: 'after fy', amount: -10, type: 'expense' });

      const b = getAccountBalance(account, { financialYear: '2024/25' });
      expect(b.transactionTotal).toBe(-75);
      expect(b.currentBalance).toBe(925);
      expect(b.transactionCount).toBe(2);
      expect(b.oldestTransaction).toBe('2024-06-01');
      expect(b.newestTransaction).toBe('2025-03-01');
    });
  });

  describe('asOfDate ceiling', () => {
    it('sums only transactions on or before asOfDate (inclusive)', () => {
      setOpeningBalance(account, 1000, '2024-01-01');
      insertTxn({ hash: 'a', date: '2024-01-01', description: 'start', amount: 100, type: 'income' });
      insertTxn({ hash: 'b', date: '2024-06-01', description: 'mid', amount: -50, type: 'expense' });
      insertTxn({ hash: 'c', date: '2024-12-01', description: 'late', amount: -25, type: 'expense' });

      const b = getAccountBalance(account, { asOfDate: '2024-06-01' });
      expect(b.transactionTotal).toBe(50);
      expect(b.currentBalance).toBe(1050);
      expect(b.transactionCount).toBe(2);
      expect(b.newestTransaction).toBe('2024-06-01');
    });

    it('returns opening balance only when asOfDate is before opening_balance_date', () => {
      setOpeningBalance(account, 1000, '2024-01-01');
      insertTxn({ hash: 'a', date: '2024-06-01', description: 'later', amount: -50, type: 'expense' });

      const b = getAccountBalance(account, { asOfDate: '2023-12-31' });
      expect(b.transactionTotal).toBe(0);
      expect(b.currentBalance).toBe(1000);
      expect(b.transactionCount).toBe(0);
      expect(b.newestTransaction).toBeNull();
    });
  });
});
