import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  estimateSaForPerson,
  getSaTaxYearRange,
  getSaTaxYearForDate,
} from './sa-estimator.js';
import { getDirectorPayroll } from '../domain/payroll/index.js';
import { getObligationRegistry } from '../domain/obligations/registry.js';

const registry = getObligationRegistry();
const rentals = registry.listByCategory('rental-income');
if (rentals.length === 0) throw new Error('Expected at least one rental-income obligation in registry fixture');
const huntersSquareRaw = rentals[0];
if (huntersSquareRaw.account === undefined) {
  throw new Error(`Expected rental obligation ${huntersSquareRaw.id} to have an account in the registry fixture`);
}
const huntersSquare = { ...huntersSquareRaw, account: huntersSquareRaw.account };
import {
  calculateDividendTax,
  calculateIncomeTaxOnNonDividend,
} from '../config/tax-rates.js';

/**
 * Integration-style tests for the SA estimator.
 *
 * The estimator aggregates: (a) director salary + dividends classified by
 * proximity to the configured monthly salary, and (b) rental income on the
 * configured property accounts. We drive it against a real in-memory SQLite
 * using the same schema shape the app uses, so the salary-vs-dividend SQL
 * path and the rental-property SQL path are exercised end-to-end.
 */

let testDb: Database.Database;

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
  `);
}

let hashSeq = 0;
function insertExpense(date: string, description: string, amount: number, account = 'barclays-current'): void {
  hashSeq++;
  testDb.prepare(`
    INSERT INTO transactions (hash, date, description, amount, account, type)
    VALUES (?, ?, ?, ?, ?, 'expense')
  `).run(`hash-${hashSeq}`, date, description, amount, account);
}
function insertIncome(date: string, description: string, amount: number, account: string): void {
  hashSeq++;
  testDb.prepare(`
    INSERT INTO transactions (hash, date, description, amount, account, type)
    VALUES (?, ?, ?, ?, ?, 'income')
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
  hashSeq = 0;
});

describe('getSaTaxYearRange', () => {
  it('returns 6 Apr → 5 Apr boundaries', () => {
    expect(getSaTaxYearRange(2024)).toEqual({ start: '2024-04-06', end: '2025-04-05' });
  });
});

describe('getSaTaxYearForDate', () => {
  it('treats 5 April as previous tax year', () => {
    expect(getSaTaxYearForDate(new Date('2025-04-05'))).toBe(2024);
  });
  it('treats 6 April as new tax year', () => {
    expect(getSaTaxYearForDate(new Date('2025-04-06'))).toBe(2025);
  });
  it('handles mid-year dates', () => {
    expect(getSaTaxYearForDate(new Date('2025-09-15'))).toBe(2025);
    expect(getSaTaxYearForDate(new Date('2025-01-10'))).toBe(2024);
  });
});

describe('estimateSaForPerson', () => {
  const { start, end } = getSaTaxYearRange(2024);

  it('returns zeros when there is no data', () => {
    const estimate = estimateSaForPerson('david', start, end, testDb);
    expect(estimate.salary).toBe(0);
    expect(estimate.dividends).toBe(0);
    expect(estimate.rentalIncome).toBe(0);
    expect(estimate.taxableIncome).toBe(0);
    expect(estimate.estimatedTax).toBe(0);
    expect(estimate.personId).toBe('david');
  });

  it('classifies payments near monthlySalary as salary and others as dividends', () => {
    const david = getDirectorPayroll('david')!;
    const monthly = david.monthlySalary;

    insertExpense('2024-05-20', 'DAVID MORRISON PAYROLL', -monthly);
    insertExpense('2024-06-20', 'DAVID MORRISON PAYROLL', -monthly);
    insertExpense('2024-07-15', 'DAVID MORRISON DIVIDEND', -5000);
    insertExpense('2024-09-01', 'DAVID MORRISON DIVIDEND', -10000);
    insertExpense('2024-05-15', 'HEENA TAILOR SALARY', -monthly);

    const estimate = estimateSaForPerson('david', start, end, testDb);
    expect(estimate.salary).toBe(monthly * 2);
    expect(estimate.dividends).toBe(15000);
    expect(estimate.rentalIncome).toBe(0);
    expect(estimate.taxableIncome).toBe(monthly * 2 + 15000);
  });

  it('attributes rental income by ownership share', () => {
    const monthly = huntersSquare.amount;

    insertIncome('2024-05-01', `Rent from ${huntersSquare.merchant}`, monthly, huntersSquare.account);
    insertIncome('2024-06-01', `Rent from ${huntersSquare.merchant}`, monthly, huntersSquare.account);

    const estimate = estimateSaForPerson('david', start, end, testDb);
    const davidShare = huntersSquare.ownership.david ?? 0;
    expect(estimate.rentalIncome).toBeCloseTo(monthly * 2 * davidShare, 2);
  });

  it('estimatedTax equals dividend tax + non-dividend tax on rental income', () => {
    const david = getDirectorPayroll('david')!;
    const monthly = david.monthlySalary;

    for (let m = 0; m < 12; m++) {
      const month = String(m + 4).padStart(2, '0');
      insertExpense(`2024-${month}-15`, 'DAVID MORRISON PAYROLL', -monthly);
    }
    insertExpense('2024-10-01', 'DAVID MORRISON DIVIDEND', -20000);
    insertIncome('2024-05-01', `Rent ${huntersSquare.merchant}`, huntersSquare.amount * 12, huntersSquare.account);

    const estimate = estimateSaForPerson('david', start, end, testDb);
    const expectedDividendTax = calculateDividendTax(estimate.dividends, estimate.salary);
    const expectedRentalTax = calculateIncomeTaxOnNonDividend(estimate.rentalIncome, estimate.salary);
    expect(estimate.estimatedTax).toBeCloseTo(expectedDividendTax + expectedRentalTax, 2);
  });

  it('only includes transactions within the window', () => {
    const david = getDirectorPayroll('david')!;
    insertExpense('2024-04-05', 'DAVID MORRISON DIVIDEND', -10000);
    insertExpense('2024-04-06', 'DAVID MORRISON DIVIDEND', -10000);
    insertExpense('2025-04-05', 'DAVID MORRISON DIVIDEND', -10000);
    insertExpense('2025-04-06', 'DAVID MORRISON DIVIDEND', -10000);

    const estimate = estimateSaForPerson('david', start, end, testDb);
    expect(estimate.salary).toBe(0);
    expect(estimate.dividends).toBe(20000);
    expect(david.monthlySalary).toBeGreaterThan(0);
  });
});
