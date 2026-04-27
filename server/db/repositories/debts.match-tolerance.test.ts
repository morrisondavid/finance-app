/**
 * Tests for the §1.8 fuzzy-match band on `Debt.matchTolerancePct`.
 *
 * The matcher's job: identify bank-feed transactions for a debt by
 * (account ∈ sourceAccounts) AND (description LIKE merchantPattern)
 * AND (amount within band of any matchAmounts entry).
 *
 * `matchTolerancePct` controls the amount-band:
 *   - `0` → exact match (legacy behaviour preserved).
 *   - `> 0` → `|amount| ∈ [m × (1 − pct), m × (1 + pct)]` for any m in matchAmounts.
 *
 * Each band is computed per-amount so tightly-spaced debts (Bathroom A
 * 232.22 vs Bathroom B 192.66 on the SAME merchant pattern) stay
 * disambiguated even when one of them opts into a tolerance.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';

const hoisted = vi.hoisted(() => ({
  db: null as Database.Database | null,
  debtsDir: '',
}));

vi.mock('../connection.js', () => ({
  getDb: () => {
    if (!hoisted.db) throw new Error('test db not initialised');
    return hoisted.db;
  },
  get DEBTS_DIR() {
    return hoisted.debtsDir;
  },
}));

import * as DebtsRepo from './debts.js';

function createSchema(): void {
  hoisted.db!.exec(`
    CREATE TABLE IF NOT EXISTS debts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      merchant_pattern TEXT NOT NULL,
      source_accounts TEXT NOT NULL,
      original_loan_amount REAL NOT NULL CHECK(original_loan_amount > 0),
      original_loan_date TEXT,
      opening_balance REAL NOT NULL DEFAULT 0 CHECK(opening_balance >= 0),
      opening_balance_date TEXT NOT NULL,
      match_amounts TEXT NOT NULL DEFAULT '',
      match_tolerance_pct REAL NOT NULL DEFAULT 0 CHECK(match_tolerance_pct >= 0 AND match_tolerance_pct < 1),
      kind TEXT NOT NULL DEFAULT 'consumer' CHECK(kind IN ('consumer', 'mortgage')),
      interest_rate REAL,
      fixed_rate_end_date TEXT,
      repayment_type TEXT CHECK(repayment_type IS NULL OR repayment_type IN ('repayment', 'interest-only')),
      property_value_estimate REAL,
      property_id TEXT,
      archived INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      description TEXT NOT NULL,
      amount REAL NOT NULL,
      account TEXT NOT NULL,
      type TEXT NOT NULL
    );
  `);
}

function tx(t: { date: string; description: string; amount: number; account: string }): void {
  hoisted.db!.prepare(
    'INSERT INTO transactions (date, description, amount, account, type) VALUES (?, ?, ?, ?, ?)',
  ).run(t.date, t.description, t.amount, t.account, 'expense');
}

describe('debt match tolerance', () => {
  beforeAll(() => {
    hoisted.db = new Database(':memory:');
    createSchema();
  });

  afterAll(() => {
    hoisted.db?.close();
  });

  beforeEach(() => {
    hoisted.db!.exec('DELETE FROM debts; DELETE FROM transactions;');
    hoisted.debtsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'debts-tol-test-'));
  });

  it('exact match (tolerance = 0): only the listed amount matches', () => {
    DebtsRepo.createDebt({
      id: 'exact',
      name: 'Exact',
      merchantPattern: 'EXACTPAY',
      sourceAccounts: ['barclays-current'],
      originalLoanAmount: 1000,
      openingBalance: 1000,
      openingBalanceDate: '2026-01-01',
      matchAmounts: [100],
      matchTolerancePct: 0,
    });
    tx({ date: '2026-02-01', description: 'EXACTPAY hit', amount: -100, account: 'barclays-current' });
    tx({ date: '2026-02-02', description: 'EXACTPAY drift', amount: -101, account: 'barclays-current' });
    tx({ date: '2026-02-03', description: 'EXACTPAY drift', amount: -99.5, account: 'barclays-current' });

    const summary = DebtsRepo.getDebtSummary(DebtsRepo.getDebt('exact')!);
    expect(summary.matchedTransactionCount).toBe(1);
    expect(summary.paidSinceOpening).toBe(100);
  });

  it('fuzzy match (tolerance = 0.025): matches anything in the ±2.5% band', () => {
    DebtsRepo.createDebt({
      id: 'bbl',
      name: 'BBL',
      merchantPattern: '0520A',
      sourceAccounts: ['barclays-current'],
      originalLoanAmount: 50000,
      openingBalance: 22685.36,
      openingBalanceDate: '2025-10-01',
      matchAmounts: [513.0],
      matchTolerancePct: 0.025, // band: 500.18 – 525.83
    });
    // All seen on the real Barclays BBL feed; all should match.
    tx({ date: '2026-04-13', description: '0520A hit', amount: -512.11, account: 'barclays-current' });
    tx({ date: '2026-03-13', description: '0520A hit', amount: -508.24, account: 'barclays-current' });
    tx({ date: '2026-02-13', description: '0520A hit', amount: -514.08, account: 'barclays-current' });
    tx({ date: '2026-01-13', description: '0520A hit', amount: -515.06, account: 'barclays-current' });
    tx({ date: '2025-12-15', description: '0520A hit', amount: -514.33, account: 'barclays-current' });
    tx({ date: '2025-11-13', description: '0520A hit', amount: -517.02, account: 'barclays-current' });
    // Outside the band — should NOT match.
    tx({ date: '2026-05-01', description: '0520A miss', amount: -490, account: 'barclays-current' });
    tx({ date: '2026-05-02', description: '0520A miss', amount: -540, account: 'barclays-current' });

    const summary = DebtsRepo.getDebtSummary(DebtsRepo.getDebt('bbl')!);
    expect(summary.matchedTransactionCount).toBe(6);
  });

  it('per-amount band: tight tolerance keeps tightly-spaced debts disambiguated', () => {
    // Two debts on the SAME merchant pattern, monthly payments very close.
    // A 2% band on each does NOT bleed into the other.
    DebtsRepo.createDebt({
      id: 'bath-a',
      name: 'Bath A',
      merchantPattern: 'PARTNERFIN',
      sourceAccounts: ['monzo-joint'],
      originalLoanAmount: 9000,
      openingBalance: 4000,
      openingBalanceDate: '2026-01-01',
      matchAmounts: [232.22],
      matchTolerancePct: 0.02, // 227.58 – 236.86
    });
    DebtsRepo.createDebt({
      id: 'bath-b',
      name: 'Bath B',
      merchantPattern: 'PARTNERFIN',
      sourceAccounts: ['monzo-joint'],
      originalLoanAmount: 7000,
      openingBalance: 3000,
      openingBalanceDate: '2026-01-01',
      matchAmounts: [192.66],
      matchTolerancePct: 0.02, // 188.81 – 196.51
    });
    tx({ date: '2026-02-01', description: 'PARTNERFIN', amount: -232.22, account: 'monzo-joint' });
    tx({ date: '2026-02-15', description: 'PARTNERFIN', amount: -192.66, account: 'monzo-joint' });
    tx({ date: '2026-03-01', description: 'PARTNERFIN', amount: -210, account: 'monzo-joint' }); // halfway — must NOT match either

    const a = DebtsRepo.getDebtSummary(DebtsRepo.getDebt('bath-a')!);
    const b = DebtsRepo.getDebtSummary(DebtsRepo.getDebt('bath-b')!);
    expect(a.matchedTransactionCount).toBe(1);
    expect(a.paidSinceOpening).toBe(232.22);
    expect(b.matchedTransactionCount).toBe(1);
    expect(b.paidSinceOpening).toBe(192.66);
  });

  it('multi-amount with tolerance: each amount gets its own band, ORd together', () => {
    DebtsRepo.createDebt({
      id: 'multi',
      name: 'Multi',
      merchantPattern: 'NatWest',
      sourceAccounts: ['monzo-joint'],
      originalLoanAmount: 200000,
      openingBalance: 200000,
      openingBalanceDate: '2026-01-01',
      matchAmounts: [801.35, 1054.64], // current + stress
      matchTolerancePct: 0.02,
      kind: 'mortgage',
      interestRate: 4.48,
      repaymentType: 'interest-only',
    });
    tx({ date: '2026-02-01', description: 'NatWest current band', amount: -800, account: 'monzo-joint' });
    tx({ date: '2026-03-01', description: 'NatWest stress band', amount: -1060, account: 'monzo-joint' });
    tx({ date: '2026-04-01', description: 'NatWest no-mans-land', amount: -930, account: 'monzo-joint' }); // between bands → no match

    const s = DebtsRepo.getDebtSummary(DebtsRepo.getDebt('multi')!);
    expect(s.matchedTransactionCount).toBe(2);
  });

  it('rejects matchTolerancePct outside [0, 1)', () => {
    expect(() =>
      DebtsRepo.createDebt({
        id: 'over',
        name: 'Over',
        merchantPattern: 'X',
        sourceAccounts: ['barclays-current'],
        originalLoanAmount: 100,
        openingBalance: 50,
        openingBalanceDate: '2026-01-01',
        matchAmounts: [50],
        matchTolerancePct: 1.0, // boundary excluded
      }),
    ).toThrow(/matchTolerancePct/);
    expect(() =>
      DebtsRepo.createDebt({
        id: 'neg',
        name: 'Neg',
        merchantPattern: 'X',
        sourceAccounts: ['barclays-current'],
        originalLoanAmount: 100,
        openingBalance: 50,
        openingBalanceDate: '2026-01-01',
        matchAmounts: [50],
        matchTolerancePct: -0.01,
      }),
    ).toThrow(/matchTolerancePct/);
  });
});
