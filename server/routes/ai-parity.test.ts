/**
 * §2.0.H — AI composers return the same JSON as the canonical REST slices
 * they mirror (warnings snapshot table is cleared between paired calls).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import {
  createInMemoryTestDb,
  resetTestData,
  type TestDbHandles,
} from '../db/test-harness/in-memory-db.js';
import { EntityFoundationWarningsResponseSchema, type EntityFoundationWarning } from '../../shared/api-contracts.js';
import {
  AiSpendContextResponseSchema,
  IncomeCompositionResponseSchema,
  DebtStrategyStateResponseSchema,
} from '../../shared/api-contracts.js';

const harness: { current: TestDbHandles | null } = { current: null };

vi.mock('../db/connection.js', () => ({
  getDb: () => {
    if (!harness.current) throw new Error('test db not initialised');
    return harness.current.db;
  },
  get OBLIGATIONS_DIR() {
    if (!harness.current) throw new Error('test db not initialised');
    return harness.current.obligationsDir;
  },
  get DEBTS_DIR() {
    if (!harness.current) throw new Error('test db not initialised');
    return harness.current.debtsDir;
  },
}));

import aiRouter from './ai.js';
import warningsRouter from './warnings.js';
import incomeCompositionRouter from './income-composition.js';
import debtStrategyRouter from './debt-strategy.js';
import expensesRouter from './expenses.js';

let server: Server;
let baseUrl: string;

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use('/api/ai', aiRouter);
  app.use('/api/warnings', warningsRouter);
  app.use('/api/income-composition', incomeCompositionRouter);
  app.use('/api/debt-strategy', debtStrategyRouter);
  app.use('/api/expenses', expensesRouter);
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

beforeAll(async () => {
  harness.current = createInMemoryTestDb();
  await startServer();
});

afterAll(async () => {
  await stopServer();
  harness.current?.cleanup();
});

beforeEach(() => {
  if (harness.current) {
    resetTestData(harness.current.db);
    harness.current.db.exec('DELETE FROM warning_snapshots;');
  }
});

/** Two feed reads get different `snapshot_at` rows; timeline fields are unstable across paired calls. */
function entityFoundationWarningsIgnoringTimeline(warnings: readonly EntityFoundationWarning[]) {
  return warnings.map(w => {
    const { firstSeenAt: _fs, lastActiveAt: _la, ...rest } = w;
    return rest;
  });
}

describe('§2.0.H AI parity', () => {
  it('GET /api/ai/warnings matches GET /api/warnings/all when snapshots are cleared between calls', async () => {
    const a = await fetch(`${baseUrl}/api/warnings/all`);
    expect(a.status).toBe(200);
    const bodyA = EntityFoundationWarningsResponseSchema.parse(await a.json());
    harness.current?.db.exec('DELETE FROM warning_snapshots;');
    const b = await fetch(`${baseUrl}/api/ai/warnings`);
    expect(b.status).toBe(200);
    const bodyB = EntityFoundationWarningsResponseSchema.parse(await b.json());
    expect(entityFoundationWarningsIgnoringTimeline(bodyB.warnings)).toEqual(
      entityFoundationWarningsIgnoringTimeline(bodyA.warnings),
    );
  });

  it('GET /api/ai/income-composition matches GET /api/income-composition', async () => {
    const canon = await fetch(`${baseUrl}/api/income-composition`);
    const ai = await fetch(`${baseUrl}/api/ai/income-composition`);
    expect(ai.status).toBe(200);
    const expected = IncomeCompositionResponseSchema.parse(await canon.json());
    expect(IncomeCompositionResponseSchema.parse(await ai.json())).toEqual(expected);
  });

  it('GET /api/ai/debt-strategy matches GET /api/debt-strategy/state', async () => {
    const canon = await fetch(`${baseUrl}/api/debt-strategy/state`);
    const ai = await fetch(`${baseUrl}/api/ai/debt-strategy`);
    expect(ai.status).toBe(200);
    const expected = DebtStrategyStateResponseSchema.parse(await canon.json());
    expect(DebtStrategyStateResponseSchema.parse(await ai.json())).toEqual(expected);
  });

  it('GET /api/ai/spend-context nests overview + default recurring + matching ad-hoc', async () => {
    const sc = await fetch(`${baseUrl}/api/ai/spend-context`);
    expect(sc.status).toBe(200);
    const composed = AiSpendContextResponseSchema.parse(await sc.json());

    const overview = await fetch(`${baseUrl}/api/expenses/overview`);
    expect(composed.overview).toEqual(await overview.json());

    const recurring = await fetch(`${baseUrl}/api/expenses/recurring`);
    const recurringJson = await recurring.json();
    expect(composed.recurring).toEqual(recurringJson);

    const fyQs =
      typeof recurringJson.financialYear === 'string' && recurringJson.financialYear !== ''
        ? `&financialYear=${encodeURIComponent(recurringJson.financialYear)}`
        : '';
    const adHoc = await fetch(
      `${baseUrl}/api/expenses/ad-hoc?account=${encodeURIComponent(recurringJson.account)}${fyQs}`,
    );
    expect(composed.adHoc).toEqual(await adHoc.json());
  });
});
