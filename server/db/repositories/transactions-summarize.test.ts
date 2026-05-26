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

import { getTransactions, summarizeTransactionsByAccount } from './transactions.js';

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

describe('summarizeTransactionsByAccount vs getTransactions', () => {
  beforeAll(() => {
    hoisted.db = new Database(':memory:');
    createSchema();
  });

  afterAll(() => {
    hoisted.db?.close();
  });

  beforeEach(() => {
    hoisted.db!.exec('DELETE FROM transactions;');
    const stmt = hoisted.db!.prepare(
      `INSERT INTO transactions (hash, date, description, amount, account, type)
       VALUES (@hash, @date, @description, @amount, @account, @type)`,
    );
    stmt.run({
      hash: 'a',
      date: '2026-03-01',
      description: 'x',
      amount: -15,
      account: 'capital-on-tap',
      type: 'expense',
    });
    stmt.run({
      hash: 'b',
      date: '2026-03-02',
      description: 'y',
      amount: -25,
      account: 'barclays-current',
      type: 'expense',
    });
  });

  it('row counts and sums agree with grouped getTransactions totals', () => {
    const filters = { year: '2026', dateFrom: '2026-01-01', dateTo: '2026-12-31' as const };
    const rows = getTransactions(filters);
    const agg = summarizeTransactionsByAccount(filters);
    expect(rows.length).toBe(2);
    expect(agg.length).toBe(2);
    const byAcc = new Map(agg.map(r => [r.account, r]));
    expect(byAcc.get('barclays-current')?.rowCount).toBe(1);
    expect(byAcc.get('barclays-current')?.sumAmount).toBe(-25);
    expect(byAcc.get('capital-on-tap')?.rowCount).toBe(1);
    expect(byAcc.get('capital-on-tap')?.sumAmount).toBe(-15);
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBe(-40);
  });
});
