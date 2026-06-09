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

import { getTransactions } from './transactions.js';

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

function insertTxn(input: {
  hash: string;
  date: string;
  description: string;
  amount: number;
  account: string;
  type: 'income' | 'expense' | 'transfer';
}): void {
  hoisted.db!.prepare(
    `INSERT INTO transactions (hash, date, description, amount, account, type)
     VALUES (@hash, @date, @description, @amount, @account, @type)`,
  ).run(input);
}

describe('getTransactions transfer visibility', () => {
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

  it('includes transfer rows in unfiltered barclays-current list', () => {
    insertTxn({
      hash: 'exp',
      date: '2026-06-08',
      description: 'HMRC VAT',
      amount: -5924.81,
      account: 'barclays-current',
      type: 'expense',
    });
    insertTxn({
      hash: 'xfer',
      date: '2026-06-08',
      description: 'OPTIONAL FT',
      amount: 5924.81,
      account: 'barclays-current',
      type: 'transfer',
    });

    const rows = getTransactions({ account: 'barclays-current' });
    const types = rows.map(r => r.type).sort();

    expect(rows).toHaveLength(2);
    expect(types).toEqual(['expense', 'transfer']);
  });

  it('still excludes transfers from type=income drill-down on barclays-current', () => {
    insertTxn({
      hash: 'inc',
      date: '2026-06-01',
      description: 'Client payment',
      amount: 1000,
      account: 'barclays-current',
      type: 'income',
    });
    insertTxn({
      hash: 'xfer',
      date: '2026-06-08',
      description: 'OPTIONAL FT',
      amount: 5924.81,
      account: 'barclays-current',
      type: 'transfer',
    });

    const rows = getTransactions({ account: 'barclays-current', type: 'income' });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe('income');
  });
});
