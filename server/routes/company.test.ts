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

  it('GET / reports the FZCO VAT registration state as `false` (UAE entity is below the mandatory threshold and has not elected voluntary registration)', async () => {
    // When the UAE entity was first added `vat_registered` was left
    // as the `TBC` literal because the accountant discussion hadn't
    // happened yet. That discussion now has: Autonize IT FZCO is not
    // VAT-registered in the UAE (income is below the AED 375k
    // mandatory threshold and the La Fosse self-bill assumes
    // reverse-charge). Locking `false` here guards against accidental
    // regressions to `TBC` (which would silently re-fire the
    // `company-tbc-fields` warning). If the FZCO ever registers for
    // VAT this flips to `true` in company.csv, and this expectation
    // plus the related warnings assertion should move with it.
    const resp = await fetch(`${baseUrl}/api/company`);
    const body = await resp.json();
    const parsed = CompaniesListResponseSchema.parse(body);
    const uae = parsed.companies.find(c => c.id === 'autonize-it-fzco');
    if (!uae || uae.jurisdiction !== 'UAE') throw new Error('UAE row missing');
    expect(uae.vat_registered).toBe(false);
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
