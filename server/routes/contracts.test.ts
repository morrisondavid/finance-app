/**
 * Regression-lock every /api/contracts route plus the cross-module
 * flow test called out in the plan:
 *
 *   1. GET  /:id/income-accrual           — baseline
 *   2. POST /:id/leave { 3 future Mon-Wed }
 *   3. GET  /:id/income-accrual           — drops by exactly 3 × day_rate
 *   4. GET  /:id/leave                    — 3 rows
 *   5. DELETE /:id/leave/:leaveId         — remove one
 *   6. GET  /:id/income-accrual           — rises by exactly 1 × day_rate
 *
 * The test redirects the leave domain at a temp `working-days/` folder
 * so we never touch the committed CSV; the contracts / clients /
 * company registries still read the real seed data (dc-sow-2026 +
 * lf-2026-mar) because those are configuration rather than test state.
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from 'vitest';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import contractsRouter from './contracts.js';
import {
  LEAVE_CSV_HEADERS,
  invalidateLeaveRegistry,
  setLeaveRegistryWorkingDaysDirForTests,
  setLeaveWorkingDaysDirForTests,
} from '../domain/leave/index.js';
import { invalidateContractRegistry } from '../domain/contracts/registry.js';

function mkTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'contracts-routes-'));
}

function writeEmptyLeaveCsv(dir: string): void {
  fs.writeFileSync(
    path.join(dir, 'leave.csv'),
    `${LEAVE_CSV_HEADERS.join(',')}\n`,
    'utf8',
  );
}

let server: Server;
let baseUrl: string;
let tmpDir: string;

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use('/api/contracts', contractsRouter);
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

/**
 * Pinned test clock — every handler calls `todayIsoLocal()` without
 * an injection point, so the test pins the real system clock to a
 * known date inside both active seed-contract windows. Monday
 * 6 Apr 2026 sits inside `dc-sow-2026` (2026-01-01 → 2026-04-30)
 * and inside `lf-2026-apr` (2026-03-02 → 2026-04-30); `lf-2026-mar`
 * (ended 2026-03-01) is inactive on the pinned date, which is why
 * the two-entity aggregate assertions expect one contract per entity.
 * The accrual reporting window is always the calendar month, so any
 * date inside April works equally well here.
 */
const PINNED_TODAY = '2026-04-06';

describe('/api/contracts routes', () => {
  beforeAll(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(`${PINNED_TODAY}T12:00:00Z`));
    tmpDir = mkTmpDir();
    writeEmptyLeaveCsv(tmpDir);
    setLeaveWorkingDaysDirForTests(tmpDir);
    setLeaveRegistryWorkingDaysDirForTests(tmpDir);
    invalidateLeaveRegistry();
    invalidateContractRegistry();
    await startServer();
  });

  afterAll(async () => {
    await stopServer();
    setLeaveWorkingDaysDirForTests(null);
    setLeaveRegistryWorkingDaysDirForTests(null);
    invalidateLeaveRegistry();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.useRealTimers();
  });

  beforeEach(() => {
    writeEmptyLeaveCsv(tmpDir);
    invalidateLeaveRegistry();
  });

  describe('GET /api/contracts', () => {
    it('returns the committed contracts list', async () => {
      const response = await fetch(`${baseUrl}/api/contracts`);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(Array.isArray(body.contracts)).toBe(true);
      const ids = body.contracts.map((c: { id: string }) => c.id);
      expect(ids).toContain('dc-sow-2026');
      expect(ids).toContain('lf-2026-mar');
      expect(ids).toContain('lf-2026-apr');
    });

    it('exposes both la-fosse contracts with the correct issuing entities', async () => {
      const response = await fetch(`${baseUrl}/api/contracts`);
      const body = await response.json();
      const laFosseRows = body.contracts.filter(
        (c: { client_id: string }) => c.client_id === 'la-fosse',
      );
      const byId = new Map(
        laFosseRows.map((c: { id: string; issuing_entity_id: string }) => [
          c.id,
          c.issuing_entity_id,
        ]),
      );
      expect(byId.get('lf-2026-mar')).toBe('autonize-it-ltd');
      expect(byId.get('lf-2026-apr')).toBe('autonize-it-fzco');
    });
  });

  describe('GET /api/contracts/:id', () => {
    it('returns the contract for a known id', async () => {
      const response = await fetch(`${baseUrl}/api/contracts/dc-sow-2026`);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.contract.id).toBe('dc-sow-2026');
    });

    it('404s on unknown id', async () => {
      const response = await fetch(`${baseUrl}/api/contracts/nonexistent`);
      expect(response.status).toBe(404);
    });
  });

  describe('GET /api/contracts/income-accrual', () => {
    it('returns a well-formed aggregate payload', async () => {
      const response = await fetch(`${baseUrl}/api/contracts/income-accrual`);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(typeof body.today).toBe('string');
      expect(Array.isArray(body.contracts)).toBe(true);
      expect(Array.isArray(body.entities)).toBe(true);
    });

    it('splits the rollup across both autonize-it entities when the FZCO row is active', async () => {
      const response = await fetch(`${baseUrl}/api/contracts/income-accrual`);
      const body = await response.json();
      const byEntity = new Map(
        body.entities.map((e: { issuing_entity_id: string }) => [e.issuing_entity_id, e]),
      );
      expect(byEntity.has('autonize-it-ltd')).toBe(true);
      expect(byEntity.has('autonize-it-fzco')).toBe(true);
      // UK Ltd holds only the DC SOW on the pinned date (lf-2026-mar is inactive);
      // FZCO holds lf-2026-apr.
      expect(
        (byEntity.get('autonize-it-ltd') as { contract_count: number } | undefined)
          ?.contract_count,
      ).toBe(1);
      expect(
        (byEntity.get('autonize-it-fzco') as { contract_count: number } | undefined)
          ?.contract_count,
      ).toBe(1);
    });

    it('surfaces retained-after-tax fields that reconcile per entity', async () => {
      const response = await fetch(`${baseUrl}/api/contracts/income-accrual`);
      const body = await response.json();
      type Rollup = {
        issuing_entity_id: string;
        projected_period_total: number;
        incoming_period_total: number;
        vat_reserve_period: number;
        ct_reserve_period: number;
        retained_period: number;
      };
      const entities = body.entities as Rollup[];
      expect(entities.length).toBeGreaterThan(0);
      for (const entry of entities) {
        expect(typeof entry.incoming_period_total).toBe('number');
        expect(typeof entry.vat_reserve_period).toBe('number');
        expect(typeof entry.ct_reserve_period).toBe('number');
        expect(typeof entry.retained_period).toBe('number');
        expect(
          entry.retained_period + entry.vat_reserve_period + entry.ct_reserve_period,
        ).toBeCloseTo(entry.incoming_period_total, 6);
      }
    });

    it('applies UK VAT + 25% CT on the autonize-it-ltd rollup', async () => {
      const response = await fetch(`${baseUrl}/api/contracts/income-accrual`);
      const body = await response.json();
      const uk = (body.entities as Array<{
        issuing_entity_id: string;
        projected_period_total: number;
        incoming_period_total: number;
        vat_reserve_period: number;
        ct_reserve_period: number;
        retained_period: number;
      }>).find(e => e.issuing_entity_id === 'autonize-it-ltd');
      expect(uk).toBeDefined();
      if (!uk) throw new Error('uk rollup missing');
      expect(uk.vat_reserve_period).toBeCloseTo(uk.projected_period_total * 0.2, 6);
      expect(uk.incoming_period_total).toBeCloseTo(uk.projected_period_total * 1.2, 6);
      expect(uk.ct_reserve_period).toBeCloseTo(uk.projected_period_total * 0.25, 6);
      // retained = incoming(1.2N) − VAT(0.2N) − CT(0.25N) = 0.75N
      expect(uk.retained_period).toBeCloseTo(uk.projected_period_total * 0.75, 6);
    });

    it('zeroes VAT on the autonize-it-fzco rollup (AED, not VAT-registered)', async () => {
      const response = await fetch(`${baseUrl}/api/contracts/income-accrual`);
      const body = await response.json();
      const fzco = (body.entities as Array<{
        issuing_entity_id: string;
        projected_period_total: number;
        incoming_period_total: number;
        vat_reserve_period: number;
      }>).find(e => e.issuing_entity_id === 'autonize-it-fzco');
      expect(fzco).toBeDefined();
      if (!fzco) throw new Error('fzco rollup missing');
      expect(fzco.vat_reserve_period).toBe(0);
      expect(fzco.incoming_period_total).toBeCloseTo(fzco.projected_period_total, 6);
    });
  });

  describe('GET /api/contracts/:id/income-accrual', () => {
    it('returns a well-formed per-contract payload', async () => {
      const response = await fetch(
        `${baseUrl}/api/contracts/dc-sow-2026/income-accrual`,
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.contract_id).toBe('dc-sow-2026');
      expect(body.day_rate).toBe(550);
      expect(typeof body.projected_period_total).toBe('number');
    });

    it('404s on unknown contract', async () => {
      const response = await fetch(
        `${baseUrl}/api/contracts/nonexistent/income-accrual`,
      );
      expect(response.status).toBe(404);
    });
  });

  describe('GET /api/contracts/:id/leave', () => {
    it('returns an empty list when no leave is booked', async () => {
      const response = await fetch(
        `${baseUrl}/api/contracts/dc-sow-2026/leave`,
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.leave).toEqual([]);
    });
  });

  describe('POST /api/contracts/:id/leave', () => {
    it('creates leave rows for valid future dates', async () => {
      const response = await fetch(
        `${baseUrl}/api/contracts/dc-sow-2026/leave`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            dates: ['2026-04-20', '2026-04-21'],
            type: 'holiday',
          }),
        },
      );
      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.created).toBe(2);
      expect(body.leave).toHaveLength(2);
    });

    it('400s on body missing required fields', async () => {
      const response = await fetch(
        `${baseUrl}/api/contracts/dc-sow-2026/leave`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dates: [], type: 'holiday' }),
        },
      );
      expect(response.status).toBe(400);
    });

    it('422 LeaveOutsideContractWindow when a date is outside the window', async () => {
      const response = await fetch(
        `${baseUrl}/api/contracts/dc-sow-2026/leave`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            dates: ['2024-01-01'],
            type: 'holiday',
          }),
        },
      );
      expect(response.status).toBe(422);
      const body = await response.json();
      expect(body.error).toBe('LeaveOutsideContractWindow');
      expect(body.detail.date).toBe('2024-01-01');
    });
  });

  describe('DELETE /api/contracts/:id/leave/:leaveId', () => {
    it('deletes a future-dated row', async () => {
      await fetch(`${baseUrl}/api/contracts/dc-sow-2026/leave`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dates: ['2026-04-27'], type: 'holiday' }),
      });

      const response = await fetch(
        `${baseUrl}/api/contracts/dc-sow-2026/leave/dc-sow-2026-2026-04-27`,
        { method: 'DELETE' },
      );
      expect(response.status).toBe(200);
    });

    it('404s when the leave id does not exist', async () => {
      const response = await fetch(
        `${baseUrl}/api/contracts/dc-sow-2026/leave/ghost-2026-01-01`,
        { method: 'DELETE' },
      );
      expect(response.status).toBe(404);
    });

    it('422 PastLeaveReadOnly when the date is in the past', async () => {
      // Build a past-dated row directly in the temp CSV.
      const pastRow = [
        'dc-sow-2026-2020-01-06',
        'dc-sow-2026',
        '2020-01-06',
        'holiday',
        '',
        'false',
        '2020-01-06',
        '2020-01-06',
      ].join(',');
      fs.writeFileSync(
        path.join(tmpDir, 'leave.csv'),
        `${LEAVE_CSV_HEADERS.join(',')}\n${pastRow}\n`,
        'utf8',
      );
      invalidateLeaveRegistry();

      const response = await fetch(
        `${baseUrl}/api/contracts/dc-sow-2026/leave/dc-sow-2026-2020-01-06`,
        { method: 'DELETE' },
      );
      expect(response.status).toBe(422);
      const body = await response.json();
      expect(body.error).toBe('PastLeaveReadOnly');
    });
  });

  describe('POST /api/contracts/:id/leave-preview', () => {
    it('renders the leave template for a direct client', async () => {
      const response = await fetch(
        `${baseUrl}/api/contracts/dc-sow-2026/leave-preview`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            dates: ['2026-05-04', '2026-05-05'],
            type: 'holiday',
          }),
        },
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(typeof body.subject).toBe('string');
      expect(body.subject.length).toBeGreaterThan(0);
      expect(Array.isArray(body.recipients.to)).toBe(true);
      expect(Array.isArray(body.recipients.cc)).toBe(true);
    });

    it('routes sick leave through the sickness template', async () => {
      const response = await fetch(
        `${baseUrl}/api/contracts/dc-sow-2026/leave-preview`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            dates: ['2026-05-04'],
            type: 'sick',
          }),
        },
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.subject.toLowerCase()).toContain('sick');
    });
  });

  describe('GET /api/contracts/:id/document', () => {
    it('404s with a helpful message when no PDF is committed', async () => {
      const response = await fetch(
        `${baseUrl}/api/contracts/dc-sow-2026/document`,
      );
      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.error).toBe('ContractDocumentNotFound');
      expect(body.detail).toContain('clients/contracts/dc-sow-2026.pdf');
    });

    it('404s on unknown contract id', async () => {
      const response = await fetch(
        `${baseUrl}/api/contracts/nonexistent/document`,
      );
      expect(response.status).toBe(404);
    });
  });

  describe('POST /api/contracts/:id/renew', () => {
    it('returns 501 with a clear "not yet wired up" message for a valid body', async () => {
      const response = await fetch(
        `${baseUrl}/api/contracts/dc-sow-2026/renew`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            start_date: '2027-03-02',
            end_date: '2028-03-01',
            day_rate: 575,
          }),
        },
      );
      expect(response.status).toBe(501);
      const body = await response.json();
      expect(body.error).toBe('RenewFlowNotImplemented');
      expect(body.received.contract_id).toBe('dc-sow-2026');
      expect(body.received.start_date).toBe('2027-03-02');
      expect(body.received.day_rate).toBe(575);
    });

    it('400s on a malformed body', async () => {
      const response = await fetch(
        `${baseUrl}/api/contracts/dc-sow-2026/renew`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ start_date: 'not-a-date' }),
        },
      );
      expect(response.status).toBe(400);
    });

    it('404s on unknown contract id', async () => {
      const response = await fetch(
        `${baseUrl}/api/contracts/nonexistent/renew`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            start_date: '2027-03-02',
            end_date: '2028-03-01',
          }),
        },
      );
      expect(response.status).toBe(404);
    });
  });

  /**
   * End-to-end flow test — the regression lock for the cross-module
   * contract between contracts / leave / income-accrual. `today` is
   * pinned at `PINNED_TODAY` (Mon 6 Apr 2026), so the billing period
   * for dc-sow-2026 (monthly cadence) is 2026-04-01..2026-04-30 and
   * the three booked days fall inside it.
   */
  describe('cross-module flow: accrual <-> leave writes', () => {
    it('drops projected_period_total by exactly 3 × day_rate after a 3-day booking', async () => {
      const baselineRes = await fetch(
        `${baseUrl}/api/contracts/dc-sow-2026/income-accrual`,
      );
      const baseline = await baselineRes.json();
      const dayRate = baseline.day_rate;
      expect(dayRate).toBe(550);

      // Three future Mon-Wed inside the April 2026 billing window.
      const dates = ['2026-04-13', '2026-04-14', '2026-04-15'];
      const bookRes = await fetch(
        `${baseUrl}/api/contracts/dc-sow-2026/leave`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dates, type: 'holiday' }),
        },
      );
      expect(bookRes.status).toBe(201);

      const afterRes = await fetch(
        `${baseUrl}/api/contracts/dc-sow-2026/income-accrual`,
      );
      const after = await afterRes.json();
      expect(baseline.projected_period_total - after.projected_period_total).toBe(
        3 * dayRate,
      );

      const listRes = await fetch(
        `${baseUrl}/api/contracts/dc-sow-2026/leave`,
      );
      const list = await listRes.json();
      expect(list.leave).toHaveLength(3);

      const firstId = list.leave[0].id as string;
      const delRes = await fetch(
        `${baseUrl}/api/contracts/dc-sow-2026/leave/${firstId}`,
        { method: 'DELETE' },
      );
      expect(delRes.status).toBe(200);

      const restoredRes = await fetch(
        `${baseUrl}/api/contracts/dc-sow-2026/income-accrual`,
      );
      const restored = await restoredRes.json();
      expect(
        restored.projected_period_total - after.projected_period_total,
      ).toBe(dayRate);
    });
  });
});
