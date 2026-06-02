import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import reportingRouter from './reporting.js';
import { ReportingReadinessResponseSchema } from '../../shared/api-contracts.js';

let server: Server;
let baseUrl: string;

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use('/api/reporting', reportingRouter);
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

describe('/api/reporting routes', () => {
  beforeAll(async () => {
    await startServer();
  });

  afterAll(async () => {
    await stopServer();
  });

  it('GET /readiness returns 400 when params missing', async () => {
    const resp = await fetch(`${baseUrl}/api/reporting/readiness`);
    expect(resp.status).toBe(400);
  });

  it('GET /readiness returns 200 with valid readiness body', async () => {
    const q = new URLSearchParams({
      entityId: 'autonize-it-ltd',
      regime: 'vat',
      period: 'Q2-2025',
    });
    const resp = await fetch(`${baseUrl}/api/reporting/readiness?${q}`);
    expect(resp.status).toBe(200);
    const body = await resp.json();
    const parsed = ReportingReadinessResponseSchema.parse(body);
    expect(parsed.entityId).toBe('autonize-it-ltd');
    expect(parsed.regime).toBe('vat');
    expect(parsed.periodLabel).toBe('Q2-2025');
  });
});
