import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import {
  createInMemoryTestDb,
  resetTestData,
  type TestDbHandles,
} from '../db/test-harness/in-memory-db.js';
import fs from 'fs';
import path from 'path';
import {
  EntityFoundationWarningsResponseSchema,
  InterCompanyMovementsResponseSchema,
} from '../../shared/api-contracts.js';
import { getRateSync } from '../config/exchange-rates.js';
import { __resetOverrideRegistryForTests } from '../domain/transaction-overrides/registry.js';
import {
  getOverridesCsvPath,
  writeOverridesCsvFile,
} from '../domain/transaction-overrides/csv-io.js';

/**
 * Route-level regression lock for /api/warnings/entity-foundation
 * (Roadmap 1.1 Phase 7). Wires the real company registry + in-memory
 * DB so the pure derivation function, the inter-company counter, the
 * AED trailing-12m summer, and the Zod response envelope all fire
 * together — a bug anywhere in that stack surfaces here.
 */

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
}));

import warningsRouter from './warnings.js';

let server: Server;
let baseUrl: string;
let hashSeq = 0;

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use('/api/warnings', warningsRouter);
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

function insertTx(account: string, type: 'income' | 'expense', date: string, amount: number): void {
  if (!harness.current) throw new Error('test db not initialised');
  hashSeq++;
  harness.current.db.prepare(`
    INSERT INTO transactions (hash, date, description, amount, account, type)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(`hash-${hashSeq}`, date, 'test', amount, account, type);
}

beforeAll(async () => {
  harness.current = createInMemoryTestDb();
  await startServer();
});

afterAll(async () => {
  await stopServer();
  harness.current?.cleanup();
});

describe('GET /api/warnings/entity-foundation', () => {
  beforeEach(() => {
    if (harness.current) resetTestData(harness.current.db);
    hashSeq = 0;
  });

  it('returns a valid response envelope', async () => {
    const resp = await fetch(`${baseUrl}/api/warnings/entity-foundation`);
    expect(resp.status).toBe(200);
    const body = await resp.json();
    const parsed = EntityFoundationWarningsResponseSchema.safeParse(body);
    expect(parsed.success).toBe(true);
  });

  it('surfaces the seed CSV TBC state — FZCO still has vat_registered=TBC, so the company-tbc-fields code appears on FZCO only', async () => {
    const resp = await fetch(`${baseUrl}/api/warnings/entity-foundation`);
    const body = await resp.json();
    const parsed = EntityFoundationWarningsResponseSchema.parse(body);
    const codes = parsed.warnings.map(w => w.code);
    // autonize-it/company.csv has been progressively resolved. At the
    // time of writing only `vat_registered` remains TBC on the FZCO,
    // which is enough to surface the company-tbc-fields branch for
    // that entity. The UK entity is fully resolved. As more fields
    // get answered upstream this assertion will need to relax (or
    // the test will need reframing against a fixture CSV); until
    // then it's the cleanest regression-lock on "the warning fires
    // iff a TBC literal survives the registry".
    expect(codes).toContain('company-tbc-fields');
    const fzcoWarning = parsed.warnings.find(
      w => w.code === 'company-tbc-fields' && w.id.endsWith('autonize-it-fzco'),
    );
    expect(fzcoWarning).toBeDefined();
    expect(fzcoWarning?.detail).toContain('vat_registered');
    // CT gate is now resolved (ct_registered=true, qfzp_elected=true),
    // so the fzco-ct-status-unknown branch must NOT appear.
    expect(codes).not.toContain('fzco-ct-status-unknown');
  });

  it('detects a inter-company pair (Barclays → Emirates Islamic) and emits the aggregate warning', async () => {
    // FX-aware: the Emirates Islamic side is AED, the Barclays side
    // is GBP, so we have to convert to land inside CROSS_CURRENCY_TOLERANCE.
    const gbp = 1_500;
    const aed = gbp * getRateSync('GBP', 'AED');
    insertTx('barclays-current', 'expense', '2026-03-10', -gbp);
    insertTx('emirates-islamic', 'income', '2026-03-11', aed);

    const resp = await fetch(`${baseUrl}/api/warnings/entity-foundation`);
    const body = await resp.json();
    const parsed = EntityFoundationWarningsResponseSchema.parse(body);
    const cross = parsed.warnings.find(w => w.code === 'inter-company-movement-unclassified');
    expect(cross).toBeDefined();
  });

  it('does not emit inter-company warning when the matching transactions are within the same entity', async () => {
    insertTx('barclays-current', 'expense', '2026-03-10', -1_500);
    insertTx('barclays-savings', 'income', '2026-03-11', 1_500);

    const resp = await fetch(`${baseUrl}/api/warnings/entity-foundation`);
    const body = await resp.json();
    const parsed = EntityFoundationWarningsResponseSchema.parse(body);
    expect(parsed.warnings.map(w => w.code)).not.toContain('inter-company-movement-unclassified');
  });

  it('emits mandatory UAE VAT warning when trailing-12m FZCO income reaches AED 375,000', async () => {
    const recent = isoDaysAgo(30);
    insertTx('emirates-islamic', 'income', recent, 380_000);

    const resp = await fetch(`${baseUrl}/api/warnings/entity-foundation`);
    const body = await resp.json();
    const parsed = EntityFoundationWarningsResponseSchema.parse(body);
    const codes = parsed.warnings.map(w => w.code);
    expect(codes).toContain('fzco-vat-mandatory-threshold-crossed');
    expect(codes).not.toContain('fzco-vat-voluntary-threshold-crossed');
  });

  it('does not count FZCO income older than 12 months toward the threshold', async () => {
    const tooOld = isoDaysAgo(400);
    insertTx('emirates-islamic', 'income', tooOld, 500_000);

    const resp = await fetch(`${baseUrl}/api/warnings/entity-foundation`);
    const body = await resp.json();
    const parsed = EntityFoundationWarningsResponseSchema.parse(body);
    const codes = parsed.warnings.map(w => w.code);
    expect(codes).not.toContain('fzco-vat-mandatory-threshold-crossed');
    expect(codes).not.toContain('fzco-vat-voluntary-threshold-crossed');
  });
});

describe('GET /api/warnings/inter-company-movements', () => {
  let overrideDir: string;

  beforeAll(() => {
    if (!harness.current) throw new Error('test harness not initialised');
    overrideDir = fs.mkdtempSync(path.join(harness.current.obligationsDir, '..', 'bsa-test-xem-get-'));
    __resetOverrideRegistryForTests(overrideDir);
  });

  afterAll(() => {
    __resetOverrideRegistryForTests();
    fs.rmSync(overrideDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    if (harness.current) resetTestData(harness.current.db);
    hashSeq = 0;
    const csvPath = getOverridesCsvPath(overrideDir);
    if (fs.existsSync(csvPath)) fs.rmSync(csvPath);
    __resetOverrideRegistryForTests(overrideDir);
  });

  function insertPair(expenseHash: string, incomeHash: string, date: string): void {
    if (!harness.current) throw new Error('test db not initialised');
    const gbp = 1_000;
    const aed = gbp * getRateSync('GBP', 'AED');
    const incomeDate = addDays(date, 1);
    harness.current.db
      .prepare(
        `INSERT INTO transactions (hash, date, description, amount, account, type)
         VALUES (?, ?, 'WISE', ?, 'barclays-current', 'expense')`,
      )
      .run(expenseHash, date, -gbp);
    harness.current.db
      .prepare(
        `INSERT INTO transactions (hash, date, description, amount, account, type)
         VALUES (?, ?, 'Wise deposit', ?, 'emirates-islamic', 'income')`,
      )
      .run(incomeHash, incomeDate, aed);
  }

  it('returns an empty payload when no pairs exist', async () => {
    const resp = await fetch(`${baseUrl}/api/warnings/inter-company-movements`);
    expect(resp.status).toBe(200);
    const body = await resp.json();
    const parsed = InterCompanyMovementsResponseSchema.parse(body);
    expect(parsed).toEqual({ pairs: [], classified: 0, unclassified: 0, total: 0 });
  });

  it('lists each detected pair with a null classification when no overrides exist', async () => {
    insertPair('exp-1', 'inc-1', '2026-03-10');

    const resp = await fetch(`${baseUrl}/api/warnings/inter-company-movements`);
    const body = await resp.json();
    const parsed = InterCompanyMovementsResponseSchema.parse(body);
    expect(parsed.total).toBe(1);
    expect(parsed.classified).toBe(0);
    expect(parsed.unclassified).toBe(1);
    expect(parsed.pairs[0].expense.hash).toBe('exp-1');
    expect(parsed.pairs[0].income.hash).toBe('inc-1');
    expect(parsed.pairs[0].classification).toBeNull();
  });

  it('applies a inter-company override and marks the pair classified', async () => {
    insertPair('exp-2', 'inc-2', '2026-04-10');
    writeOverridesCsvFile(getOverridesCsvPath(overrideDir), [
      {
        hash: 'exp-2',
        category: 'Inter-company Loan',
        notes: 'Wise routing for savings',
        classified_at: '2026-04-12',
      },
    ]);
    __resetOverrideRegistryForTests(overrideDir);

    const resp = await fetch(`${baseUrl}/api/warnings/inter-company-movements`);
    const body = await resp.json();
    const parsed = InterCompanyMovementsResponseSchema.parse(body);
    expect(parsed.classified).toBe(1);
    expect(parsed.unclassified).toBe(0);
    expect(parsed.pairs[0].classification).toBe('Inter-company Loan');
  });

  it('prefers the expense-side override when both sides are classified', async () => {
    insertPair('exp-3', 'inc-3', '2026-05-10');
    writeOverridesCsvFile(getOverridesCsvPath(overrideDir), [
      {
        hash: 'exp-3',
        category: 'Inter-company Loan',
        notes: null,
        classified_at: '2026-05-12',
      },
      {
        hash: 'inc-3',
        category: 'Capital Contribution',
        notes: null,
        classified_at: '2026-05-12',
      },
    ]);
    __resetOverrideRegistryForTests(overrideDir);

    const resp = await fetch(`${baseUrl}/api/warnings/inter-company-movements`);
    const body = await resp.json();
    const parsed = InterCompanyMovementsResponseSchema.parse(body);
    expect(parsed.pairs[0].classification).toBe('Inter-company Loan');
  });

  it('ignores non-inter-company overrides for the classification field', async () => {
    insertPair('exp-4', 'inc-4', '2026-06-10');
    writeOverridesCsvFile(getOverridesCsvPath(overrideDir), [
      {
        hash: 'exp-4',
        category: 'Groceries',
        notes: null,
        classified_at: '2026-06-12',
      },
    ]);
    __resetOverrideRegistryForTests(overrideDir);

    const resp = await fetch(`${baseUrl}/api/warnings/inter-company-movements`);
    const body = await resp.json();
    const parsed = InterCompanyMovementsResponseSchema.parse(body);
    expect(parsed.pairs[0].classification).toBeNull();
    expect(parsed.classified).toBe(0);
  });
});

describe('POST /api/warnings/inter-company-movements/classify', () => {
  let overrideDir: string;

  beforeAll(() => {
    if (!harness.current) throw new Error('test harness not initialised');
    overrideDir = fs.mkdtempSync(path.join(harness.current.obligationsDir, '..', 'bsa-test-xem-post-'));
    __resetOverrideRegistryForTests(overrideDir);
  });

  afterAll(() => {
    __resetOverrideRegistryForTests();
    fs.rmSync(overrideDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    if (harness.current) resetTestData(harness.current.db);
    hashSeq = 0;
    const csvPath = getOverridesCsvPath(overrideDir);
    if (fs.existsSync(csvPath)) fs.rmSync(csvPath);
    __resetOverrideRegistryForTests(overrideDir);
  });

  function insertPair(expenseHash: string, incomeHash: string, date: string): void {
    if (!harness.current) throw new Error('test db not initialised');
    const gbp = 1_000;
    const aed = gbp * getRateSync('GBP', 'AED');
    const incomeDate = addDays(date, 1);
    harness.current.db
      .prepare(
        `INSERT INTO transactions (hash, date, description, amount, account, type)
         VALUES (?, ?, 'WISE', ?, 'barclays-current', 'expense')`,
      )
      .run(expenseHash, date, -gbp);
    harness.current.db
      .prepare(
        `INSERT INTO transactions (hash, date, description, amount, account, type)
         VALUES (?, ?, 'Wise deposit', ?, 'emirates-islamic', 'income')`,
      )
      .run(incomeHash, incomeDate, aed);
  }

  async function post(body: unknown): Promise<Response> {
    return fetch(`${baseUrl}/api/warnings/inter-company-movements/classify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('classifies a detected pair and returns the refreshed payload', async () => {
    insertPair('exp-ok', 'inc-ok', '2026-03-10');
    const resp = await post({
      expenseHash: 'exp-ok',
      incomeHash: 'inc-ok',
      category: 'Inter-company Loan',
      notes: 'UK Ltd → FZCO savings routing',
    });
    expect(resp.status).toBe(200);
    const body = await resp.json();
    const parsed = InterCompanyMovementsResponseSchema.parse(body);
    expect(parsed.classified).toBe(1);
    expect(parsed.pairs[0].classification).toBe('Inter-company Loan');

    const rows = fs
      .readFileSync(getOverridesCsvPath(overrideDir), 'utf8')
      .trim()
      .split('\n');
    // header + 2 data rows (one per side)
    expect(rows).toHaveLength(3);
    expect(rows[1]).toContain('exp-ok,Inter-company Loan');
    expect(rows[2]).toContain('inc-ok,Inter-company Loan');
  });

  it('clears both sides when category is null', async () => {
    insertPair('exp-clr', 'inc-clr', '2026-04-10');
    writeOverridesCsvFile(getOverridesCsvPath(overrideDir), [
      { hash: 'exp-clr', category: 'Inter-company Loan', notes: null, classified_at: '2026-04-11' },
      { hash: 'inc-clr', category: 'Inter-company Loan', notes: null, classified_at: '2026-04-11' },
    ]);
    __resetOverrideRegistryForTests(overrideDir);

    const resp = await post({
      expenseHash: 'exp-clr',
      incomeHash: 'inc-clr',
      category: null,
    });
    expect(resp.status).toBe(200);
    const body = await resp.json();
    const parsed = InterCompanyMovementsResponseSchema.parse(body);
    expect(parsed.classified).toBe(0);
    expect(parsed.unclassified).toBe(1);
    const written = fs.readFileSync(getOverridesCsvPath(overrideDir), 'utf8').trim().split('\n');
    expect(written).toEqual(['hash,category,notes,classified_at']);
  });

  it('rejects unknown hashes with 404', async () => {
    insertPair('exp-real', 'inc-real', '2026-05-10');
    const resp = await post({
      expenseHash: 'exp-ghost',
      incomeHash: 'inc-real',
      category: 'Inter-company Loan',
    });
    expect(resp.status).toBe(404);
    const body = (await resp.json()) as { error: string };
    expect(body.error).toContain('exp-ghost');
  });

  it('rejects hashes that do not form a detected pair with 400', async () => {
    insertPair('exp-a', 'inc-a', '2026-06-10');
    insertPair('exp-b', 'inc-b', '2026-07-10');
    const resp = await post({
      expenseHash: 'exp-a',
      incomeHash: 'inc-b',
      category: 'Inter-company Loan',
    });
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { error: string };
    expect(body.error).toMatch(/detected inter-company pair/);
  });

  it('rejects non-inter-company categories at the schema layer with 400', async () => {
    insertPair('exp-cat', 'inc-cat', '2026-08-10');
    const resp = await post({
      expenseHash: 'exp-cat',
      incomeHash: 'inc-cat',
      category: 'Groceries',
    });
    expect(resp.status).toBe(400);
  });

  it('accepts the full inter-company category enum', async () => {
    const allowed = [
      'Inter-company Loan',
      'Capital Contribution',
      'Inter-company Service Fee',
      'Inter-company False Positive',
      'Inter-company Other',
    ] as const;
    for (const category of allowed) {
      if (harness.current) resetTestData(harness.current.db);
      const csvPath = getOverridesCsvPath(overrideDir);
      if (fs.existsSync(csvPath)) fs.rmSync(csvPath);
      __resetOverrideRegistryForTests(overrideDir);
      const expenseHash = `exp-${category}`;
      const incomeHash = `inc-${category}`;
      insertPair(expenseHash, incomeHash, '2026-09-10');
      const resp = await post({
        expenseHash,
        incomeHash,
        category,
      });
      expect(resp.status, `${category} should be accepted`).toBe(200);
      const body = await resp.json();
      const parsed = InterCompanyMovementsResponseSchema.parse(body);
      expect(parsed.pairs[0].classification).toBe(category);
    }
  });
});

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
