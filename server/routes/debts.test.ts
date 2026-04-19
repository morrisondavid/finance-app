import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';

const hoisted = vi.hoisted(() => ({
  db: null as Database.Database | null,
  debtsDir: '',
}));

vi.mock('../db/connection.js', () => ({
  getDb: () => {
    if (!hoisted.db) throw new Error('test db not initialised');
    return hoisted.db;
  },
  get DEBTS_DIR() {
    return hoisted.debtsDir;
  },
}));

import debtsRouter from './debts.js';
import * as DebtsRepo from '../db/repositories/debts.js';
import { DEBTS_CSV_FILENAME, readDebtsFromCsvFile } from '../db/debts-csv.js';

function createSchema(): void {
  hoisted.db!.exec(`
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
      kind TEXT NOT NULL DEFAULT 'consumer' CHECK(kind IN ('consumer', 'mortgage')),
      interest_rate REAL,
      fixed_rate_end_date TEXT,
      repayment_type TEXT CHECK(repayment_type IS NULL OR repayment_type IN ('repayment', 'interest-only')),
      property_value_estimate REAL,
      property_id TEXT,
      archived INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      description TEXT NOT NULL,
      amount REAL NOT NULL,
      account TEXT NOT NULL,
      type TEXT NOT NULL
    );
  `);
}

let server: Server;
let baseUrl: string;

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use('/api/debts', debtsRouter);
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

function seedDebt(overrides: Partial<Parameters<typeof DebtsRepo.createDebt>[0]> = {}): string {
  const id = overrides.id ?? `debt-${Math.random().toString(36).slice(2, 8)}`;
  DebtsRepo.createDebt({
    id,
    name: overrides.name ?? 'Test Debt',
    merchantPattern: overrides.merchantPattern ?? 'TESTPAY',
    sourceAccounts: overrides.sourceAccounts ?? ['barclays-current'],
    originalLoanAmount: overrides.originalLoanAmount ?? 1000,
    originalLoanDate: overrides.originalLoanDate ?? null,
    openingBalance: overrides.openingBalance ?? 500,
    openingBalanceDate: overrides.openingBalanceDate ?? '2026-01-01',
  });
  return id;
}

describe('/api/debts routes', () => {
  beforeAll(async () => {
    hoisted.db = new Database(':memory:');
    createSchema();
    await startServer();
  });

  afterAll(async () => {
    await stopServer();
    hoisted.db?.close();
  });

  beforeEach(() => {
    hoisted.db!.exec('DELETE FROM debts; DELETE FROM transactions;');
    hoisted.debtsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'debts-routes-test-'));
  });

  afterEach(() => {
    fs.rmSync(hoisted.debtsDir, { recursive: true, force: true });
  });

  describe('GET /api/debts', () => {
    it('returns active debts with totalOutstanding', async () => {
      seedDebt({ id: 'one', openingBalance: 200 });
      seedDebt({ id: 'two', openingBalance: 300 });
      const res = await fetch(`${baseUrl}/api/debts`);
      expect(res.status).toBe(200);
      const body = await res.json() as { debts: Array<{ id: string }>; totalOutstanding: number };
      expect(body.debts.map(d => d.id).sort()).toEqual(['one', 'two']);
      expect(body.totalOutstanding).toBe(500);
    });

    it('hides archived by default, surfaces with ?includeArchived=1', async () => {
      seedDebt({ id: 'active' });
      seedDebt({ id: 'gone' });
      DebtsRepo.archiveDebt('gone');

      const res1 = await fetch(`${baseUrl}/api/debts`);
      const body1 = await res1.json() as { debts: Array<{ id: string }> };
      expect(body1.debts.map(d => d.id)).toEqual(['active']);

      const res2 = await fetch(`${baseUrl}/api/debts?includeArchived=1`);
      const body2 = await res2.json() as { debts: Array<{ id: string }> };
      expect(body2.debts.map(d => d.id).sort()).toEqual(['active', 'gone']);
    });
  });

  describe('POST /api/debts', () => {
    it('creates a debt, writes CSV, returns 201', async () => {
      const res = await fetch(`${baseUrl}/api/debts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'new',
          name: 'New Debt',
          merchantPattern: 'NEW',
          sourceAccounts: ['barclays-current'],
          originalLoanAmount: 500,
          openingBalance: 250,
          openingBalanceDate: '2026-04-19',
        }),
      });
      expect(res.status).toBe(201);
      const body = await res.json() as { debt: { id: string } };
      expect(body.debt.id).toBe('new');

      const csvRows = readDebtsFromCsvFile(path.join(hoisted.debtsDir, DEBTS_CSV_FILENAME));
      expect(csvRows.find(r => r.id === 'new')).toBeDefined();
    });

    it('400 on invalid body (bad source account)', async () => {
      const res = await fetch(`${baseUrl}/api/debts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'bad',
          name: 'Bad',
          merchantPattern: 'X',
          sourceAccounts: ['fake-account'],
          originalLoanAmount: 100,
          openingBalance: 50,
          openingBalanceDate: '2026-04-19',
        }),
      });
      expect(res.status).toBe(400);
    });

    it('400 on missing required fields', async () => {
      const res = await fetch(`${baseUrl}/api/debts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'x' }),
      });
      expect(res.status).toBe(400);
    });

    it('round-trips matchAmounts into the created debt and the CSV', async () => {
      const res = await fetch(`${baseUrl}/api/debts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'shared-a',
          name: 'Shared A',
          merchantPattern: 'SHARED',
          sourceAccounts: ['monzo-joint'],
          originalLoanAmount: 1000,
          openingBalance: 500,
          openingBalanceDate: '2026-04-19',
          matchAmounts: [232.22],
        }),
      });
      expect(res.status).toBe(201);
      const body = await res.json() as { debt: { matchAmounts: number[] } };
      expect(body.debt.matchAmounts).toEqual([232.22]);

      const csvRows = readDebtsFromCsvFile(path.join(hoisted.debtsDir, DEBTS_CSV_FILENAME));
      expect(csvRows.find(r => r.id === 'shared-a')?.matchAmounts).toEqual([232.22]);
    });

    it('400 on matchAmounts with non-positive value', async () => {
      const res = await fetch(`${baseUrl}/api/debts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'bad-ma',
          name: 'Bad',
          merchantPattern: 'X',
          sourceAccounts: ['barclays-current'],
          originalLoanAmount: 100,
          openingBalance: 50,
          openingBalanceDate: '2026-04-19',
          matchAmounts: [0],
        }),
      });
      expect(res.status).toBe(400);
    });

    it('400 on duplicate id', async () => {
      seedDebt({ id: 'dup' });
      const res = await fetch(`${baseUrl}/api/debts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'dup',
          name: 'Dup',
          merchantPattern: 'X',
          sourceAccounts: ['barclays-current'],
          originalLoanAmount: 100,
          openingBalance: 50,
          openingBalanceDate: '2026-04-19',
        }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('PUT /api/debts/:id', () => {
    it('updates fields and re-exports CSV', async () => {
      const id = seedDebt();
      const res = await fetch(`${baseUrl}/api/debts/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Renamed' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { debt: { name: string } };
      expect(body.debt.name).toBe('Renamed');

      const csvRows = readDebtsFromCsvFile(path.join(hoisted.debtsDir, DEBTS_CSV_FILENAME));
      expect(csvRows.find(r => r.id === id)?.name).toBe('Renamed');
    });

    it('404 on unknown id', async () => {
      const res = await fetch(`${baseUrl}/api/debts/ghost`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'X' }),
      });
      expect(res.status).toBe(404);
    });

    it('can set matchAmounts to a new value and clear it back to empty', async () => {
      const id = seedDebt();
      const res1 = await fetch(`${baseUrl}/api/debts/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matchAmounts: [192.66] }),
      });
      expect(res1.status).toBe(200);
      const body1 = await res1.json() as { debt: { matchAmounts: number[] } };
      expect(body1.debt.matchAmounts).toEqual([192.66]);

      const res2 = await fetch(`${baseUrl}/api/debts/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matchAmounts: [] }),
      });
      expect(res2.status).toBe(200);
      const body2 = await res2.json() as { debt: { matchAmounts: number[] } };
      expect(body2.debt.matchAmounts).toEqual([]);

      const csvRows = readDebtsFromCsvFile(path.join(hoisted.debtsDir, DEBTS_CSV_FILENAME));
      expect(csvRows.find(r => r.id === id)?.matchAmounts).toEqual([]);
    });
  });

  describe('DELETE /api/debts/:id (archive)', () => {
    it('archives and re-exports CSV', async () => {
      const id = seedDebt();
      const res = await fetch(`${baseUrl}/api/debts/${id}`, { method: 'DELETE' });
      expect(res.status).toBe(200);
      const body = await res.json() as { debt: { archived: boolean } };
      expect(body.debt.archived).toBe(true);

      const csvRows = readDebtsFromCsvFile(path.join(hoisted.debtsDir, DEBTS_CSV_FILENAME));
      expect(csvRows.find(r => r.id === id)?.archived).toBe(true);
    });

    it('404 on unknown id', async () => {
      const res = await fetch(`${baseUrl}/api/debts/ghost`, { method: 'DELETE' });
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/debts/:id/opening-balance', () => {
    it('updates balance + date and re-exports CSV', async () => {
      const id = seedDebt({ openingBalance: 500, openingBalanceDate: '2026-01-01' });
      const res = await fetch(`${baseUrl}/api/debts/${id}/opening-balance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ balance: 123.45, date: '2026-04-19' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { debt: { openingBalance: number; openingBalanceDate: string } };
      expect(body.debt.openingBalance).toBe(123.45);
      expect(body.debt.openingBalanceDate).toBe('2026-04-19');

      const csvRows = readDebtsFromCsvFile(path.join(hoisted.debtsDir, DEBTS_CSV_FILENAME));
      const row = csvRows.find(r => r.id === id)!;
      expect(row.openingBalance).toBe(123.45);
      expect(row.openingBalanceDate).toBe('2026-04-19');
    });

    it('400 on invalid body', async () => {
      const id = seedDebt();
      const res = await fetch(`${baseUrl}/api/debts/${id}/opening-balance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ balance: -5, date: 'nope' }),
      });
      expect(res.status).toBe(400);
    });

    it('404 on unknown id', async () => {
      const res = await fetch(`${baseUrl}/api/debts/ghost/opening-balance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ balance: 100, date: '2026-04-19' }),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('summary integration', () => {
    it('returned summary reflects matched transactions', async () => {
      const id = seedDebt({
        openingBalance: 500,
        openingBalanceDate: '2026-01-01',
        originalLoanAmount: 1000,
        merchantPattern: 'TESTPAY',
        sourceAccounts: ['barclays-current'],
      });
      hoisted.db!.prepare(
        'INSERT INTO transactions (date, description, amount, account, type) VALUES (?, ?, ?, ?, ?)',
      ).run('2026-02-01', 'TESTPAY jan', -100, 'barclays-current', 'expense');
      hoisted.db!.prepare(
        'INSERT INTO transactions (date, description, amount, account, type) VALUES (?, ?, ?, ?, ?)',
      ).run('2026-03-01', 'TESTPAY feb', -100, 'barclays-current', 'expense');

      const res = await fetch(`${baseUrl}/api/debts`);
      const body = await res.json() as {
        debts: Array<{ id: string; currentBalance: number; paidSinceOpening: number; matchedTransactionCount: number }>;
      };
      const debt = body.debts.find(d => d.id === id)!;
      expect(debt.paidSinceOpening).toBe(200);
      expect(debt.currentBalance).toBe(300);
      expect(debt.matchedTransactionCount).toBe(2);
    });

    it('POST creates a mortgage and GET returns split totals', async () => {
      seedDebt({ id: 'consumer1', openingBalance: 500, originalLoanAmount: 1000 });
      const mtgRes = await fetch(`${baseUrl}/api/debts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'mtg1',
          name: 'Mortgage',
          merchantPattern: 'MORTGAGE',
          sourceAccounts: ['natwest'],
          originalLoanAmount: 200000,
          openingBalance: 200000,
          openingBalanceDate: '2026-01-01',
          kind: 'mortgage',
          interestRate: 4.48,
          fixedRateEndDate: '2028-04-30',
          repaymentType: 'interest-only',
          propertyValueEstimate: 300000,
          propertyId: 'test-prop',
        }),
      });
      expect(mtgRes.status).toBe(201);
      const mtgBody = await mtgRes.json() as { debt: { kind: string; interestRate: number } };
      expect(mtgBody.debt.kind).toBe('mortgage');
      expect(mtgBody.debt.interestRate).toBe(4.48);

      const listRes = await fetch(`${baseUrl}/api/debts`);
      const listBody = await listRes.json() as {
        consumerTotal: number;
        mortgageTotal: number;
        totalOutstanding: number;
        totalPropertyValue: number;
        netEquity: number;
      };
      expect(listBody.consumerTotal).toBe(500);
      expect(listBody.mortgageTotal).toBe(200000);
      expect(listBody.totalOutstanding).toBe(200500);
      expect(listBody.totalPropertyValue).toBe(300000);
      expect(listBody.netEquity).toBe(100000);
    });
  });
});
