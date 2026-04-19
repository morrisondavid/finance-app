import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
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

// Import AFTER the mock is registered.
import * as DebtsRepo from './debts.js';
import { readDebtsFromCsvFile, DEBTS_CSV_FILENAME } from '../debts-csv.js';

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

function insertTransaction(t: {
  date: string;
  description: string;
  amount: number;
  account: string;
  type: 'expense' | 'income' | 'transfer';
}): void {
  hoisted.db!.prepare(
    'INSERT INTO transactions (date, description, amount, account, type) VALUES (?, ?, ?, ?, ?)',
  ).run(t.date, t.description, t.amount, t.account, t.type);
}

describe('debts repository', () => {
  beforeAll(() => {
    hoisted.db = new Database(':memory:');
    createSchema();
  });

  afterAll(() => {
    hoisted.db?.close();
  });

  beforeEach(() => {
    hoisted.db!.exec('DELETE FROM debts; DELETE FROM transactions;');
    hoisted.debtsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'debts-repo-test-'));
  });

  afterEach(() => {
    fs.rmSync(hoisted.debtsDir, { recursive: true, force: true });
  });

  describe('loadDebtsFromFileIntoDb', () => {
    it('seeds CSV with defaults on first boot and populates the db', () => {
      DebtsRepo.loadDebtsFromFileIntoDb();
      const csvPath = path.join(hoisted.debtsDir, DEBTS_CSV_FILENAME);
      expect(fs.existsSync(csvPath)).toBe(true);
      const rows = DebtsRepo.listDebts({ includeArchived: true });
      expect(rows.map(r => r.id).sort()).toEqual([
        'bathroom-loan-a',
        'bathroom-loan-b',
        'bounce-back-loan',
        'funding-circle',
        'mortgage-hunters-square',
        'mortgage-thorney-house',
        'novuna',
      ]);
      const a = rows.find(r => r.id === 'bathroom-loan-a')!;
      expect(a.matchAmounts).toEqual([232.22]);
      const m = rows.find(r => r.id === 'mortgage-hunters-square')!;
      expect(m.kind).toBe('mortgage');
      expect(m.interestRate).toBe(4.48);
    });

    it('DELETEs existing rows and reloads from CSV', () => {
      DebtsRepo.loadDebtsFromFileIntoDb();
      hoisted.db!
        .prepare(
          'INSERT INTO debts (id, name, merchant_pattern, source_accounts, original_loan_amount, opening_balance, opening_balance_date) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run('extra', 'Extra', 'EXTRA', 'barclays-current', 100, 50, '2026-04-19');
      DebtsRepo.loadDebtsFromFileIntoDb();
      const rows = DebtsRepo.listDebts({ includeArchived: true });
      expect(rows.find(r => r.id === 'extra')).toBeUndefined();
    });

    it('tops up missing defaults when CSV is pre-seeded with only a subset', () => {
      const csvPath = path.join(hoisted.debtsDir, DEBTS_CSV_FILENAME);
      fs.writeFileSync(
        csvPath,
        'id,name,merchant_pattern,source_accounts,original_loan_amount,original_loan_date,opening_balance,opening_balance_date,archived,match_amounts\n'
          + 'funding-circle,Funding Circle,FUNDING CIRCLE,barclays-current,18700,2023-11-09,13138.71,2026-04-19,,\n',
        'utf8',
      );
      DebtsRepo.loadDebtsFromFileIntoDb();
      const rows = DebtsRepo.listDebts({ includeArchived: true });
      expect(rows.map(r => r.id).sort()).toEqual([
        'bathroom-loan-a',
        'bathroom-loan-b',
        'bounce-back-loan',
        'funding-circle',
        'mortgage-hunters-square',
        'mortgage-thorney-house',
        'novuna',
      ]);
      const reread = readDebtsFromCsvFile(csvPath);
      const a = reread.find(r => r.id === 'bathroom-loan-a')!;
      expect(a.matchAmounts).toEqual([232.22]);
    });

    it('does not re-add a default whose id is already present as archived (soft-delete semantics)', () => {
      const csvPath = path.join(hoisted.debtsDir, DEBTS_CSV_FILENAME);
      fs.writeFileSync(
        csvPath,
        'id,name,merchant_pattern,source_accounts,original_loan_amount,original_loan_date,opening_balance,opening_balance_date,archived,match_amounts\n'
          + 'bathroom-loan-a,Bathroom Loan (A),Barclays Partner Finance,monzo-joint,9191.26,,3850.20,2026-04-19,true,232.22\n',
        'utf8',
      );
      DebtsRepo.loadDebtsFromFileIntoDb();
      const rows = DebtsRepo.listDebts({ includeArchived: true });
      const a = rows.find(r => r.id === 'bathroom-loan-a')!;
      expect(a.archived).toBe(true);
      // Exactly one row for that id — top-up did not duplicate it.
      expect(rows.filter(r => r.id === 'bathroom-loan-a')).toHaveLength(1);
    });

    it('round-trips matchAmounts when the DB row is dropped and reloaded from CSV', () => {
      DebtsRepo.loadDebtsFromFileIntoDb();
      hoisted.db!.prepare('DELETE FROM debts WHERE id = ?').run('bathroom-loan-a');
      DebtsRepo.loadDebtsFromFileIntoDb();
      const a = DebtsRepo.getDebt('bathroom-loan-a')!;
      expect(a.matchAmounts).toEqual([232.22]);
      expect(a.openingBalance).toBe(3850.2);
    });

    it('nuke-and-rebuild: reconciled state survives a full DB wipe via the CSV', () => {
      DebtsRepo.loadDebtsFromFileIntoDb();
      // Insert a matching payment so reconciliation shifts bathroom-loan-a.
      insertTransaction({
        date: '2025-06-03',
        description: 'Barclays Partner Finance',
        amount: -232.22,
        account: 'monzo-joint',
        type: 'expense',
      });
      DebtsRepo.reconcileDebtOpeningDates();

      const before = DebtsRepo.getDebt('bathroom-loan-a')!;
      expect(before.openingBalanceDate).toBe('2025-06-02');
      expect(before.openingBalance).toBe(4082.42); // 3850.20 + 232.22
      expect(before.matchAmounts).toEqual([232.22]);

      hoisted.db!.exec('DELETE FROM debts');
      DebtsRepo.loadDebtsFromFileIntoDb();

      const after = DebtsRepo.getDebt('bathroom-loan-a')!;
      expect(after.matchAmounts).toEqual([232.22]);
      expect(after.openingBalance).toBe(before.openingBalance);
      expect(after.openingBalanceDate).toBe(before.openingBalanceDate);
    });
  });

  describe('export round-trip', () => {
    it('loadDebtsFromFileIntoDb → exportDebtsFromDbToFile preserves rows', () => {
      DebtsRepo.loadDebtsFromFileIntoDb();
      const csvPath = path.join(hoisted.debtsDir, DEBTS_CSV_FILENAME);
      const before = readDebtsFromCsvFile(csvPath);
      DebtsRepo.exportDebtsFromDbToFile();
      const after = readDebtsFromCsvFile(csvPath);
      expect(after).toHaveLength(before.length);
      for (const row of before) {
        const match = after.find(r => r.id === row.id);
        expect(match).toBeDefined();
        expect(match!.openingBalance).toBe(row.openingBalance);
        expect(match!.sourceAccounts).toEqual(row.sourceAccounts);
      }
    });
  });

  describe('CRUD', () => {
    it('createDebt inserts and triggers a CSV export', () => {
      DebtsRepo.loadDebtsFromFileIntoDb();
      DebtsRepo.createDebt({
        id: 'new-loan',
        name: 'New Loan',
        merchantPattern: 'NEW LOAN',
        sourceAccounts: ['barclays-current'],
        originalLoanAmount: 1000,
        openingBalance: 800,
        openingBalanceDate: '2026-04-19',
      });
      expect(DebtsRepo.getDebt('new-loan')?.name).toBe('New Loan');
      const csvPath = path.join(hoisted.debtsDir, DEBTS_CSV_FILENAME);
      const csvRows = readDebtsFromCsvFile(csvPath);
      expect(csvRows.find(r => r.id === 'new-loan')).toBeDefined();
    });

    it('createDebt rejects duplicate ids', () => {
      DebtsRepo.createDebt({
        id: 'dup',
        name: 'Dup',
        merchantPattern: 'X',
        sourceAccounts: ['barclays-current'],
        originalLoanAmount: 100,
        openingBalance: 50,
        openingBalanceDate: '2026-04-19',
      });
      expect(() =>
        DebtsRepo.createDebt({
          id: 'dup',
          name: 'Dup Again',
          merchantPattern: 'X',
          sourceAccounts: ['barclays-current'],
          originalLoanAmount: 100,
          openingBalance: 50,
          openingBalanceDate: '2026-04-19',
        }),
      ).toThrow(/already exists/);
    });

    it('updateDebt rewrites fields and triggers CSV export', () => {
      DebtsRepo.createDebt({
        id: 'u',
        name: 'Original',
        merchantPattern: 'X',
        sourceAccounts: ['barclays-current'],
        originalLoanAmount: 1000,
        openingBalance: 500,
        openingBalanceDate: '2026-04-19',
      });
      const updated = DebtsRepo.updateDebt('u', {
        name: 'Renamed',
        merchantPattern: 'XY',
      });
      expect(updated.name).toBe('Renamed');
      expect(updated.merchantPattern).toBe('XY');

      const csvRows = readDebtsFromCsvFile(path.join(hoisted.debtsDir, DEBTS_CSV_FILENAME));
      expect(csvRows.find(r => r.id === 'u')?.name).toBe('Renamed');
    });

    it('archiveDebt flips the archived flag and hides from active list', () => {
      DebtsRepo.createDebt({
        id: 'a',
        name: 'A',
        merchantPattern: 'X',
        sourceAccounts: ['barclays-current'],
        originalLoanAmount: 100,
        openingBalance: 50,
        openingBalanceDate: '2026-04-19',
      });
      DebtsRepo.archiveDebt('a');
      expect(DebtsRepo.listDebts({ includeArchived: false })).toHaveLength(0);
      expect(DebtsRepo.listDebts({ includeArchived: true })).toHaveLength(1);
    });

    it('setOpeningDebtBalance updates only balance + date', () => {
      DebtsRepo.createDebt({
        id: 's',
        name: 'S',
        merchantPattern: 'X',
        sourceAccounts: ['barclays-current'],
        originalLoanAmount: 100,
        openingBalance: 80,
        openingBalanceDate: '2026-04-01',
      });
      const updated = DebtsRepo.setOpeningDebtBalance('s', 60, '2026-05-01');
      expect(updated.openingBalance).toBe(60);
      expect(updated.openingBalanceDate).toBe('2026-05-01');
      expect(updated.name).toBe('S');
      expect(updated.merchantPattern).toBe('X');
    });

    it('updateDebt throws on unknown id', () => {
      expect(() => DebtsRepo.updateDebt('missing', { name: 'X' })).toThrow(/not found/);
    });
  });

  describe('summary math', () => {
    beforeEach(() => {
      DebtsRepo.createDebt({
        id: 'test',
        name: 'Test Debt',
        merchantPattern: 'TESTPAY',
        sourceAccounts: ['barclays-current'],
        originalLoanAmount: 1000,
        originalLoanDate: '2024-01-01',
        openingBalance: 500,
        openingBalanceDate: '2026-01-01',
      });
    });

    it('counts expense rows matching pattern + account + date > opening_balance_date', () => {
      insertTransaction({ date: '2026-02-01', description: 'TESTPAY jan', amount: -100, account: 'barclays-current', type: 'expense' });
      insertTransaction({ date: '2026-03-01', description: 'TESTPAY feb', amount: -100, account: 'barclays-current', type: 'expense' });

      const debt = DebtsRepo.getDebt('test')!;
      const summary = DebtsRepo.getDebtSummary(debt);
      expect(summary.paidSinceOpening).toBe(200);
      expect(summary.matchedTransactionCount).toBe(2);
      expect(summary.currentBalance).toBe(300); // 500 - 200
    });

    it('ignores transactions on or before the opening_balance_date', () => {
      insertTransaction({ date: '2026-01-01', description: 'TESTPAY on-date', amount: -100, account: 'barclays-current', type: 'expense' });
      insertTransaction({ date: '2025-12-15', description: 'TESTPAY before', amount: -100, account: 'barclays-current', type: 'expense' });

      const debt = DebtsRepo.getDebt('test')!;
      const summary = DebtsRepo.getDebtSummary(debt);
      expect(summary.paidSinceOpening).toBe(0);
      expect(summary.matchedTransactionCount).toBe(0);
    });

    it('ignores transactions on the wrong account', () => {
      insertTransaction({ date: '2026-02-01', description: 'TESTPAY', amount: -100, account: 'natwest', type: 'expense' });
      const debt = DebtsRepo.getDebt('test')!;
      const summary = DebtsRepo.getDebtSummary(debt);
      expect(summary.paidSinceOpening).toBe(0);
    });

    it('ignores income rows even if description matches', () => {
      insertTransaction({ date: '2026-02-01', description: 'TESTPAY refund', amount: 100, account: 'barclays-current', type: 'income' });
      const debt = DebtsRepo.getDebt('test')!;
      const summary = DebtsRepo.getDebtSummary(debt);
      expect(summary.paidSinceOpening).toBe(0);
    });

    it('payoffProgress tracks principal paid down', () => {
      insertTransaction({ date: '2026-02-01', description: 'TESTPAY', amount: -250, account: 'barclays-current', type: 'expense' });
      const debt = DebtsRepo.getDebt('test')!;
      const summary = DebtsRepo.getDebtSummary(debt);
      // original 1000, currentBalance = 500 - 250 = 250, so 750 paid → 0.75
      expect(summary.currentBalance).toBe(250);
      expect(summary.payoffProgress).toBeCloseTo(0.75, 5);
    });

    it('payoffProgress reflects opening balance being less than principal', () => {
      const debt = DebtsRepo.getDebt('test')!;
      const summary = DebtsRepo.getDebtSummary(debt);
      // 1000 original, 500 current balance (no payments yet) → 500 paid → 0.5
      expect(summary.payoffProgress).toBe(0.5);
    });

    it('currentBalance is clamped at 0 even if paid overshoots opening balance', () => {
      insertTransaction({ date: '2026-02-01', description: 'TESTPAY', amount: -5000, account: 'barclays-current', type: 'expense' });
      const debt = DebtsRepo.getDebt('test')!;
      const summary = DebtsRepo.getDebtSummary(debt);
      expect(summary.currentBalance).toBe(0);
      expect(summary.payoffProgress).toBe(1);
    });

    it('reports last payment date and amount from most recent matching expense', () => {
      insertTransaction({ date: '2026-02-01', description: 'TESTPAY 1', amount: -100, account: 'barclays-current', type: 'expense' });
      insertTransaction({ date: '2026-03-15', description: 'TESTPAY 2', amount: -120, account: 'barclays-current', type: 'expense' });
      insertTransaction({ date: '2026-03-10', description: 'TESTPAY 3', amount: -90, account: 'barclays-current', type: 'expense' });

      const debt = DebtsRepo.getDebt('test')!;
      const summary = DebtsRepo.getDebtSummary(debt);
      expect(summary.lastPaymentDate).toBe('2026-03-15');
      expect(summary.lastPaymentAmount).toBe(120);
      expect(summary.matchedTransactionCount).toBe(3);
    });

    it('matchAmounts disambiguates two debts that share a merchant pattern', () => {
      DebtsRepo.createDebt({
        id: 'loan-a',
        name: 'A',
        merchantPattern: 'PARTNERFIN',
        sourceAccounts: ['monzo-joint'],
        originalLoanAmount: 1000,
        openingBalance: 800,
        openingBalanceDate: '2026-01-01',
        matchAmounts: [232.22],
      });
      DebtsRepo.createDebt({
        id: 'loan-b',
        name: 'B',
        merchantPattern: 'PARTNERFIN',
        sourceAccounts: ['monzo-joint'],
        originalLoanAmount: 1000,
        openingBalance: 900,
        openingBalanceDate: '2026-01-01',
        matchAmounts: [192.66],
      });
      insertTransaction({ date: '2026-02-01', description: 'PARTNERFIN feb', amount: -232.22, account: 'monzo-joint', type: 'expense' });
      insertTransaction({ date: '2026-03-01', description: 'PARTNERFIN mar', amount: -232.22, account: 'monzo-joint', type: 'expense' });
      insertTransaction({ date: '2026-02-15', description: 'PARTNERFIN feb2', amount: -192.66, account: 'monzo-joint', type: 'expense' });

      const a = DebtsRepo.getDebtSummary(DebtsRepo.getDebt('loan-a')!);
      expect(a.matchedTransactionCount).toBe(2);
      expect(a.paidSinceOpening).toBeCloseTo(464.44, 5);
      expect(a.lastPaymentAmount).toBeCloseTo(232.22, 5);

      const b = DebtsRepo.getDebtSummary(DebtsRepo.getDebt('loan-b')!);
      expect(b.matchedTransactionCount).toBe(1);
      expect(b.paidSinceOpening).toBeCloseTo(192.66, 5);
      expect(b.lastPaymentAmount).toBeCloseTo(192.66, 5);
    });

    it('getAllDebtSummaries sums currentBalance across active debts only', () => {
      DebtsRepo.createDebt({
        id: 'other',
        name: 'Other',
        merchantPattern: 'OTHER',
        sourceAccounts: ['barclays-current'],
        originalLoanAmount: 200,
        openingBalance: 100,
        openingBalanceDate: '2026-01-01',
      });
      DebtsRepo.createDebt({
        id: 'zombie',
        name: 'Zombie',
        merchantPattern: 'Z',
        sourceAccounts: ['barclays-current'],
        originalLoanAmount: 100,
        openingBalance: 75,
        openingBalanceDate: '2026-01-01',
      });
      DebtsRepo.archiveDebt('zombie');

      const { debts, totalOutstanding } = DebtsRepo.getAllDebtSummaries();
      // active: test (500) + other (100) = 600. Zombie is archived.
      expect(debts.find(d => d.id === 'test')).toBeDefined();
      expect(debts.find(d => d.id === 'zombie')).toBeUndefined();
      expect(totalOutstanding).toBe(600);
    });

    it('mortgage balance is static: matched transactions do not reduce currentBalance', () => {
      DebtsRepo.createDebt({
        id: 'mtg',
        name: 'Mortgage',
        merchantPattern: 'MORTGAGE',
        sourceAccounts: ['natwest'],
        originalLoanAmount: 200000,
        openingBalance: 200000,
        openingBalanceDate: '2026-01-01',
        kind: 'mortgage',
        repaymentType: 'interest-only',
        interestRate: 4.48,
        propertyValueEstimate: 300000,
        propertyId: 'test-property',
      });
      insertTransaction({ date: '2026-02-01', description: 'MORTGAGE feb', amount: -800, account: 'natwest', type: 'expense' });
      insertTransaction({ date: '2026-03-01', description: 'MORTGAGE mar', amount: -800, account: 'natwest', type: 'expense' });

      const debt = DebtsRepo.getDebt('mtg')!;
      expect(debt.kind).toBe('mortgage');
      const summary = DebtsRepo.getDebtSummary(debt);
      expect(summary.currentBalance).toBe(200000);
      expect(summary.paidSinceOpening).toBe(1600);
      expect(summary.matchedTransactionCount).toBe(2);
    });

    it('getAllDebtSummaries returns split totals for consumer vs mortgage', () => {
      DebtsRepo.createDebt({
        id: 'mtg2',
        name: 'Mortgage 2',
        merchantPattern: 'MTG2',
        sourceAccounts: ['natwest'],
        originalLoanAmount: 100000,
        openingBalance: 100000,
        openingBalanceDate: '2026-01-01',
        kind: 'mortgage',
        repaymentType: 'interest-only',
        propertyValueEstimate: 150000,
      });
      const result = DebtsRepo.getAllDebtSummaries();
      // test (consumer, 500) + mtg2 (mortgage, 100000)
      expect(result.consumerTotal).toBe(500);
      expect(result.mortgageTotal).toBe(100000);
      expect(result.totalOutstanding).toBe(100500);
      expect(result.totalPropertyValue).toBe(150000);
      expect(result.netEquity).toBe(50000);
    });
  });

  describe('reconcileDebtOpeningDates', () => {
    it('shifts opening date before earliest match and bumps balance to preserve currentBalance', () => {
      DebtsRepo.createDebt({
        id: 'rec',
        name: 'Rec',
        merchantPattern: 'RECPAY',
        sourceAccounts: ['barclays-current'],
        originalLoanAmount: 2000,
        openingBalance: 1000,
        openingBalanceDate: '2026-04-19',
      });
      insertTransaction({ date: '2024-01-15', description: 'RECPAY jan', amount: -200, account: 'barclays-current', type: 'expense' });
      insertTransaction({ date: '2025-06-10', description: 'RECPAY jun', amount: -200, account: 'barclays-current', type: 'expense' });
      insertTransaction({ date: '2026-03-05', description: 'RECPAY mar', amount: -200, account: 'barclays-current', type: 'expense' });

      DebtsRepo.reconcileDebtOpeningDates();

      const debt = DebtsRepo.getDebt('rec')!;
      expect(debt.openingBalanceDate).toBe('2024-01-14');
      expect(debt.openingBalance).toBe(1600);

      const summary = DebtsRepo.getDebtSummary(debt);
      expect(summary.currentBalance).toBe(1000); // preserved
      expect(summary.matchedTransactionCount).toBe(3);
      expect(summary.paidSinceOpening).toBe(600);
      expect(summary.lastPaymentDate).toBe('2026-03-05');
      expect(summary.lastPaymentAmount).toBe(200);
    });

    it('is idempotent: second run does not shift further', () => {
      DebtsRepo.createDebt({
        id: 'idem',
        name: 'Idem',
        merchantPattern: 'IDEMPAY',
        sourceAccounts: ['barclays-current'],
        originalLoanAmount: 1000,
        openingBalance: 500,
        openingBalanceDate: '2026-04-19',
      });
      insertTransaction({ date: '2025-01-10', description: 'IDEMPAY', amount: -100, account: 'barclays-current', type: 'expense' });

      DebtsRepo.reconcileDebtOpeningDates();
      const afterFirst = DebtsRepo.getDebt('idem')!;
      expect(afterFirst.openingBalanceDate).toBe('2025-01-09');
      expect(afterFirst.openingBalance).toBe(600);

      DebtsRepo.reconcileDebtOpeningDates();
      const afterSecond = DebtsRepo.getDebt('idem')!;
      expect(afterSecond.openingBalanceDate).toBe('2025-01-09');
      expect(afterSecond.openingBalance).toBe(600);
    });

    it('skips debts with no matching transactions', () => {
      DebtsRepo.createDebt({
        id: 'nomatch',
        name: 'No Match',
        merchantPattern: 'NOMATCH',
        sourceAccounts: ['barclays-current'],
        originalLoanAmount: 1000,
        openingBalance: 500,
        openingBalanceDate: '2026-04-19',
      });
      insertTransaction({ date: '2025-06-01', description: 'SOMETHING ELSE', amount: -100, account: 'barclays-current', type: 'expense' });

      DebtsRepo.reconcileDebtOpeningDates();

      const debt = DebtsRepo.getDebt('nomatch')!;
      expect(debt.openingBalanceDate).toBe('2026-04-19');
      expect(debt.openingBalance).toBe(500);
    });

    it('is a no-op when opening date is already before the earliest match', () => {
      DebtsRepo.createDebt({
        id: 'early',
        name: 'Early',
        merchantPattern: 'EARLYPAY',
        sourceAccounts: ['barclays-current'],
        originalLoanAmount: 1000,
        openingBalance: 800,
        openingBalanceDate: '2023-12-31',
      });
      insertTransaction({ date: '2024-01-01', description: 'EARLYPAY', amount: -100, account: 'barclays-current', type: 'expense' });

      DebtsRepo.reconcileDebtOpeningDates();

      const debt = DebtsRepo.getDebt('early')!;
      expect(debt.openingBalanceDate).toBe('2023-12-31');
      expect(debt.openingBalance).toBe(800);
    });

    it('re-exports debts.csv with shifted values when any row is shifted', () => {
      DebtsRepo.createDebt({
        id: 'csv',
        name: 'CSV',
        merchantPattern: 'CSVPAY',
        sourceAccounts: ['barclays-current'],
        originalLoanAmount: 1000,
        openingBalance: 500,
        openingBalanceDate: '2026-04-19',
      });
      insertTransaction({ date: '2025-07-20', description: 'CSVPAY', amount: -150, account: 'barclays-current', type: 'expense' });

      DebtsRepo.reconcileDebtOpeningDates();

      const csvPath = path.join(hoisted.debtsDir, DEBTS_CSV_FILENAME);
      const rows = readDebtsFromCsvFile(csvPath);
      const row = rows.find(r => r.id === 'csv');
      expect(row).toBeDefined();
      expect(row!.openingBalanceDate).toBe('2025-07-19');
      expect(row!.openingBalance).toBe(650);
    });

    it('respects matchAmounts: shifts each same-pattern debt independently', () => {
      DebtsRepo.createDebt({
        id: 'loan-a',
        name: 'Loan A',
        merchantPattern: 'SHARED',
        sourceAccounts: ['monzo-joint'],
        originalLoanAmount: 1000,
        openingBalance: 500,
        openingBalanceDate: '2026-04-19',
        matchAmounts: [100],
      });
      DebtsRepo.createDebt({
        id: 'loan-b',
        name: 'Loan B',
        merchantPattern: 'SHARED',
        sourceAccounts: ['monzo-joint'],
        originalLoanAmount: 500,
        openingBalance: 200,
        openingBalanceDate: '2026-04-19',
        matchAmounts: [50],
      });
      // Loan A gets the earlier payment (Feb), Loan B gets the later (March).
      insertTransaction({ date: '2025-02-10', description: 'SHARED Feb', amount: -100, account: 'monzo-joint', type: 'expense' });
      insertTransaction({ date: '2025-03-15', description: 'SHARED Mar', amount: -50, account: 'monzo-joint', type: 'expense' });

      DebtsRepo.reconcileDebtOpeningDates();

      const a = DebtsRepo.getDebt('loan-a')!;
      expect(a.openingBalanceDate).toBe('2025-02-09');
      expect(a.openingBalance).toBe(600); // 500 + 100

      const b = DebtsRepo.getDebt('loan-b')!;
      expect(b.openingBalanceDate).toBe('2025-03-14');
      expect(b.openingBalance).toBe(250); // 200 + 50
    });

    it('ignores income and wrong-account transactions when finding earliest match', () => {
      DebtsRepo.createDebt({
        id: 'filter',
        name: 'Filter',
        merchantPattern: 'FILTERPAY',
        sourceAccounts: ['barclays-current'],
        originalLoanAmount: 1000,
        openingBalance: 500,
        openingBalanceDate: '2026-04-19',
      });
      // These should NOT be picked up as the earliest match.
      insertTransaction({ date: '2023-01-01', description: 'FILTERPAY refund', amount: 100, account: 'barclays-current', type: 'income' });
      insertTransaction({ date: '2023-06-01', description: 'FILTERPAY', amount: -100, account: 'natwest', type: 'expense' });
      // This IS the earliest qualifying match.
      insertTransaction({ date: '2025-05-10', description: 'FILTERPAY', amount: -100, account: 'barclays-current', type: 'expense' });

      DebtsRepo.reconcileDebtOpeningDates();

      const debt = DebtsRepo.getDebt('filter')!;
      expect(debt.openingBalanceDate).toBe('2025-05-09');
      expect(debt.openingBalance).toBe(600);
    });
  });
});
