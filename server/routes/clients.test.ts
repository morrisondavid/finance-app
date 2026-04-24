/**
 * Lock the shape and success of `GET /api/clients` so the Contracts
 * tab (which joins the client trading name against each contract)
 * can't silently regress.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import clientsRouter from './clients.js';
import {
  ClientsListResponseSchema,
  type Client,
} from '../../shared/api-contracts.js';

let server: Server;
let baseUrl: string;

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use('/api/clients', clientsRouter);
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

describe('/api/clients', () => {
  beforeAll(async () => {
    await startServer();
  });

  afterAll(async () => {
    await stopServer();
  });

  it('returns a Zod-valid list of clients', async () => {
    const res = await fetch(`${baseUrl}/api/clients`);
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    const parsed = ClientsListResponseSchema.parse(body);
    expect(parsed.clients.length).toBeGreaterThan(0);
  });

  it('includes the seed clients referenced by the contracts fixture', async () => {
    const res = await fetch(`${baseUrl}/api/clients`);
    const { clients } = ClientsListResponseSchema.parse(await res.json());
    const ids = clients.map((c: Client) => c.id);
    expect(ids).toContain('delta-capita');
    expect(ids).toContain('la-fosse');
  });

  it('surfaces trading_name and (for agency rows) end_client_legal_name', async () => {
    const res = await fetch(`${baseUrl}/api/clients`);
    const { clients } = ClientsListResponseSchema.parse(await res.json());
    const dc = clients.find((c: Client) => c.id === 'delta-capita');
    const lf = clients.find((c: Client) => c.id === 'la-fosse');
    expect(dc?.trading_name).toBeDefined();
    expect(lf?.kind).toBe('agency');
    if (lf?.kind === 'agency') {
      expect(lf.end_client_legal_name).toBeDefined();
    }
  });
});
