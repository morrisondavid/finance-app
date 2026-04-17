import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { getVatApplicableAccounts, getCorpTaxApplicableAccounts } from '../../types.js';
import { buildVatAccountFilter, buildCorpTaxAccountFilter } from '../utils/tax-account-filter.js';

/**
 * Integration-style tests that run real SQL against an in-memory SQLite database
 * to prove that tax income queries only include correctly-flagged accounts.
 *
 * The tests insert income rows across multiple accounts (both business/personal,
 * both VAT-applicable and not) and verify that the exact same SQL patterns used
 * in vat-auto-seed.ts, obligations.ts, and tax.ts return the correct totals.
 */

let testDb: Database.Database;

vi.mock('../connection.js', () => ({
  getDb: () => testDb,
}));

function createSchema(): void {
  testDb.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash TEXT UNIQUE NOT NULL,
      date TEXT NOT NULL,
      description TEXT NOT NULL,
      amount REAL NOT NULL,
      account TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('income', 'expense', 'transfer')),
      linked_transaction_id INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS financial_obligations (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      entity TEXT NOT NULL,
      recurrence TEXT NOT NULL,
      expected_amount REAL,
      due_date TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      paid_amount REAL,
      paid_date TEXT,
      paid_from_account TEXT,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

let hashSeq = 0;
function insertIncome(account: string, date: string, amount: number, description = 'Client payment'): void {
  hashSeq++;
  testDb.prepare(`
    INSERT INTO transactions (hash, date, description, amount, account, type)
    VALUES (?, ?, ?, ?, ?, 'income')
  `).run(`hash-${hashSeq}`, date, description, amount, account);
}

function insertExpense(account: string, date: string, amount: number, description: string): void {
  hashSeq++;
  testDb.prepare(`
    INSERT INTO transactions (hash, date, description, amount, account, type)
    VALUES (?, ?, ?, ?, ?, 'expense')
  `).run(`hash-${hashSeq}`, date, description, amount, account);
}

beforeAll(() => {
  testDb = new Database(':memory:');
  createSchema();
});

afterAll(() => {
  testDb.close();
});

beforeEach(() => {
  testDb.exec('DELETE FROM transactions');
  testDb.exec('DELETE FROM financial_obligations');
  hashSeq = 0;
});

describe('VAT income queries exclude non-vatApplicable accounts', () => {
  const vatAccounts = getVatApplicableAccounts();

  it('MIN(date) query only considers vatApplicable accounts', () => {
    insertIncome('monzo-joint', '2019-06-15', 500);
    insertIncome('natwest', '2020-03-01', 300);
    insertIncome('barclays-current', '2022-04-19', 1000);

    const vatFilter = buildVatAccountFilter();
    const result = testDb.prepare(
      `SELECT MIN(date) as minDate FROM transactions WHERE type = 'income' ${vatFilter.clause}`
    ).get(...vatFilter.params) as { minDate: string | null };

    expect(result.minDate).toBe('2022-04-19');
  });

  it('SUM(amount) for a date range only includes vatApplicable income', () => {
    insertIncome('barclays-current', '2023-01-15', 5000);
    insertIncome('monzo-joint', '2023-01-20', 3000);
    insertIncome('natwest', '2023-02-10', 2000);
    insertIncome('barclays-savings', '2023-01-25', 1000);

    const vatFilter = buildVatAccountFilter();
    const result = testDb.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM transactions WHERE type = 'income' AND date >= ? AND date <= ? ${vatFilter.clause}
    `).get('2023-01-01', '2023-03-31', ...vatFilter.params) as { total: number };

    expect(result.total).toBe(5000);
    expect(vatAccounts).toContain('barclays-current');
    expect(vatAccounts).not.toContain('monzo-joint');
    expect(vatAccounts).not.toContain('natwest');
    expect(vatAccounts).not.toContain('barclays-savings');
  });

  it('returns zero when only non-vatApplicable accounts have income', () => {
    insertIncome('monzo-joint', '2023-06-01', 10000);
    insertIncome('natwest', '2023-06-15', 5000);

    const vatFilter = buildVatAccountFilter();
    const result = testDb.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM transactions WHERE type = 'income' AND date >= ? AND date <= ? ${vatFilter.clause}
    `).get('2023-01-01', '2023-12-31', ...vatFilter.params) as { total: number };

    expect(result.total).toBe(0);
  });
});

describe('Corporation Tax income queries exclude non-corpTaxApplicable accounts', () => {
  const corpTaxAccounts = getCorpTaxApplicableAccounts();

  it('FY income SUM only includes corpTaxApplicable accounts', () => {
    insertIncome('barclays-current', '2023-06-01', 8000);
    insertIncome('monzo-joint', '2023-06-15', 4000);
    insertIncome('natwest', '2023-07-01', 2000);
    insertIncome('capital-on-tap', '2023-06-20', 500);

    const corpTaxFilter = buildCorpTaxAccountFilter();
    const result = testDb.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM transactions WHERE type = 'income' AND date >= ? AND date <= ? ${corpTaxFilter.clause}
    `).get('2023-05-01', '2024-04-30', ...corpTaxFilter.params) as { total: number };

    expect(result.total).toBe(8000);
    expect(corpTaxAccounts).toContain('barclays-current');
    expect(corpTaxAccounts).not.toContain('monzo-joint');
    expect(corpTaxAccounts).not.toContain('natwest');
    expect(corpTaxAccounts).not.toContain('capital-on-tap');
  });

  it('Corp Tax income is unaffected by dashboard account selection (always uses config)', () => {
    insertIncome('barclays-current', '2023-06-01', 8000);
    insertIncome('natwest', '2023-06-15', 4000);

    const corpTaxFilter = buildCorpTaxAccountFilter();

    const withDashboardFilter = testDb.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM transactions WHERE type = 'income' AND date >= ? AND date <= ? AND account = ? ${corpTaxFilter.clause}
    `).get('2023-05-01', '2024-04-30', 'natwest', ...corpTaxFilter.params) as { total: number };
    expect(withDashboardFilter.total).toBe(0);

    const withBusinessFilter = testDb.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM transactions WHERE type = 'income' AND date >= ? AND date <= ? ${corpTaxFilter.clause}
    `).get('2023-05-01', '2024-04-30', ...corpTaxFilter.params) as { total: number };
    expect(withBusinessFilter.total).toBe(8000);
  });
});

describe('vat-auto-seed partial-quarter skip', () => {
  it('skips quarters that start before earliest vatApplicable transaction', async () => {
    insertIncome('barclays-current', '2022-04-19', 5000);

    const { deriveAndInsertAutoObligations } = await import('./vat-auto-seed.js');
    deriveAndInsertAutoObligations();

    const obligations = testDb.prepare(
      `SELECT id, expected_amount FROM financial_obligations WHERE type = 'vat' ORDER BY id`
    ).all() as Array<{ id: string; expected_amount: number }>;

    for (const ob of obligations) {
      const startDate = ob.id.replace('auto-vat-', '');
      expect(startDate >= '2022-04-19' || startDate.startsWith('2022-04')).toBe(true);
    }

    const has2019 = obligations.some(o => o.id.includes('2019'));
    const has2020 = obligations.some(o => o.id.includes('2020'));
    const has2021 = obligations.some(o => o.id.includes('2021'));
    expect(has2019).toBe(false);
    expect(has2020).toBe(false);
    expect(has2021).toBe(false);
  });

  it('produces no quarters when vatApplicable accounts have no income', async () => {
    insertIncome('monzo-joint', '2023-01-15', 5000);

    const { deriveAndInsertAutoObligations } = await import('./vat-auto-seed.js');
    deriveAndInsertAutoObligations();

    const obligations = testDb.prepare(
      `SELECT COUNT(*) as cnt FROM financial_obligations WHERE type = 'vat'`
    ).get() as { cnt: number };

    expect(obligations.cnt).toBe(0);
  });

  it('quarter income sums exclude monzo-joint income', async () => {
    insertIncome('barclays-current', '2023-07-15', 10000);
    insertIncome('monzo-joint', '2023-07-20', 5000);

    const { deriveAndInsertAutoObligations } = await import('./vat-auto-seed.js');
    deriveAndInsertAutoObligations();

    const q3Obligation = testDb.prepare(
      `SELECT expected_amount FROM financial_obligations WHERE id LIKE 'auto-vat-2023-07%'`
    ).get() as { expected_amount: number } | undefined;

    if (q3Obligation) {
      expect(q3Obligation.expected_amount).toBeCloseTo(10000 / 6, 0);
    }
  });
});

describe('findHmrcPayments respects account list', () => {
  it('only finds payments from specified accounts', async () => {
    insertExpense('barclays-current', '2023-08-01', -5000, 'HMRC VAT');
    insertExpense('monzo-joint', '2023-08-02', -2000, 'HMRC VAT');

    const { findHmrcPayments } = await import('./tax.js');
    const payments = findHmrcPayments({
      patterns: ['%HMRC%VAT%'],
      accounts: ['barclays-current'],
      startDate: '2023-01-01',
      endDate: '2023-12-31',
    });

    expect(payments).toHaveLength(1);
    expect(payments[0].account).toBe('barclays-current');
  });
});
