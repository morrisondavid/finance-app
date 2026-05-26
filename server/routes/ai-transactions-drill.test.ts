/**
 * Thin route tests for GET /api/ai/transactions-drill (Wave 03).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import Database from 'better-sqlite3';
import type { AiTransactionDrillResponse } from '../../shared/api-contracts.js';
import aiRouter from './ai.js';

const hoisted = vi.hoisted(() => ({
  db: null as Database.Database | null,
}));

vi.mock('../db/connection.js', () => ({
  getDb: () => {
    if (!hoisted.db) throw new Error('test db not initialised');
    return hoisted.db;
  },
}));

let server: Server;
let baseUrl: string;

function createTransactionsSchema(): void {
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

async function startServer(): Promise<void> {
  const app = express();
  app.use('/api/ai', aiRouter);
  await new Promise<void>(resolve => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
}

async function stopServer(): Promise<void> {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close(err => (err ? reject(err) : resolve()));
    });
  }
}

describe('GET /api/ai/transactions-drill', () => {
  beforeAll(async () => {
    hoisted.db = new Database(':memory:');
    createTransactionsSchema();
    await startServer();
  });

  afterAll(async () => {
    await stopServer();
    hoisted.db?.close();
  });

  beforeEach(() => {
    hoisted.db!.exec('DELETE FROM transactions;');
  });

  it('400 when no date window is provided', async () => {
    const res = await fetch(`${baseUrl}/api/ai/transactions-drill?limit=10`);
    expect(res.status).toBe(400);
  });

  it('returns truncation metadata when rows exceed limit', async () => {
    const ins = hoisted.db!.prepare(
      `INSERT INTO transactions (hash, date, description, amount, account, type)
       VALUES (@hash, @date, @description, @amount, @account, @type)`,
    );
    ins.run({
      hash: 't1',
      date: '2025-06-01',
      description: 'a',
      amount: -10,
      account: 'barclays-current',
      type: 'expense',
    });
    ins.run({
      hash: 't2',
      date: '2025-06-02',
      description: 'b',
      amount: -20,
      account: 'barclays-current',
      type: 'expense',
    });

    const res = await fetch(
      `${baseUrl}/api/ai/transactions-drill?year=2025&limit=1&includeRows=true`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as AiTransactionDrillResponse;
    expect(body.matchedRowCount).toBe(2);
    expect(body.returnedRowCount).toBe(1);
    expect(body.truncated).toBe(true);
    expect(body.limit).toBe(1);
    expect(body.query.year).toBe('2025');
  });

  it('includeRows=false returns aggregates without row payloads', async () => {
    hoisted.db!.prepare(
      `INSERT INTO transactions (hash, date, description, amount, account, type)
       VALUES (@hash, @date, @description, @amount, @account, @type)`,
    ).run({
      hash: 'o1',
      date: '2025-07-01',
      description: 'fuel',
      amount: -44,
      account: 'barclays-current',
      type: 'expense',
    });

    const res = await fetch(`${baseUrl}/api/ai/transactions-drill?year=2025&includeRows=false`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as AiTransactionDrillResponse;
    expect(body.includeRows).toBe(false);
    expect(body.rows).toEqual([]);
    expect(body.returnedRowCount).toBe(0);
    expect(body.matchedRowCount).toBe(1);
    expect(body.aggregatesByAccount).toContainEqual({
      account: 'barclays-current',
      currency: 'GBP',
      rowCount: 1,
      sumAmount: -44,
    });
  });
});
