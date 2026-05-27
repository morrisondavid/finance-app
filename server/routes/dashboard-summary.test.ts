/**
 * Regression: GET /api/dashboard/summary stays fast-envelope-only — financial
 * safety is loaded via GET /api/ai/financial-safety from the Liquidity tab.
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
import { DashboardSummaryResponseSchema, DashboardAccountsSummaryResponseSchema } from '../../shared/api-contracts.js';

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
  get DEADLINES_DIR() {
    if (!harness.current) throw new Error('test db not initialised');
    return harness.current.deadlinesDir;
  },
  get DEBTS_DIR() {
    if (!harness.current) throw new Error('test db not initialised');
    return harness.current.debtsDir;
  },
}));

import dashboardRouter from './dashboard.js';

let server: Server;
let baseUrl: string;

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use('/api/dashboard', dashboardRouter);
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

describe('GET /api/dashboard/summary', () => {
  beforeEach(() => {
    if (harness.current) resetTestData(harness.current.db);
  });

  it('returns 200 with a parsed envelope and omits financialSafety', async () => {
    const res = await fetch(`${baseUrl}/api/dashboard/summary?account=barclays-current`);
    expect(res.status).toBe(200);
    const body = DashboardSummaryResponseSchema.parse(await res.json());
    expect(body.financialSafety).toBeUndefined();
    expect(body.liquidityOverview).toBeDefined();
    expect(body.liquidityCommitments).toBeDefined();
    expect(body.fileCount).toBeDefined();
    expect(body.transactionCount).toBeDefined();
  });

  it('scope=accounts returns slim envelope without liquidity or unused counts', async () => {
    const res = await fetch(
      `${baseUrl}/api/dashboard/summary?scope=accounts&account=barclays-current`,
    );
    expect(res.status).toBe(200);
    const json: unknown = await res.json();
    const body = DashboardAccountsSummaryResponseSchema.parse(json);
    expect(body.totals).toBeDefined();
    expect(body.monthly).toBeDefined();
    expect(body.byAccount).toBeDefined();
    expect(body.transferCount).toBeDefined();
    expect(json).not.toHaveProperty('liquidityOverview');
    expect(json).not.toHaveProperty('liquidityCommitments');
    expect(json).not.toHaveProperty('fileCount');
    expect(json).not.toHaveProperty('transactionCount');
    expect(json).not.toHaveProperty('balances');
  });
});
