import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  createInMemoryTestDb,
  resetTestData,
  type TestDbHandles,
} from '../../db/test-harness/in-memory-db.js';
import { countUnclassifiedInterCompanyPairs } from './inter-company-count.js';
import { __resetOverrideRegistryForTests } from '../transaction-overrides/registry.js';
import {
  writeOverridesCsvFile,
  getOverridesCsvPath,
} from '../transaction-overrides/csv-io.js';
import { getRateSync } from '../../config/exchange-rates.js';
import type { TransactionCategoryOverrideRow } from '../../../shared/api-contracts.js';

/**
 * Step 6 regression lock: one aggregate count over every
 * inter-company pair produced by `findInterCompanyPairs`, with
 * classification applied via the override registry.
 *
 * Four branches, each a test:
 *   - No overrides → every pair counts.
 *   - Override on one side only → pair suppressed.
 *   - `Inter-company False Positive` → pair suppressed (it's still
 *     inside INTER_COMPANY_CATEGORIES).
 *   - Non-inter-company override (e.g. `Groceries`) → pair still
 *     counts; the override CSV is general-purpose so arbitrary
 *     categories are allowed, but only the inter-company subset
 *     resolves the warning.
 */

function insertTxn(
  db: import('better-sqlite3').Database,
  row: { hash: string; date: string; amount: number; account: string; type: 'income' | 'expense' },
): void {
  db.prepare(
    `INSERT INTO transactions (hash, date, description, amount, account, type)
     VALUES (?, ?, 'test', ?, ?, ?)`,
  ).run(row.hash, row.date, row.amount, row.account, row.type);
}

function seedInterCompanyPair(
  db: import('better-sqlite3').Database,
  expenseHash: string,
  incomeHash: string,
): void {
  const gbp = 1_000;
  const aed = gbp * getRateSync('GBP', 'AED');
  insertTxn(db, {
    hash: expenseHash,
    date: '2026-03-10',
    amount: -gbp,
    account: 'barclays-current',
    type: 'expense',
  });
  insertTxn(db, {
    hash: incomeHash,
    date: '2026-03-11',
    amount: aed,
    account: 'emirates-islamic',
    type: 'income',
  });
}

describe('countUnclassifiedInterCompanyPairs', () => {
  let harness: TestDbHandles;
  let overrideDir: string;

  beforeAll(() => {
    harness = createInMemoryTestDb();
    overrideDir = fs.mkdtempSync(path.join(harness.obligationsDir, '..', 'bsa-test-overrides-'));
  });

  afterAll(() => {
    harness.cleanup();
    fs.rmSync(overrideDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    resetTestData(harness.db);
    // Wipe any prior override file and reset the registry cache so
    // each test starts from an empty override state.
    const csvPath = getOverridesCsvPath(overrideDir);
    if (fs.existsSync(csvPath)) fs.rmSync(csvPath);
    __resetOverrideRegistryForTests(overrideDir);
  });

  function writeOverrides(rows: TransactionCategoryOverrideRow[]): void {
    writeOverridesCsvFile(getOverridesCsvPath(overrideDir), rows);
    __resetOverrideRegistryForTests(overrideDir);
  }

  it('counts every pair when no overrides exist', () => {
    seedInterCompanyPair(harness.db, 'exp-A', 'inc-A');
    seedInterCompanyPair(harness.db, 'exp-B', 'inc-B');

    // Insert second pair on different dates so the pair finder
    // doesn't cross-match A's expense with B's income; bump by 20d.
    harness.db.prepare(`UPDATE transactions SET date = '2026-05-01' WHERE hash = 'exp-B'`).run();
    harness.db.prepare(`UPDATE transactions SET date = '2026-05-02' WHERE hash = 'inc-B'`).run();

    expect(countUnclassifiedInterCompanyPairs(harness.db)).toBe(2);
  });

  it('suppresses a pair when one side has a inter-company override', () => {
    seedInterCompanyPair(harness.db, 'exp-A', 'inc-A');
    writeOverrides([
      {
        hash: 'exp-A',
        category: 'Inter-company Loan',
        notes: null,
        classified_at: '2026-03-12',
      },
    ]);

    expect(countUnclassifiedInterCompanyPairs(harness.db)).toBe(0);
  });

  it('treats Inter-company False Positive as a valid classification', () => {
    seedInterCompanyPair(harness.db, 'exp-A', 'inc-A');
    writeOverrides([
      {
        hash: 'inc-A',
        category: 'Inter-company False Positive',
        notes: 'matched by coincidence',
        classified_at: '2026-03-12',
      },
    ]);

    expect(countUnclassifiedInterCompanyPairs(harness.db)).toBe(0);
  });

  it('does not count a non-inter-company override as classified', () => {
    seedInterCompanyPair(harness.db, 'exp-A', 'inc-A');
    writeOverrides([
      {
        hash: 'exp-A',
        category: 'Groceries',
        notes: null,
        classified_at: '2026-03-12',
      },
    ]);

    expect(countUnclassifiedInterCompanyPairs(harness.db)).toBe(1);
  });

  it('returns 0 when no pairs exist, regardless of override state', () => {
    writeOverrides([
      {
        hash: 'some-unrelated-hash',
        category: 'Inter-company Loan',
        notes: null,
        classified_at: '2026-03-12',
      },
    ]);

    expect(countUnclassifiedInterCompanyPairs(harness.db)).toBe(0);
  });
});
