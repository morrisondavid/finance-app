import { describe, it, expect, afterAll, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  vatApplicableAccounts,
  corpTaxApplicableAccounts,
} from '../../domain/accounts/index.js';
import { buildAccountInFilter } from '../utils/tax-account-filter.js';
import { createInMemoryTestDb } from '../test-harness/in-memory-db.js';

/**
 * Integration-style tests that run real SQL against an in-memory SQLite database
 * to prove that tax income queries only include correctly-flagged accounts.
 *
 * The tests insert income rows across multiple accounts (both business/personal,
 * both VAT-applicable and not) and verify that the exact same SQL patterns used
 * in vat-auto-seed.ts, obligations.ts, and tax.ts return the correct totals.
 */

const harness = createInMemoryTestDb();

vi.mock('../connection.js', () => ({
  getDb: () => harness.db,
  OBLIGATIONS_DIR: harness.obligationsDir,
}));

/** Payment-attribution tests use bank-based amounts (cash scheme). */
vi.mock('../../domain/company/index.js', () => ({
  ukLtdCompanyOrNull: () => ({ vat_scheme: 'cash', historical_effective_vat_rate: null }),
}));

let hashSeq = 0;
function insertIncome(account: string, date: string, amount: number, description = 'Client payment'): void {
  hashSeq++;
  harness.db.prepare(`
    INSERT INTO transactions (hash, date, description, amount, account, type)
    VALUES (?, ?, ?, ?, ?, 'income')
  `).run(`hash-${hashSeq}`, date, description, amount, account);
}

function insertExpense(account: string, date: string, amount: number, description: string): void {
  hashSeq++;
  harness.db.prepare(`
    INSERT INTO transactions (hash, date, description, amount, account, type)
    VALUES (?, ?, ?, ?, ?, 'expense')
  `).run(`hash-${hashSeq}`, date, description, amount, account);
}

afterAll(() => {
  harness.cleanup();
});

beforeEach(() => {
  harness.db.exec('DELETE FROM transactions');
  harness.db.exec('DELETE FROM financial_obligations');
  harness.db.exec('DELETE FROM obligation_dismissals');
  hashSeq = 0;
  const csv = path.join(harness.obligationsDir, 'obligation-dismissals.csv');
  if (fs.existsSync(csv)) fs.unlinkSync(csv);
});

describe('VAT income queries exclude non-vatApplicable accounts', () => {
  const vatAccounts = vatApplicableAccounts();

  it('MIN(date) query only considers vatApplicable accounts', () => {
    insertIncome('monzo-joint', '2019-06-15', 500);
    insertIncome('natwest', '2020-03-01', 300);
    insertIncome('barclays-current', '2022-04-19', 1000);

    const vatFilter = buildAccountInFilter(vatApplicableAccounts());
    const result = harness.db.prepare(
      `SELECT MIN(date) as minDate FROM transactions WHERE type = 'income' ${vatFilter.clause}`
    ).get(...vatFilter.params) as { minDate: string | null };

    expect(result.minDate).toBe('2022-04-19');
  });

  it('SUM(amount) for a date range only includes vatApplicable income', () => {
    insertIncome('barclays-current', '2023-01-15', 5000);
    insertIncome('monzo-joint', '2023-01-20', 3000);
    insertIncome('natwest', '2023-02-10', 2000);
    insertIncome('barclays-savings', '2023-01-25', 1000);

    const vatFilter = buildAccountInFilter(vatApplicableAccounts());
    const result = harness.db.prepare(`
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

    const vatFilter = buildAccountInFilter(vatApplicableAccounts());
    const result = harness.db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM transactions WHERE type = 'income' AND date >= ? AND date <= ? ${vatFilter.clause}
    `).get('2023-01-01', '2023-12-31', ...vatFilter.params) as { total: number };

    expect(result.total).toBe(0);
  });
});

describe('Corporation Tax income queries exclude non-corpTaxApplicable accounts', () => {
  const corpTaxAccounts = corpTaxApplicableAccounts();

  it('FY income SUM only includes corpTaxApplicable accounts', () => {
    insertIncome('barclays-current', '2023-06-01', 8000);
    insertIncome('monzo-joint', '2023-06-15', 4000);
    insertIncome('natwest', '2023-07-01', 2000);
    insertIncome('capital-on-tap', '2023-06-20', 500);

    const corpTaxFilter = buildAccountInFilter(corpTaxApplicableAccounts());
    const result = harness.db.prepare(`
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

    const corpTaxFilter = buildAccountInFilter(corpTaxApplicableAccounts());

    const withDashboardFilter = harness.db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM transactions WHERE type = 'income' AND date >= ? AND date <= ? AND account = ? ${corpTaxFilter.clause}
    `).get('2023-05-01', '2024-04-30', 'natwest', ...corpTaxFilter.params) as { total: number };
    expect(withDashboardFilter.total).toBe(0);

    const withBusinessFilter = harness.db.prepare(`
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

    const obligations = harness.db.prepare(
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

    const obligations = harness.db.prepare(
      `SELECT COUNT(*) as cnt FROM financial_obligations WHERE type = 'vat'`
    ).get() as { cnt: number };

    expect(obligations.cnt).toBe(0);
  });

  it('quarter income sums exclude monzo-joint income', async () => {
    insertIncome('barclays-current', '2023-07-15', 10000);
    insertIncome('monzo-joint', '2023-07-20', 5000);

    const { deriveAndInsertAutoObligations } = await import('./vat-auto-seed.js');
    deriveAndInsertAutoObligations();

    const q3Obligation = harness.db.prepare(
      `SELECT expected_amount FROM financial_obligations WHERE id LIKE 'auto-vat-2023-07%'`
    ).get() as { expected_amount: number } | undefined;

    if (q3Obligation) {
      expect(q3Obligation.expected_amount).toBeCloseTo(10000 / 6, 0);
    }
  });
});

/**
 * Regression-lock for the card-channel VAT attribution fix.
 *
 * HMRC's card payment gateway routes every debit-card payment through
 * ETMP, so when the user pays VAT by card the bank narrative shows as
 * "HMRC ETMP - GLASGOW - Card Ending: NNNN" rather than "HMRC VAT…".
 * Historically the seeder treated all HMRC ETMP lines as payment-plan
 * debits and refused to attribute them to VAT quarters, leaving the
 * user's paid VAT slots showing as overdue. The `Card Ending:` suffix
 * is the reliable discriminator from recurring-DD TTP installments.
 */
describe('vat-auto-seed attributes card-channel ETMP payments', () => {
  it('attaches "HMRC ETMP % Card Ending %" from a business card to the nearest VAT quarter', async () => {
    insertIncome('barclays-current', '2024-06-15', 50000);
    insertExpense(
      'capital-on-tap',
      '2024-09-09',
      -5617.79,
      'HMRC ETMP - GLASGOW - Card Ending: 8346',
    );

    const { deriveAndInsertAutoObligations } = await import('./vat-auto-seed.js');
    deriveAndInsertAutoObligations();

    const mayJulQuarter = harness.db.prepare(`
      SELECT status, paid_amount, paid_date, paid_from_account
      FROM financial_obligations
      WHERE type='vat' AND due_date='2024-09-07'
    `).get() as
      | { status: string; paid_amount: number; paid_date: string; paid_from_account: string }
      | undefined;

    expect(mayJulQuarter).toBeDefined();
    expect(mayJulQuarter?.status).toBe('paid');
    expect(mayJulQuarter?.paid_amount).toBeCloseTo(5617.79, 2);
    expect(mayJulQuarter?.paid_date).toBe('2024-09-09');
    expect(mayJulQuarter?.paid_from_account).toBe('capital-on-tap');
  });

  it('bare "HMRC ETMP" (no Card Ending suffix) is NOT attributed to VAT', async () => {
    insertIncome('barclays-current', '2024-06-15', 50000);
    // Bare ETMP direct debit — this is TTP, not a VAT card payment.
    insertExpense('barclays-current', '2024-09-09', -5617.79, 'HMRC ETMP');

    const { deriveAndInsertAutoObligations } = await import('./vat-auto-seed.js');
    deriveAndInsertAutoObligations();

    const mayJulQuarter = harness.db.prepare(`
      SELECT status, paid_from_account FROM financial_obligations
      WHERE type='vat' AND due_date='2024-09-07'
    `).get() as { status: string; paid_from_account: string | null } | undefined;

    expect(mayJulQuarter?.status).toBe('unpaid');
    expect(mayJulQuarter?.paid_from_account).toBeNull();
  });

  it('both card-channel ETMP and plain HMRC VAT land on the correct quarters when both exist', async () => {
    insertIncome('barclays-current', '2023-06-15', 60000);
    insertIncome('barclays-current', '2024-06-15', 60000);

    // Feb-Apr 2024 quarter (due 2024-06-07) paid by Bacs.
    insertExpense('barclays-current', '2024-06-05', -8000, 'HMRC VAT SOUTHEND');
    // May-Jul 2024 quarter (due 2024-09-07) paid by card through ETMP.
    insertExpense(
      'capital-on-tap',
      '2024-09-09',
      -5617.79,
      'HMRC ETMP - GLASGOW - Card Ending: 8346',
    );

    const { deriveAndInsertAutoObligations } = await import('./vat-auto-seed.js');
    deriveAndInsertAutoObligations();

    const febApr = harness.db.prepare(
      `SELECT status, paid_amount, paid_from_account FROM financial_obligations WHERE type='vat' AND due_date='2024-06-07'`
    ).get() as { status: string; paid_amount: number; paid_from_account: string };
    const mayJul = harness.db.prepare(
      `SELECT status, paid_amount, paid_from_account FROM financial_obligations WHERE type='vat' AND due_date='2024-09-07'`
    ).get() as { status: string; paid_amount: number; paid_from_account: string };

    expect(febApr.status).toBe('paid');
    expect(febApr.paid_amount).toBeCloseTo(8000, 2);
    expect(febApr.paid_from_account).toBe('barclays-current');

    expect(mayJul.status).toBe('paid');
    expect(mayJul.paid_amount).toBeCloseTo(5617.79, 2);
    expect(mayJul.paid_from_account).toBe('capital-on-tap');
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

  it('returns results ordered by date ascending (earliest first)', async () => {
    insertExpense('barclays-current', '2023-08-01', -1000, 'HMRC VAT');
    insertExpense('barclays-current', '2023-11-01', -2000, 'HMRC VAT');
    insertExpense('barclays-current', '2023-05-01', -3000, 'HMRC VAT');

    const { findHmrcPayments } = await import('./tax.js');
    const payments = findHmrcPayments({
      patterns: ['%HMRC%VAT%'],
      accounts: ['barclays-current'],
      startDate: '2023-01-01',
      endDate: '2023-12-31',
    });

    expect(payments.map(p => p.date)).toEqual(['2023-05-01', '2023-08-01', '2023-11-01']);
  });
});

describe('deriveAndInsertAutoObligations stale cleanup', () => {
  it('deletes pre-existing auto-derived obligations before re-deriving', async () => {
    harness.db.prepare(`
      INSERT INTO financial_obligations
        (id, source, type, name, entity, frequency, expected_amount, due_date, status)
      VALUES
        ('auto-vat-2019-08-01', 'auto', 'vat', 'VAT Aug-Oct 2019', 'HMRC', 'quarterly', 1234, '2019-12-07', 'paid'),
        ('auto-vat-2020-02-01', 'auto', 'vat', 'VAT Feb-Apr 2020', 'HMRC', 'quarterly', 5678, '2020-06-07', 'paid')
    `).run();

    insertIncome('barclays-current', '2023-07-15', 6000);

    const { deriveAndInsertAutoObligations } = await import('./vat-auto-seed.js');
    deriveAndInsertAutoObligations();

    const stale = harness.db.prepare(
      `SELECT id FROM financial_obligations WHERE id IN ('auto-vat-2019-08-01', 'auto-vat-2020-02-01')`
    ).all();
    expect(stale).toHaveLength(0);
  });

  it('preserves manual obligations when re-deriving auto obligations', async () => {
    harness.db.prepare(`
      INSERT INTO financial_obligations
        (id, source, type, name, entity, frequency, expected_amount, due_date, status)
      VALUES
        ('manual-vat-backdated', 'manual', 'vat', 'Old VAT payment', 'HMRC', 'one-off', 500, '2020-01-01', 'paid'),
        ('auto-vat-stale', 'auto', 'vat', 'Stale auto', 'HMRC', 'quarterly', 999, '2019-06-07', 'paid')
    `).run();

    insertIncome('barclays-current', '2023-07-15', 6000);

    const { deriveAndInsertAutoObligations } = await import('./vat-auto-seed.js');
    deriveAndInsertAutoObligations();

    const manual = harness.db.prepare(
      `SELECT id FROM financial_obligations WHERE id = 'manual-vat-backdated'`
    ).get();
    expect(manual).toBeDefined();

    const staleAuto = harness.db.prepare(
      `SELECT id FROM financial_obligations WHERE id = 'auto-vat-stale'`
    ).get();
    expect(staleAuto).toBeUndefined();
  });
});

describe('findUnmatchedHmrcPayments', () => {
  it('returns HMRC payments not linked to any obligation', async () => {
    insertExpense('barclays-current', '2024-03-08', -5780.23, 'HMRC ETMP');
    insertExpense('barclays-current', '2025-09-08', -8060, 'HMRC VAT SOUTHEND');

    harness.db.prepare(`
      INSERT INTO financial_obligations
        (id, source, type, name, entity, frequency, expected_amount, due_date,
         status, paid_amount, paid_date, paid_from_account)
      VALUES
        ('auto-vat-matched', 'auto', 'vat', 'VAT', 'HMRC', 'quarterly',
         8060, '2025-09-07', 'paid', 8060, '2025-09-08', 'barclays-current')
    `).run();

    const { findUnmatchedHmrcPayments } = await import('./tax.js');
    const unmatched = findUnmatchedHmrcPayments({
      patterns: ['HMRC VAT%', 'HMRC ETMP%'],
      accounts: ['barclays-current', 'monzo-joint'],
    });

    expect(unmatched).toHaveLength(1);
    expect(unmatched[0].date).toBe('2024-03-08');
    expect(unmatched[0].description).toBe('HMRC ETMP');
    expect(unmatched[0].hmrcType).toBe('payment-plan');
  });

  it('classifies VAT / ETMP / NDDS / SA / Corporation Tax narratives correctly', async () => {
    insertExpense('barclays-current', '2024-03-08', -1000, 'HMRC VAT SOUTHEND');
    insertExpense('barclays-current', '2024-04-08', -500, 'HMRC ETMP - GLASGOW');
    insertExpense('barclays-current', '2024-05-08', -250, 'HMRC GOV.UK SA');
    insertExpense('barclays-current', '2024-06-08', -100, 'HMRC GOV.UK');
    insertExpense('barclays-current', '2024-07-08', -643.69, 'HMRC NDDS - CUMBERNAULD');
    insertExpense('barclays-current', '2024-08-08', -1234, 'HMRC CORPORATION T');
    insertExpense('barclays-current', '2024-09-08', -1500, 'HMRC GOV.UK COTAX');

    const { findUnmatchedHmrcPayments } = await import('./tax.js');
    const unmatched = findUnmatchedHmrcPayments({
      patterns: [
        'HMRC VAT%',
        'HMRC ETMP%',
        'HMRC GOV.UK SA%',
        'HMRC GOV.UK%',
        'HMRC NDDS%',
        'HMRC CORPORATION T%',
      ],
      accounts: ['barclays-current'],
    });

    const byDate = new Map(unmatched.map(p => [p.date, p.hmrcType]));
    expect(byDate.get('2024-03-08')).toBe('vat');
    expect(byDate.get('2024-04-08')).toBe('payment-plan');
    expect(byDate.get('2024-05-08')).toBe('self-assessment');
    expect(byDate.get('2024-06-08')).toBe('other');
    expect(byDate.get('2024-07-08')).toBe('payment-plan');
    expect(byDate.get('2024-08-08')).toBe('corporation-tax');
    expect(byDate.get('2024-09-08')).toBe('corporation-tax');
  });

  it('matches paid_from_account using LIKE so dense account identifiers still link', async () => {
    insertExpense('barclays-current', '2025-06-09', -5578.79, 'HMRC ETMP - GLASGOW');

    harness.db.prepare(`
      INSERT INTO financial_obligations
        (id, source, type, name, entity, frequency, expected_amount, due_date,
         status, paid_amount, paid_date, paid_from_account)
      VALUES
        ('auto-vat-card', 'auto', 'vat', 'VAT', 'HMRC', 'quarterly',
         5578.79, '2025-06-07', 'paid', 5578.79, '2025-06-09',
         'Barclays Current (barclays-current)')
    `).run();

    const { findUnmatchedHmrcPayments } = await import('./tax.js');
    const unmatched = findUnmatchedHmrcPayments({
      patterns: ['HMRC ETMP%'],
      accounts: ['barclays-current'],
    });
    expect(unmatched).toHaveLength(0);
  });

  it('excludes payments outside the supplied account list', async () => {
    insertExpense('monzo-joint', '2024-01-01', -1000, 'HMRC ETMP');

    const { findUnmatchedHmrcPayments } = await import('./tax.js');
    const unmatched = findUnmatchedHmrcPayments({
      patterns: ['HMRC ETMP%'],
      accounts: ['barclays-current'],
    });
    expect(unmatched).toHaveLength(0);
  });

  it('CT-narrative debits covered by an auto CT obligation drop off the orphan feed', async () => {
    insertExpense('barclays-current', '2025-01-29', -12500, 'HMRC CORPORATION T');

    // Simulate the auto CT seeder having written an attributed row.
    harness.db.prepare(`
      INSERT INTO financial_obligations
        (id, source, type, name, entity, frequency, expected_amount, due_date,
         status, paid_amount, paid_date, paid_from_account)
      VALUES
        ('auto-ct-2024-04-30', 'auto', 'corporation-tax',
         'Corporation Tax — FY 2024/25', 'HMRC', 'annual',
         12500, '2025-01-31', 'paid', 12500, '2025-01-29', 'barclays-current')
    `).run();

    const { findUnmatchedHmrcPayments } = await import('./tax.js');
    const unmatched = findUnmatchedHmrcPayments({
      patterns: ['HMRC CORPORATION T%', 'HMRC GOV.UK COTAX%'],
      accounts: ['barclays-current'],
    });
    expect(unmatched).toHaveLength(0);
  });

  it('SA-narrative debits covered by an auto SA obligation drop off the orphan feed', async () => {
    insertExpense('natwest', '2026-01-31', -3500, 'HMRC GOV.UK SA');

    harness.db.prepare(`
      INSERT INTO financial_obligations
        (id, source, type, name, entity, frequency, expected_amount, due_date,
         status, paid_amount, paid_date, paid_from_account, person_id)
      VALUES
        ('auto-sa-david-2026-01-31', 'auto', 'self-assessment',
         'Self Assessment — David (2026-01-31)', 'HMRC', 'annual',
         3500, '2026-01-31', 'paid', 3500, '2026-01-31', 'natwest', 'david')
    `).run();

    const { findUnmatchedHmrcPayments } = await import('./tax.js');
    const unmatched = findUnmatchedHmrcPayments({
      patterns: ['HMRC GOV.UK SA%'],
      accounts: ['barclays-current', 'natwest'],
    });
    expect(unmatched).toHaveLength(0);
  });

  it('TTP instalment debits covered by auto hmrc-ttp obligations drop off the orphan feed', async () => {
    insertExpense('barclays-current', '2025-03-09', -643.69, 'HMRC NDDS - CUMBERNAULD');
    insertExpense('barclays-current', '2025-04-09', -643.69, 'HMRC NDDS - CUMBERNAULD');

    harness.db.prepare(`
      INSERT INTO financial_obligations
        (id, source, type, name, entity, frequency, expected_amount, due_date,
         status, paid_amount, paid_date, paid_from_account)
      VALUES
        ('auto-ttp-barclays-current-64369-2025-03-09', 'auto', 'hmrc-ttp',
         'HMRC payment plan', 'HMRC', 'monthly',
         643.69, '2025-03-09', 'paid', 643.69, '2025-03-09', 'barclays-current'),
        ('auto-ttp-barclays-current-64369-2025-04-09', 'auto', 'hmrc-ttp',
         'HMRC payment plan', 'HMRC', 'monthly',
         643.69, '2025-04-09', 'paid', 643.69, '2025-04-09', 'barclays-current')
    `).run();

    const { findUnmatchedHmrcPayments } = await import('./tax.js');
    const unmatched = findUnmatchedHmrcPayments({
      patterns: ['HMRC NDDS%', 'HMRC ETMP%'],
      accounts: ['barclays-current'],
    });
    expect(unmatched).toHaveLength(0);
  });

  it('honours startDate / endDate — settled-history orphans are excluded when scoped', async () => {
    // Two genuinely-unmatched HMRC debits, one ancient (2023) and one
    // within the rolling window. Nothing in `financial_obligations`
    // covers either, so without a date filter both surface. With a
    // rolling ±12-month scope anchored on 2026-04-16, only the recent
    // one appears.
    insertExpense('barclays-current', '2023-11-13', -17000, 'HMRC CORPORATION T');
    insertExpense('barclays-current', '2025-11-13', -250, 'HMRC GOV.UK SA');

    const { findUnmatchedHmrcPayments } = await import('./tax.js');

    const all = findUnmatchedHmrcPayments({
      patterns: ['HMRC CORPORATION T%', 'HMRC GOV.UK SA%'],
      accounts: ['barclays-current'],
    });
    expect(all.map(p => p.date)).toEqual(['2023-11-13', '2025-11-13']);

    const scoped = findUnmatchedHmrcPayments({
      patterns: ['HMRC CORPORATION T%', 'HMRC GOV.UK SA%'],
      accounts: ['barclays-current'],
      startDate: '2025-04-16',
      endDate: '2027-04-16',
    });
    expect(scoped).toHaveLength(1);
    expect(scoped[0].date).toBe('2025-11-13');
  });

  it('treats the window boundary as inclusive on both ends', async () => {
    insertExpense('barclays-current', '2025-04-15', -100, 'HMRC GOV.UK SA');  // one day before window start
    insertExpense('barclays-current', '2025-04-16', -100, 'HMRC GOV.UK SA');  // window start (inclusive)
    insertExpense('barclays-current', '2027-04-16', -100, 'HMRC GOV.UK SA');  // window end (inclusive)
    insertExpense('barclays-current', '2027-04-17', -100, 'HMRC GOV.UK SA');  // one day after window end

    const { findUnmatchedHmrcPayments } = await import('./tax.js');
    const scoped = findUnmatchedHmrcPayments({
      patterns: ['HMRC GOV.UK SA%'],
      accounts: ['barclays-current'],
      startDate: '2025-04-16',
      endDate: '2027-04-16',
    });

    expect(scoped.map(p => p.date).sort()).toEqual(['2025-04-16', '2027-04-16']);
  });

  it('rolling ±12-month window produced by getObligationsPageWindow drives scoping', async () => {
    // Integration-level sanity check: wiring the shared window utility into
    // findUnmatchedHmrcPayments produces exactly the boundary semantics the
    // route now relies on. Anchored on 2026-04-16.
    insertExpense('barclays-current', '2024-04-15', -100, 'HMRC GOV.UK SA');  // > 24m ago → drop
    insertExpense('barclays-current', '2025-06-01', -100, 'HMRC GOV.UK SA');  // within window → keep
    insertExpense('barclays-current', '2027-03-01', -100, 'HMRC GOV.UK SA');  // within forward half → keep
    insertExpense('barclays-current', '2027-05-01', -100, 'HMRC GOV.UK SA');  // > 12m ahead → drop

    const [{ findUnmatchedHmrcPayments }, { getObligationsPageWindow }] = await Promise.all([
      import('./tax.js'),
      import('../utils/financial-year.js'),
    ]);
    const window = getObligationsPageWindow(new Date(2026, 3, 16));

    const scoped = findUnmatchedHmrcPayments({
      patterns: ['HMRC GOV.UK SA%'],
      accounts: ['barclays-current'],
      startDate: window.startDate,
      endDate: window.endDate,
    });

    expect(scoped.map(p => p.date).sort()).toEqual(['2025-06-01', '2027-03-01']);
  });
});

describe('vat-auto-seed implicit coverage (pre-firstVatPaymentDate quarters)', () => {
  it('does NOT seed obligations for quarters due before the first observed VAT payment', async () => {
    // Transaction history begins Jan 2024 (earliestTxDate) but the user only
    // starts paying HMRC VAT in Oct 2024. Every quarter whose due date falls
    // before 2024-10-15 with no attributed payment must be implicitly covered
    // (status=insufficient-data), NOT surfaced as `unpaid` / overdue.
    insertIncome('barclays-current', '2024-01-15', 6000);
    insertIncome('barclays-current', '2024-02-15', 6000);
    insertIncome('barclays-current', '2024-05-15', 6000);
    insertIncome('barclays-current', '2024-08-15', 6000);
    insertIncome('barclays-current', '2024-11-15', 6000);

    // One VAT payment close to Aug-Oct 2024 due date (2024-12-07).
    insertExpense('barclays-current', '2024-12-05', -1000, 'HMRC VAT SOUTHEND');

    const { deriveAndInsertAutoObligations } = await import('./vat-auto-seed.js');
    deriveAndInsertAutoObligations();

    const rows = harness.db.prepare(
      `SELECT id, status, due_date FROM financial_obligations WHERE type = 'vat' ORDER BY due_date`
    ).all() as Array<{ id: string; status: string; due_date: string }>;

    // No row may carry a due_date before 2024-12-05 (firstVatPaymentDate).
    for (const row of rows) {
      if (row.status !== 'paid') {
        expect(row.due_date >= '2024-12-05').toBe(true);
      }
    }

    // The 2024-12-05 payment was awarded to Aug-Oct 2024 (due 2024-12-07).
    const augOct2024 = rows.find(r => r.id === 'auto-vat-2024-08-01');
    expect(augOct2024?.status).toBe('paid');
  });

  it('never seeds a £0 overdue quarter (no-income is implicitly insufficient-data)', async () => {
    // Income only in one quarter; previous quarters have no income BUT are
    // also past due. We must NEVER seed a £0 overdue obligation — that would
    // have been the old `no-income` bug.
    insertIncome('barclays-current', '2024-11-15', 5000);

    const { deriveAndInsertAutoObligations } = await import('./vat-auto-seed.js');
    deriveAndInsertAutoObligations();

    const zeroOverdue = harness.db.prepare(
      `SELECT id FROM financial_obligations
       WHERE type = 'vat' AND (expected_amount IS NULL OR expected_amount = 0)
         AND status IN ('unpaid', 'overdue', 'pending')`
    ).all() as Array<{ id: string }>;
    expect(zeroOverdue).toHaveLength(0);
  });
});

describe('VAT payment matching maps each HMRC payment to exactly one quarter', () => {
  it('does not double-count payments across adjacent quarters', async () => {
    // Barclays opens April 2022. Inject 4 quarters of income + 4 matching HMRC payments,
    // one per quarter on or just after each due date.
    insertIncome('barclays-current', '2025-02-15', 30000);
    insertIncome('barclays-current', '2025-05-15', 48360);
    insertIncome('barclays-current', '2025-08-15', 69918);
    insertIncome('barclays-current', '2025-11-15', 50964);

    insertExpense('barclays-current', '2025-06-09', -5000, 'HMRC VAT');
    insertExpense('barclays-current', '2025-09-08', -8060, 'HMRC VAT');
    insertExpense('barclays-current', '2025-12-08', -11653.06, 'HMRC VAT');
    insertExpense('barclays-current', '2026-03-09', -8494.07, 'HMRC VAT');

    const { deriveAndInsertAutoObligations } = await import('./vat-auto-seed.js');
    deriveAndInsertAutoObligations();

    const rows = harness.db.prepare(
      `SELECT id, paid_amount, paid_date FROM financial_obligations
       WHERE source = 'auto' AND type = 'vat' AND paid_amount IS NOT NULL
       ORDER BY due_date`
    ).all() as Array<{ id: string; paid_amount: number; paid_date: string }>;

    const paidAmounts = rows.map(r => r.paid_amount);
    for (const amount of paidAmounts) {
      expect(amount).toBeLessThanOrEqual(11653.06);
    }

    const paidDates = rows.map(r => r.paid_date);
    const uniqueDates = new Set(paidDates);
    expect(uniqueDates.size).toBe(paidDates.length);
  });
});

describe('VAT auto-seeder respects obligation dismissals', () => {
  it('skips a quarter whose id has been dismissed', async () => {
    insertIncome('barclays-current', '2025-02-15', 30000);
    insertIncome('barclays-current', '2025-05-15', 48360);

    const { deriveAndInsertAutoObligations } = await import('./vat-auto-seed.js');
    deriveAndInsertAutoObligations();

    const before = harness.db.prepare(
      `SELECT id FROM financial_obligations WHERE source = 'auto' AND type = 'vat' ORDER BY id`
    ).all() as Array<{ id: string }>;
    expect(before.length).toBeGreaterThan(0);

    const toHide = before[0].id;
    const { addDismissal } = await import('./obligation-dismissals.js');
    addDismissal({ obligationId: toHide, reason: 'Paid by cheque, no reminder needed' });

    deriveAndInsertAutoObligations();

    const after = harness.db.prepare(
      `SELECT id FROM financial_obligations WHERE source = 'auto' AND type = 'vat'`
    ).all() as Array<{ id: string }>;
    expect(after.some(r => r.id === toHide)).toBe(false);
  });

  it('undismiss restores the quarter on the next run', async () => {
    insertIncome('barclays-current', '2025-02-15', 30000);
    insertIncome('barclays-current', '2025-05-15', 48360);

    const { deriveAndInsertAutoObligations } = await import('./vat-auto-seed.js');
    const { addDismissal, removeDismissal } = await import('./obligation-dismissals.js');

    deriveAndInsertAutoObligations();
    const before = harness.db.prepare(
      `SELECT id FROM financial_obligations WHERE source = 'auto' AND type = 'vat' ORDER BY id`
    ).all() as Array<{ id: string }>;
    const id = before[0].id;

    addDismissal({ obligationId: id });
    deriveAndInsertAutoObligations();
    removeDismissal(id);
    deriveAndInsertAutoObligations();

    const after = harness.db.prepare(
      `SELECT id FROM financial_obligations WHERE source = 'auto' AND type = 'vat'`
    ).all() as Array<{ id: string }>;
    expect(after.some(r => r.id === id)).toBe(true);
  });
});
