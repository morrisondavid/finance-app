import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import companyRouter from './company.js';
import { CompaniesListResponseSchema } from '../../shared/api-contracts.js';

/**
 * Route-level regression lock for /api/company. Uses the committed seed
 * CSV (not a fixture) so the route + registry + CSV parser + Zod schema
 * stack is exercised end-to-end.
 */

let server: Server;
let baseUrl: string;

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use('/api/company', companyRouter);
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

describe('/api/company routes', () => {
  beforeAll(async () => {
    await startServer();
  });

  afterAll(async () => {
    await stopServer();
  });

  it('GET / returns 200 with both seed entities', async () => {
    const resp = await fetch(`${baseUrl}/api/company`);
    expect(resp.status).toBe(200);
    const body = await resp.json();
    const parsed = CompaniesListResponseSchema.parse(body);
    expect(parsed.companies).toHaveLength(2);
    const ids = parsed.companies.map(c => c.id).sort();
    expect(ids).toEqual(['autonize-it-fzco', 'autonize-it-ltd']);
  });

  it('GET / response validates against CompaniesListResponseSchema', async () => {
    const resp = await fetch(`${baseUrl}/api/company`);
    const body = await resp.json();
    const result = CompaniesListResponseSchema.safeParse(body);
    expect(result.success).toBe(true);
  });

  it('GET / preserves the remaining TBC literal in the JSON response', async () => {
    // As the user resolves TBC fields (see autonize-it/company.csv
    // history), this assertion tightens naturally. The one remaining
    // TBC is `vat_registered` on the UAE entity, which depends on a
    // UAE VAT-registration decision; locking it here ensures the
    // TBC literal survives the round-trip through the registry
    // and Zod response envelope.
    const resp = await fetch(`${baseUrl}/api/company`);
    const body = await resp.json();
    const parsed = CompaniesListResponseSchema.parse(body);
    const uae = parsed.companies.find(c => c.id === 'autonize-it-fzco');
    if (!uae || uae.jurisdiction !== 'UAE') throw new Error('UAE row missing');
    expect(uae.vat_registered).toBe('TBC');
  });

  it('GET / returns UK row with correct jurisdiction-specific fields', async () => {
    const resp = await fetch(`${baseUrl}/api/company`);
    const body = await resp.json();
    const parsed = CompaniesListResponseSchema.parse(body);
    const uk = parsed.companies.find(c => c.id === 'autonize-it-ltd');
    if (!uk || uk.jurisdiction !== 'UK') throw new Error('UK row missing');
    expect(uk.company_number).toBe('08842112');
    expect(uk.license_number).toBeNull();
    expect(uk.registration_number).toBeNull();
    expect(uk.iban).toBeNull();
  });
});
