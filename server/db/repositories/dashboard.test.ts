import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';

const hoisted = vi.hoisted(() => ({
  db: null as Database.Database | null,
}));

vi.mock('../connection.js', () => ({
  getDb: () => {
    if (!hoisted.db) throw new Error('test db not initialised');
    return hoisted.db;
  },
}));

import { getAccountSummary } from './dashboard.js';

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
  `);
}

describe('getAccountSummary', () => {
  beforeAll(() => {
    hoisted.db = new Database(':memory:');
    createSchema();
  });

  afterAll(() => {
    hoisted.db?.close();
  });

  beforeEach(() => {
    hoisted.db!.exec('DELETE FROM transactions;');
  });

  it('uses global MAX(date) for newestTransaction when a financial year filter is applied', () => {
    hoisted.db!.prepare(
      `INSERT INTO transactions (hash, date, description, amount, account, type)
       VALUES (?, ?, ?, ?, 'santander-everyday', 'expense')`,
    ).run('h1', '2025-03-01', 'in 2024/25 FY', -10);
    hoisted.db!.prepare(
      `INSERT INTO transactions (hash, date, description, amount, account, type)
       VALUES (?, ?, ?, ?, 'santander-everyday', 'expense')`,
    ).run('h2', '2026-05-09', 'next FY', -20);

    const byAccount = getAccountSummary({ financialYear: '2024/25' });
    const s = byAccount['santander-everyday'];
    expect(s.transactionCount).toBe(1);
    expect(s.expenses).toBe(10);
    expect(s.newestTransaction).toBe('2026-05-09');
  });
});
