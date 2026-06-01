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
 * company registries still read the real seed data (dc-sow-jun-2026 +
 * lf-2026-may) because those are configuration rather than test state.
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
import type { ContractId } from '../../shared/api-contracts.js';

// The real resolver reads from the SQLite `transactions` table, which
// isn't initialised by this test file (it only exercises the CSV-backed
// registries). Mock the module so every test runs against a caller-
// controlled `Map<ContractId, string | null>` instead of the DB.
//
// `lastPaymentOverrides` is the shared state the tests mutate: default
// is an empty map (no matched payments → owed window falls back to
// month-start, which is equivalent to the pre-shipment behaviour). The
// new "matched income" tests at the bottom populate it before exercising
// the endpoint.
const lastPaymentOverrides = new Map<ContractId, string | null>();
vi.mock('../domain/contracts/last-payment-resolver.js', () => ({
  resolveLastPaymentsForContracts: ({
    contracts,
  }: {
    contracts: ReadonlyArray<{ id: ContractId }>;
  }): Map<ContractId, string | null> => {
    const out = new Map<ContractId, string | null>();
    for (const c of contracts) {
      out.set(c.id, lastPaymentOverrides.get(c.id) ?? null);
    }
    return out;
  },
}));

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
 * 15 Jun 2026 sits inside `dc-sow-jun-2026` (2026-05-01 → 2026-06-30)
 * and inside `lf-2026-may` (from 2026-05-01, open-ended).
 * The accrual reporting window is always the calendar month.
 */
const PINNED_TODAY = '2026-06-15';

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
    lastPaymentOverrides.clear();
  });

  describe('GET /api/contracts', () => {
    it('returns the committed contracts list', async () => {
      const response = await fetch(`${baseUrl}/api/contracts`);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(Array.isArray(body.contracts)).toBe(true);
      const ids = body.contracts.map((c: { id: string }) => c.id);
      expect(ids).toContain('dc-sow-jun-2026');
      expect(ids).toContain('lf-2026-mar');
      expect(ids).toContain('lf-2026-may');
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
      expect(byId.get('lf-2026-may')).toBe('autonize-it-fzco');
    });
  });

  describe('GET /api/contracts/:id', () => {
    it('returns the contract for a known id', async () => {
      const response = await fetch(`${baseUrl}/api/contracts/dc-sow-jun-2026`);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.contract.id).toBe('dc-sow-jun-2026');
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
      // FZCO holds lf-2026-may.
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

    it('returns a combined totals block that reconciles with the entity rollups', async () => {
      const response = await fetch(`${baseUrl}/api/contracts/income-accrual`);
      const body = await response.json() as {
        entities: Array<{
          currency: string;
          contract_count: number;
          accrued_to_date: number;
          projected_period_total: number;
          incoming_period_total: number;
          vat_reserve_period: number;
          ct_reserve_period: number;
          retained_period: number;
        }>;
        totals: {
          currency: string;
          contract_count: number;
          entity_count: number;
          accrued_to_date: number;
          projected_period_total: number;
          incoming_period_total: number;
          vat_reserve_period: number;
          ct_reserve_period: number;
          retained_period: number;
        } | null;
      };
      expect(body.totals).not.toBeNull();
      if (body.totals === null) throw new Error('totals missing');

      const sumOf = (key: keyof typeof body.entities[number]) =>
        body.entities.reduce((acc, e) => acc + (e[key] as number), 0);

      expect(body.totals.entity_count).toBe(body.entities.length);
      expect(body.totals.contract_count).toBe(
        body.entities.reduce((acc, e) => acc + e.contract_count, 0),
      );
      expect(body.totals.accrued_to_date).toBeCloseTo(sumOf('accrued_to_date'), 6);
      expect(body.totals.projected_period_total).toBeCloseTo(
        sumOf('projected_period_total'),
        6,
      );
      expect(body.totals.incoming_period_total).toBeCloseTo(
        sumOf('incoming_period_total'),
        6,
      );
      expect(body.totals.vat_reserve_period).toBeCloseTo(sumOf('vat_reserve_period'), 6);
      expect(body.totals.ct_reserve_period).toBeCloseTo(sumOf('ct_reserve_period'), 6);
      expect(body.totals.retained_period).toBeCloseTo(sumOf('retained_period'), 6);

      // Self-reconciliation: incoming == retained + VAT + CT
      expect(
        body.totals.retained_period +
          body.totals.vat_reserve_period +
          body.totals.ct_reserve_period,
      ).toBeCloseTo(body.totals.incoming_period_total, 6);
    });
  });

  describe('GET /api/contracts/:id/income-accrual', () => {
    it('returns a well-formed per-contract payload', async () => {
      const response = await fetch(
        `${baseUrl}/api/contracts/dc-sow-jun-2026/income-accrual`,
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.contract_id).toBe('dc-sow-jun-2026');
      expect(body.day_rate).toBe(555);
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
        `${baseUrl}/api/contracts/dc-sow-jun-2026/leave`,
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.leave).toEqual([]);
    });
  });

  describe('POST /api/contracts/:id/leave', () => {
    it('creates leave rows for valid future dates', async () => {
      const response = await fetch(
        `${baseUrl}/api/contracts/dc-sow-jun-2026/leave`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            dates: ['2026-06-16', '2026-06-17'],
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
        `${baseUrl}/api/contracts/dc-sow-jun-2026/leave`,
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
        `${baseUrl}/api/contracts/dc-sow-jun-2026/leave`,
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
      await fetch(`${baseUrl}/api/contracts/dc-sow-jun-2026/leave`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dates: ['2026-06-20'], type: 'holiday' }),
      });

      const response = await fetch(
        `${baseUrl}/api/contracts/dc-sow-jun-2026/leave/dc-sow-jun-2026-2026-06-20`,
        { method: 'DELETE' },
      );
      expect(response.status).toBe(200);
    });

    it('404s when the leave id does not exist', async () => {
      const response = await fetch(
        `${baseUrl}/api/contracts/dc-sow-jun-2026/leave/ghost-2026-01-01`,
        { method: 'DELETE' },
      );
      expect(response.status).toBe(404);
    });

    it('422 PastLeaveReadOnly when the date is in the past', async () => {
      // Build a past-dated row directly in the temp CSV.
      const pastRow = [
        'dc-sow-jun-2026-2020-01-06',
        'dc-sow-jun-2026',
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
        `${baseUrl}/api/contracts/dc-sow-jun-2026/leave/dc-sow-jun-2026-2020-01-06`,
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
        `${baseUrl}/api/contracts/dc-sow-jun-2026/leave-preview`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            dates: ['2026-06-16', '2026-06-17'],
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
        `${baseUrl}/api/contracts/dc-sow-jun-2026/leave-preview`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            dates: ['2026-06-16'],
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
        `${baseUrl}/api/contracts/dc-sow-jun-2026/document`,
      );
      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.error).toBe('ContractDocumentNotFound');
      expect(body.detail).toContain('clients/contracts/dc-sow-jun-2026.pdf');
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
        `${baseUrl}/api/contracts/dc-sow-jun-2026/renew`,
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
      expect(body.received.contract_id).toBe('dc-sow-jun-2026');
      expect(body.received.start_date).toBe('2027-03-02');
      expect(body.received.day_rate).toBe(575);
    });

    it('400s on a malformed body', async () => {
      const response = await fetch(
        `${baseUrl}/api/contracts/dc-sow-jun-2026/renew`,
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

  describe('GET /api/contracts/:id/income-accrual — since-last-payment semantics', () => {
    it('rebases worked/accrued onto the day AFTER the matched invoice payment', async () => {
      lastPaymentOverrides.set('dc-sow-jun-2026', '2026-06-03');
      const response = await fetch(
        `${baseUrl}/api/contracts/dc-sow-jun-2026/income-accrual`,
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.owed_window_start).toBe('2026-06-04');
      expect(body.owed_window_end).toBe('2026-06-15');
      expect(body.worked_days_to_date).toBe(8);
      expect(body.accrued_to_date).toBe(8 * 555);
      expect(body.projected_period_total).toBe(22 * 555);
    });

    it('ended contract with no payment: owed window covers its final worked month', async () => {
      // lf-2026-may ended 2026-05-31; today is 2026-06-15. With no matched
      // payment the owed window falls back to the *end* month (May), not the
      // current calendar month, so the final unpaid month still accrues. The
      // projection window (June) is empty because the contract has ended.
      const response = await fetch(
        `${baseUrl}/api/contracts/lf-2026-may/income-accrual`,
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.owed_window_start).toBe('2026-05-01');
      expect(body.owed_window_end).toBe('2026-05-31');
      expect(body.projected_period_total).toBe(0);
    });
  });

  describe('GET /api/contracts/income-accrual — aggregate preserves totals with mixed payment states', () => {
    it('per-entity retained/VAT/CT totals are invariant to last-payment matching', async () => {
      // Without any overrides, owed falls back to month-start.
      const before = await (
        await fetch(`${baseUrl}/api/contracts/income-accrual`)
      ).json() as {
        entities: Array<{
          issuing_entity_id: string;
          projected_period_total: number;
          retained_period: number;
          vat_reserve_period: number;
          ct_reserve_period: number;
          incoming_period_total: number;
        }>;
      };

      // Now seed a matched payment for DC only. Accrued should drop,
      // but projection (and therefore every Retained/VAT/CT figure) must
      // stay identical — those read off projection, not owed.
      lastPaymentOverrides.set('dc-sow-jun-2026', '2026-06-03');
      const after = await (
        await fetch(`${baseUrl}/api/contracts/income-accrual`)
      ).json() as typeof before;

      for (const entityId of ['autonize-it-ltd', 'autonize-it-fzco']) {
        const b = before.entities.find(e => e.issuing_entity_id === entityId);
        const a = after.entities.find(e => e.issuing_entity_id === entityId);
        expect(b).toBeDefined();
        expect(a).toBeDefined();
        if (b === undefined || a === undefined) throw new Error('entity missing');
        expect(a.projected_period_total).toBeCloseTo(b.projected_period_total, 6);
        expect(a.retained_period).toBeCloseTo(b.retained_period, 6);
        expect(a.vat_reserve_period).toBeCloseTo(b.vat_reserve_period, 6);
        expect(a.ct_reserve_period).toBeCloseTo(b.ct_reserve_period, 6);
        expect(a.incoming_period_total).toBeCloseTo(b.incoming_period_total, 6);
      }
    });

    it('per-contract accrued reflects the seeded matched payment on DC only', async () => {
      lastPaymentOverrides.set('dc-sow-jun-2026', '2026-06-03');
      const body = await (
        await fetch(`${baseUrl}/api/contracts/income-accrual`)
      ).json() as {
        contracts: Array<{
          contract_id: string;
          owed_window_start: string;
          accrued_to_date: number;
          day_rate: number;
        }>;
      };
      const dc = body.contracts.find(c => c.contract_id === 'dc-sow-jun-2026');
      const fzco = body.contracts.find(c => c.contract_id === 'lf-2026-may');
      expect(dc).toBeDefined();
      expect(fzco).toBeDefined();
      if (dc === undefined || fzco === undefined) throw new Error('contract missing');
      expect(dc.owed_window_start).toBe('2026-06-04');
      // 2026-06-04 Thu through 2026-06-15 Mon → 8 working days × £555
      expect(dc.accrued_to_date).toBe(8 * 555);
      // lf-2026-may ended 2026-05-31; owed falls back to its end month (May).
      expect(fzco.owed_window_start).toBe('2026-05-01');
    });
  });

  /**
   * End-to-end flow test — the regression lock for the cross-module
   * contract between contracts / leave / income-accrual. `today` is
   * pinned at `PINNED_TODAY` (Mon 15 Jun 2026), so the billing period
   * for dc-sow-jun-2026 (monthly cadence) is 2026-06-01..2026-06-30 and
   * the three booked days fall inside it.
   */
  describe('cross-module flow: accrual <-> leave writes', () => {
    it('drops projected_period_total by exactly 3 × day_rate after a 3-day booking', async () => {
      const baselineRes = await fetch(
        `${baseUrl}/api/contracts/dc-sow-jun-2026/income-accrual`,
      );
      const baseline = await baselineRes.json();
      const dayRate = baseline.day_rate;
      expect(dayRate).toBe(555);

      const dates = ['2026-06-16', '2026-06-17', '2026-06-18'];
      const bookRes = await fetch(
        `${baseUrl}/api/contracts/dc-sow-jun-2026/leave`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dates, type: 'holiday' }),
        },
      );
      expect(bookRes.status).toBe(201);

      const afterRes = await fetch(
        `${baseUrl}/api/contracts/dc-sow-jun-2026/income-accrual`,
      );
      const after = await afterRes.json();
      expect(baseline.projected_period_total - after.projected_period_total).toBe(
        3 * dayRate,
      );

      const listRes = await fetch(
        `${baseUrl}/api/contracts/dc-sow-jun-2026/leave`,
      );
      const list = await listRes.json();
      expect(list.leave).toHaveLength(3);

      const firstId = list.leave[0].id as string;
      const delRes = await fetch(
        `${baseUrl}/api/contracts/dc-sow-jun-2026/leave/${firstId}`,
        { method: 'DELETE' },
      );
      expect(delRes.status).toBe(200);

      const restoredRes = await fetch(
        `${baseUrl}/api/contracts/dc-sow-jun-2026/income-accrual`,
      );
      const restored = await restoredRes.json();
      expect(
        restored.projected_period_total - after.projected_period_total,
      ).toBe(dayRate);
    });
  });
});
