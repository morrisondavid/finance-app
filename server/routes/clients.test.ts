/**
 * Shape + behaviour contract for the clients HTTP surface.
 *
 * `GET /api/clients` is exercised against the real registry (seed data)
 * so the Contracts tab's joined render can't silently regress.
 *
 * `PUT /api/clients/:id` is exercised against a mocked `updateClient`
 * helper so the route test isolates HTTP translation (result variant →
 * status code + body) from disk I/O. The domain-level write + validate
 * chain is covered exhaustively in
 * `server/domain/clients/mutations.test.ts`.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import {
  ClientsListResponseSchema,
  type Client,
  type ClientUpdate,
} from '../../shared/api-contracts.js';
import type { UpdateClientResult } from '../domain/clients/mutations.js';

// Mock the domain mutation so we control the result without touching
// disk. Matches the pattern used for `last-payment-resolver` in the
// contracts route tests.
const updateClientMock = vi.fn<(input: {
  readonly clientId: string;
  readonly patch: ClientUpdate;
}) => UpdateClientResult>();

vi.mock('../domain/clients/index.js', async () => {
  const actual = await vi.importActual<typeof import('../domain/clients/index.js')>(
    '../domain/clients/index.js',
  );
  return {
    ...actual,
    updateClient: (input: { readonly clientId: string; readonly patch: ClientUpdate }) =>
      updateClientMock(input),
  };
});

// Imported after the mock so the router binds to the mocked helper.
const { default: clientsRouter } = await import('./clients.js');

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

describe('GET /api/clients', () => {
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

describe('PUT /api/clients/:id', () => {
  beforeAll(async () => {
    await startServer();
  });

  afterAll(async () => {
    await stopServer();
  });

  beforeEach(() => {
    updateClientMock.mockReset();
  });

  const SUCCESS_CLIENT: Client = {
    id: 'delta-capita',
    kind: 'direct',
    legal_name: 'Delta Capita Ltd',
    trading_name: 'Delta Capita',
    vat_number: 'GB 123 4567 89',
    billing_address: 'London',
    primary_contact_name: 'Lily',
    primary_contact_email: 'lily@example.com',
    secondary_contact_name: null,
    secondary_contact_email: null,
    hr_contact_name: null,
    hr_contact_email: null,
    accounts_contact_name: null,
    accounts_contact_email: null,
    cc_emails: null,
    holiday_system_url: null,
    client_assigned_email: null,
    active: true,
    updated_at: '2026-05-01',
    end_client_legal_name: null,
    end_client_address: null,
    end_client_primary_contact_name: null,
    end_client_primary_contact_email: null,
    end_client_secondary_contact_name: null,
    end_client_secondary_contact_email: null,
  };

  it('returns 200 with the updated client on success', async () => {
    updateClientMock.mockReturnValue({ ok: true, client: SUCCESS_CLIENT });

    const res = await fetch(`${baseUrl}/api/clients/delta-capita`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'direct', vat_number: 'GB 123 4567 89' }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { client: Client };
    expect(body.client.id).toBe('delta-capita');
    expect(body.client.vat_number).toBe('GB 123 4567 89');

    expect(updateClientMock).toHaveBeenCalledTimes(1);
    const call = updateClientMock.mock.calls[0][0];
    expect(call.clientId).toBe('delta-capita');
    expect(call.patch).toEqual({ kind: 'direct', vat_number: 'GB 123 4567 89' });
  });

  it('returns 400 when the body fails ClientUpdateSchema', async () => {
    const res = await fetch(`${baseUrl}/api/clients/delta-capita`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      // Missing `kind` — discriminator is required.
      body: JSON.stringify({ vat_number: 'GB 123 4567 89' }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; details?: unknown };
    expect(body.error).toBe('Invalid request');
    expect(updateClientMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the domain helper reports not-found', async () => {
    updateClientMock.mockReturnValue({ ok: false, code: 'not-found' });

    const res = await fetch(`${baseUrl}/api/clients/does-not-exist`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'direct' }),
    });

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Client not found');
  });

  it('returns 400 with kind-mismatch code when direct → agency is attempted', async () => {
    updateClientMock.mockReturnValue({
      ok: false,
      code: 'kind-mismatch',
      existingKind: 'direct',
      patchKind: 'agency',
    });

    const res = await fetch(`${baseUrl}/api/clients/delta-capita`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'agency' }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; detail?: string };
    expect(body.error).toBe('kind-mismatch');
    expect(body.detail).toMatch(/direct to agency/);
  });

  it('returns 400 with ZodIssue details when the domain helper reports invalid', async () => {
    updateClientMock.mockReturnValue({
      ok: false,
      code: 'invalid',
      issues: [
        {
          code: 'custom',
          message: 'legal_name is required',
          path: ['legal_name'],
        },
      ],
    });

    const res = await fetch(`${baseUrl}/api/clients/delta-capita`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'direct', legal_name: 'x' }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; details?: unknown };
    expect(body.error).toBe('Invalid request');
    expect(body.details).toBeDefined();
  });
});
