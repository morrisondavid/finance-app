import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { SurvivalPlanGetResponseSchema } from '../../shared/api-contracts.js';

const getActiveSurvivalPlanMock = vi.fn(() => null);

vi.mock('../db/survival-plan-csv.js', () => ({
  getActiveSurvivalPlan: () => getActiveSurvivalPlanMock(),
}));

import aiRouter from './ai.js';

let server: Server;
let baseUrl: string;

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json());
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

beforeAll(async () => {
  await startServer();
});

afterAll(async () => {
  await stopServer();
});

describe('GET /api/ai/survival-plan', () => {
  it('returns null plan when none is committed', async () => {
    getActiveSurvivalPlanMock.mockReturnValue(null);
    const res = await fetch(`${baseUrl}/api/ai/survival-plan`);
    expect(res.status).toBe(200);
    const body = SurvivalPlanGetResponseSchema.parse(await res.json());
    expect(body.plan).toBeNull();
  });
});
