import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  createInMemoryTestDb,
  resetTestData,
  type TestDbHandles,
} from '../../db/test-harness/in-memory-db.js';
import { classifyInterCompanyPair } from './classify-pair.js';
import {
  __resetOverrideRegistryForTests,
  getOverrideRegistry,
} from './registry.js';
import {
  getOverridesCsvPath,
  readOverridesCsvFile,
} from './csv-io.js';
import { getRateSync } from '../../config/exchange-rates.js';

/**
 * Service-layer regression lock for the POST /classify write path.
 * The HTTP test suite covers happy / error status codes; these tests
 * exercise the pure-ish service function (it does touch the
 * filesystem and invalidate the registry cache) without the express
 * round-trip so failures point directly at business-logic bugs.
 */

function seedPair(
  db: import('better-sqlite3').Database,
  expenseHash: string,
  incomeHash: string,
): void {
  const gbp = 500;
  const aed = gbp * getRateSync('GBP', 'AED');
  db.prepare(
    `INSERT INTO transactions (hash, date, description, amount, account, type)
     VALUES (?, '2026-03-10', 'WISE', ?, 'barclays-current', 'expense')`,
  ).run(expenseHash, -gbp);
  db.prepare(
    `INSERT INTO transactions (hash, date, description, amount, account, type)
     VALUES (?, '2026-03-11', 'Wise', ?, 'emirates-islamic', 'income')`,
  ).run(incomeHash, aed);
}

describe('classifyInterCompanyPair', () => {
  let harness: TestDbHandles;
  let overrideDir: string;

  beforeAll(() => {
    harness = createInMemoryTestDb();
    overrideDir = fs.mkdtempSync(path.join(harness.obligationsDir, '..', 'bsa-test-classify-'));
  });

  afterAll(() => {
    harness.cleanup();
    fs.rmSync(overrideDir, { recursive: true, force: true });
    __resetOverrideRegistryForTests();
  });

  beforeEach(() => {
    resetTestData(harness.db);
    const csvPath = getOverridesCsvPath(overrideDir);
    if (fs.existsSync(csvPath)) fs.rmSync(csvPath);
    __resetOverrideRegistryForTests(overrideDir);
  });

  it('writes two rows (expense + income) sharing the same category, notes, and timestamp', () => {
    seedPair(harness.db, 'e1', 'i1');
    const today = new Date('2026-03-12T12:00:00Z');
    const result = classifyInterCompanyPair(harness.db, {
      expenseHash: 'e1',
      incomeHash: 'i1',
      category: 'Inter-company Loan',
      notes: 'Wise routing',
      today,
    });
    expect(result.ok).toBe(true);

    const rows = readOverridesCsvFile(getOverridesCsvPath(overrideDir));
    expect(rows).toHaveLength(2);
    expect(rows?.map(r => r.hash).sort()).toEqual(['e1', 'i1']);
    expect(rows?.every(r => r.category === 'Inter-company Loan')).toBe(true);
    expect(rows?.every(r => r.notes === 'Wise routing')).toBe(true);
    expect(rows?.every(r => r.classified_at === '2026-03-12')).toBe(true);
  });

  it('invalidates the registry so the next read sees the new override', () => {
    seedPair(harness.db, 'e2', 'i2');
    classifyInterCompanyPair(harness.db, {
      expenseHash: 'e2',
      incomeHash: 'i2',
      category: 'Capital Contribution',
      notes: null,
    });
    expect(getOverrideRegistry().get('e2')).toBe('Capital Contribution');
    expect(getOverrideRegistry().get('i2')).toBe('Capital Contribution');
  });

  it('clears both sides when category is null, preserving unrelated overrides', () => {
    seedPair(harness.db, 'e3', 'i3');
    // Pre-seed an unrelated override so we can verify it survives.
    const existing = getOverridesCsvPath(overrideDir);
    fs.writeFileSync(
      existing,
      [
        'hash,category,notes,classified_at',
        'other-hash,Groceries,,2026-02-01',
        'e3,Inter-company Loan,,2026-03-12',
        'i3,Inter-company Loan,,2026-03-12',
      ].join('\n') + '\n',
    );
    __resetOverrideRegistryForTests(overrideDir);

    const result = classifyInterCompanyPair(harness.db, {
      expenseHash: 'e3',
      incomeHash: 'i3',
      category: null,
      notes: null,
    });
    expect(result.ok).toBe(true);

    const after = readOverridesCsvFile(existing);
    expect(after).toHaveLength(1);
    expect(after?.[0].hash).toBe('other-hash');
  });

  it('rejects categories outside the inter-company set', () => {
    seedPair(harness.db, 'e4', 'i4');
    const result = classifyInterCompanyPair(harness.db, {
      expenseHash: 'e4',
      incomeHash: 'i4',
      category: 'Groceries',
      notes: null,
    });
    expect(result).toEqual({ ok: false, status: 400, error: expect.stringContaining('not a inter-company category') });
  });

  it('rejects unknown hashes with 404', () => {
    seedPair(harness.db, 'e5', 'i5');
    const result = classifyInterCompanyPair(harness.db, {
      expenseHash: 'does-not-exist',
      incomeHash: 'i5',
      category: 'Inter-company Loan',
      notes: null,
    });
    expect(result).toEqual({ ok: false, status: 404, error: expect.stringContaining('does-not-exist') });
  });

  it('rejects hashes that do not form a detected pair', () => {
    seedPair(harness.db, 'e6', 'i6');
    seedPair(harness.db, 'e7', 'i7');
    // Move e7's pair date so the pair finder isolates them into
    // separate pairs rather than matching e7 with i6.
    harness.db.prepare(`UPDATE transactions SET date = '2026-06-10' WHERE hash = 'e7'`).run();
    harness.db.prepare(`UPDATE transactions SET date = '2026-06-11' WHERE hash = 'i7'`).run();

    const result = classifyInterCompanyPair(harness.db, {
      expenseHash: 'e6',
      incomeHash: 'i7',
      category: 'Inter-company Loan',
      notes: null,
    });
    expect(result).toEqual({ ok: false, status: 400, error: expect.stringContaining('detected inter-company pair') });
  });

  it('upserts — prior rows for the same hashes are replaced, not appended', () => {
    seedPair(harness.db, 'e8', 'i8');
    classifyInterCompanyPair(harness.db, {
      expenseHash: 'e8',
      incomeHash: 'i8',
      category: 'Inter-company Loan',
      notes: 'first',
    });
    classifyInterCompanyPair(harness.db, {
      expenseHash: 'e8',
      incomeHash: 'i8',
      category: 'Capital Contribution',
      notes: 'second',
    });
    const rows = readOverridesCsvFile(getOverridesCsvPath(overrideDir));
    expect(rows).toHaveLength(2);
    expect(rows?.every(r => r.category === 'Capital Contribution')).toBe(true);
    expect(rows?.every(r => r.notes === 'second')).toBe(true);
  });
});
