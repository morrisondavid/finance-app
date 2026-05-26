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

describe('getTransactions dateFrom / dateTo', () => {
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

  it('filters by inclusive ISO range', () => {
    insertTxn({
      hash: 'a',
      date: '2025-01-01',
      description: 'early',
      amount: -1,
      account: 'barclays-current',
      type: 'expense',
    });
    insertTxn({
      hash: 'b',
      date: '2025-06-15',
      description: 'mid',
      amount: -2,
      account: 'barclays-current',
      type: 'expense',
    });
    insertTxn({
      hash: 'c',
      date: '2026-01-01',
      description: 'late',
      amount: -3,
      account: 'barclays-current',
      type: 'expense',
    });

    const rows = getTransactions({
      account: 'barclays-current',
      dateFrom: '2025-06-01',
      dateTo: '2025-12-31',
    });
    expect(rows.map(r => r.hash).sort()).toEqual(['b']);
  });

  it('returns nothing when parsed from > to', () => {
    insertTxn({
      hash: 'a',
      date: '2025-06-01',
      description: 'x',
      amount: -1,
      account: 'barclays-current',
      type: 'expense',
    });
    expect(
      getTransactions({
        account: 'barclays-current',
        dateFrom: '2025-12-31',
        dateTo: '2025-01-01',
      }),
    ).toEqual([]);
  });

  it('ignores malformed ISO strings (no extra bounds)', () => {
    insertTxn({
      hash: 'a',
      date: '2025-03-01',
      description: 'x',
      amount: -1,
      account: 'barclays-current',
      type: 'expense',
    });
    const rows = getTransactions({
      account: 'barclays-current',
      dateFrom: 'not-a-date',
      dateTo: '2025-04-01',
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.hash).toBe('a');
  });

  it('ANDs minDateInclusive with dateFrom (intersection)', () => {
    insertTxn({
      hash: 'a',
      date: '2025-02-01',
      description: 'x',
      amount: -1,
      account: 'barclays-current',
      type: 'expense',
    });
    insertTxn({
      hash: 'b',
      date: '2025-05-01',
      description: 'y',
      amount: -2,
      account: 'barclays-current',
      type: 'expense',
    });

    const rows = getTransactions({
      account: 'barclays-current',
      minDateInclusive: '2025-04-01',
      dateFrom: '2025-01-01',
      dateTo: '2025-12-31',
    });
    expect(rows.map(r => r.hash).sort()).toEqual(['b']);
  });

  it('excludes transfer outside range for expense drill on account that counts transfers as expense', () => {
    insertTxn({
      hash: 'tx-in',
      date: '2025-03-10',
      description: 'internal move',
      amount: -50,
      account: 'capital-on-tap',
      type: 'transfer',
    });
    insertTxn({
      hash: 'exp',
      date: '2025-03-12',
      description: 'coffee',
      amount: -3,
      account: 'capital-on-tap',
      type: 'expense',
    });
    insertTxn({
      hash: 'tx-earlier',
      date: '2025-01-10',
      description: 'old transfer',
      amount: -9,
      account: 'capital-on-tap',
      type: 'transfer',
    });

    const rows = getTransactions({
      account: 'capital-on-tap',
      type: 'expense',
      dateFrom: '2025-03-01',
      dateTo: '2025-03-31',
    });
    expect(rows.map(r => r.hash).sort()).toEqual(['exp', 'tx-in']);
    expect(rows.find(r => r.hash === 'tx-earlier')).toBeUndefined();
  });
});
