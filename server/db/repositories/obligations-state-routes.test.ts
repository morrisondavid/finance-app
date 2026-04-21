import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Integration tests for the Mark Paid repository functions
 * ({@link upsertManualObligationState} and
 * {@link resetManualObligationState}) plus the HTTP handlers in
 * `server/routes/obligations.ts` that wrap them.
 *
 * The routes are thin — body validation + NonManualStateError →
 * HTTP-400 mapping — so the tests exercise both paths through a tiny
 * express harness pointed at an in-memory SQLite instance + a temp
 * OBLIGATIONS_DIR on disk. Mirrors the sa-auto-seed / debts route test
 * patterns so future contributors have one shape to learn.
 */

const tmpObligationsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obligations-state-routes-test-'));
let testDb: Database.Database;

vi.mock('../connection.js', () => ({
  getDb: () => testDb,
  OBLIGATIONS_DIR: tmpObligationsDir,
}));

const obligationsRepo = await import('./obligations.js');
const { default: obligationsRouter } = await import('../../routes/obligations.js');

import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';

const MANUAL_ID = 'manual-test-ins-1';

function createSchema(): void {
  testDb.exec(`
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
  `);
}

function seedManualObligationCsv(): void {
  const csvPath = path.join(tmpObligationsDir, 'obligations.csv');
  fs.writeFileSync(
    csvPath,
    'id,category,frequency,merchant,display_name,account,amount,currency,notes,ownership_david,ownership_heena,person_id,amount_tolerance,due_date,tax_type\n' +
    `${MANUAL_ID},insurance,annual,Kingsbridge,Kingsbridge Insurance (UK ltd),barclays-current,615,GBP,,,,,,2025-11-06,\n`,
    'utf8',
  );
}

function stateCsvPath(): string {
  return path.join(tmpObligationsDir, 'obligation-state.csv');
}

let server: Server;
let baseUrl: string;

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use('/api/obligations', obligationsRouter);
  await new Promise<void>(resolve => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
}

async function stopServer(): Promise<void> {
  if (server) await new Promise<void>((resolve, reject) => {
    server.close(err => (err ? reject(err) : resolve()));
  });
}

beforeAll(async () => {
  testDb = new Database(':memory:');
  createSchema();
  await startServer();
});

afterAll(async () => {
  await stopServer();
  testDb.close();
  fs.rmSync(tmpObligationsDir, { recursive: true, force: true });
});

beforeEach(() => {
  testDb.exec('DELETE FROM financial_obligations; DELETE FROM transactions; DELETE FROM obligation_dismissals;');
  if (fs.existsSync(stateCsvPath())) fs.unlinkSync(stateCsvPath());
  seedManualObligationCsv();
  obligationsRepo.loadManualObligationsFromCsv();
});

describe('upsertManualObligationState (repo)', () => {
  it('writes a source=user row and updates the projection to paid', () => {
    const updated = obligationsRepo.upsertManualObligationState(MANUAL_ID, {
      status: 'paid',
      paidAmount: 615,
      paidDate: '2025-11-06',
      paidFromAccount: 'barclays-current',
    });
    expect(updated).not.toBeNull();
    expect(updated?.status).toBe('paid');
    expect(updated?.paid_amount).toBe(615);
    expect(updated?.paid_date).toBe('2025-11-06');

    const csv = fs.readFileSync(stateCsvPath(), 'utf8');
    expect(csv).toContain(`${MANUAL_ID},paid,615,2025-11-06,barclays-current,user`);
  });

  it('throws NonManualStateError for auto-* ids (those are owned by HMRC seeders)', () => {
    expect(() => obligationsRepo.upsertManualObligationState('auto-sa-david-2026-01-31', {
      status: 'paid',
    })).toThrowError(obligationsRepo.NonManualStateError);
  });

  it('returns null when the id does not exist in the registry', () => {
    const r = obligationsRepo.upsertManualObligationState('manual-does-not-exist', { status: 'paid' });
    expect(r).toBeNull();
  });
});

describe('resetManualObligationState (repo)', () => {
  it('removes an existing user state override and returns true', () => {
    obligationsRepo.upsertManualObligationState(MANUAL_ID, {
      status: 'paid', paidAmount: 615, paidDate: '2025-11-06', paidFromAccount: 'barclays-current',
    });

    const removed = obligationsRepo.resetManualObligationState(MANUAL_ID);
    expect(removed).toBe(true);

    if (fs.existsSync(stateCsvPath())) {
      const csv = fs.readFileSync(stateCsvPath(), 'utf8');
      expect(csv).not.toContain(MANUAL_ID);
    }

    const projectedRow = testDb.prepare('SELECT status, paid_amount FROM financial_obligations WHERE id = ?').get(MANUAL_ID) as { status: string; paid_amount: number | null };
    expect(projectedRow.status).not.toBe('paid');
  });

  it('returns false when there was nothing to reset', () => {
    expect(obligationsRepo.resetManualObligationState(MANUAL_ID)).toBe(false);
  });

  it('throws NonManualStateError for auto-* ids', () => {
    expect(() => obligationsRepo.resetManualObligationState('auto-vat-2025-06-07'))
      .toThrowError(obligationsRepo.NonManualStateError);
  });
});

describe('POST /api/obligations/:id/state', () => {
  it('returns the updated row on success (200)', async () => {
    const res = await fetch(`${baseUrl}/api/obligations/${MANUAL_ID}/state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'paid',
        paidAmount: 615,
        paidDate: '2025-11-06',
        paidFromAccount: 'barclays-current',
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { id: string; status: string; paidAmount: number | null };
    expect(body.id).toBe(MANUAL_ID);
    expect(body.status).toBe('paid');
    expect(body.paidAmount).toBe(615);
  });

  it('returns 400 when the body fails validation', async () => {
    const res = await fetch(`${baseUrl}/api/obligations/${MANUAL_ID}/state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'not-a-real-status' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when called with an auto-* id', async () => {
    const res = await fetch(`${baseUrl}/api/obligations/auto-sa-david-2026-01-31/state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'paid' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/auto-seeded/i);
  });

  it('returns 404 when the obligation id is unknown', async () => {
    const res = await fetch(`${baseUrl}/api/obligations/manual-nope/state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'paid' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/obligations/:id/state', () => {
  it('returns 200 and clears the state row', async () => {
    obligationsRepo.upsertManualObligationState(MANUAL_ID, {
      status: 'paid', paidAmount: 615, paidDate: '2025-11-06', paidFromAccount: 'barclays-current',
    });

    const res = await fetch(`${baseUrl}/api/obligations/${MANUAL_ID}/state`, { method: 'DELETE' });
    expect(res.status).toBe(200);
  });

  it('returns 404 when there was nothing to reset', async () => {
    const res = await fetch(`${baseUrl}/api/obligations/${MANUAL_ID}/state`, { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  it('returns 400 for auto-* ids', async () => {
    const res = await fetch(`${baseUrl}/api/obligations/auto-vat-2025-06-07/state`, { method: 'DELETE' });
    expect(res.status).toBe(400);
  });
});
