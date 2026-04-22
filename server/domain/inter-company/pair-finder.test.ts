import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  createInMemoryTestDb,
  resetTestData,
  type TestDbHandles,
} from '../../db/test-harness/in-memory-db.js';
import {
  doAmountsAndDatesMatch,
  doAmountsAndDatesMatchForAccounts,
  findInterCompanyPairs,
} from './pair-finder.js';
import { CROSS_CURRENCY_TOLERANCE } from '../../config/transfer-patterns.js';
import { getRateSync } from '../../config/exchange-rates.js';

/**
 * Phase 8 step 5 — regression lock for the inter-company pair
 * finder. Two concerns:
 *
 *   1. `doAmountsAndDatesMatch` is the pure predicate shared with
 *      `detectTransfers()`. Any drift here silently changes
 *      within-entity pairing behaviour too, so each branch gets a
 *      locked-down test.
 *   2. `findInterCompanyPairs` is the DB-facing entry point used by
 *      the Warnings tab. The important invariants are: only business
 *      accounts on both sides, entity ids must differ, already-paired
 *      transfer rows are skipped.
 */

function insertTxn(
  db: import('better-sqlite3').Database,
  row: {
    hash: string;
    date: string;
    description: string;
    amount: number;
    account: string;
    type: 'income' | 'expense' | 'transfer';
    linkedTransactionId?: number | null;
  },
): number {
  const stmt = db.prepare(
    `INSERT INTO transactions (hash, date, description, amount, account, type, linked_transaction_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const info = stmt.run(
    row.hash,
    row.date,
    row.description,
    row.amount,
    row.account,
    row.type,
    row.linkedTransactionId ?? null,
  );
  return Number(info.lastInsertRowid);
}

describe('doAmountsAndDatesMatch — pure predicate', () => {
  it('accepts exact same-currency same-date pairs', () => {
    expect(
      doAmountsAndDatesMatch({
        expenseAmount: -500,
        expenseCurrency: 'GBP',
        expenseDate: '2026-03-01',
        incomeAmount: 500,
        incomeCurrency: 'GBP',
        incomeDate: '2026-03-01',
      }),
    ).toBe(true);
  });

  it('accepts same-currency pairs within the 5-day date tolerance', () => {
    expect(
      doAmountsAndDatesMatch({
        expenseAmount: -500,
        expenseCurrency: 'GBP',
        expenseDate: '2026-03-01',
        incomeAmount: 500,
        incomeCurrency: 'GBP',
        incomeDate: '2026-03-06',
      }),
    ).toBe(true);
  });

  it('rejects same-currency pairs outside the date tolerance', () => {
    expect(
      doAmountsAndDatesMatch({
        expenseAmount: -500,
        expenseCurrency: 'GBP',
        expenseDate: '2026-03-01',
        incomeAmount: 500,
        incomeCurrency: 'GBP',
        incomeDate: '2026-03-07',
      }),
    ).toBe(false);
  });

  it('rejects same-currency pairs with differing amounts above 1p', () => {
    expect(
      doAmountsAndDatesMatch({
        expenseAmount: -500,
        expenseCurrency: 'GBP',
        expenseDate: '2026-03-01',
        incomeAmount: 499.98,
        incomeCurrency: 'GBP',
        incomeDate: '2026-03-01',
      }),
    ).toBe(false);
  });

  it('accepts cross-currency pairs within CROSS_CURRENCY_TOLERANCE', () => {
    const gbp = 1000;
    const converted = gbp * getRateSync('GBP', 'AED');
    // 5% below the converted value — well inside the 20% tolerance
    // window (diff / incomeAbs ≈ 0.053) while still being a realistic
    // FX spread.
    const income = converted * 0.95;
    expect(CROSS_CURRENCY_TOLERANCE).toBeGreaterThan(0.05);
    expect(
      doAmountsAndDatesMatch({
        expenseAmount: -gbp,
        expenseCurrency: 'GBP',
        expenseDate: '2026-03-01',
        incomeAmount: income,
        incomeCurrency: 'AED',
        incomeDate: '2026-03-02',
      }),
    ).toBe(true);
  });

  it('rejects cross-currency pairs beyond CROSS_CURRENCY_TOLERANCE', () => {
    const gbp = 1000;
    const converted = gbp * getRateSync('GBP', 'AED');
    // Halve the converted value so diff/incomeAbs == 1.0, comfortably
    // outside any plausible FX-tolerance setting.
    const income = converted * 0.5;
    expect(
      doAmountsAndDatesMatch({
        expenseAmount: -gbp,
        expenseCurrency: 'GBP',
        expenseDate: '2026-03-01',
        incomeAmount: income,
        incomeCurrency: 'AED',
        incomeDate: '2026-03-02',
      }),
    ).toBe(false);
  });
});

describe('doAmountsAndDatesMatchForAccounts', () => {
  it('resolves currency from account id for the FX case', () => {
    const gbp = 500;
    const aed = gbp * getRateSync('GBP', 'AED');
    expect(
      doAmountsAndDatesMatchForAccounts({
        expenseAccount: 'barclays-current',
        expenseAmount: -gbp,
        expenseDate: '2026-03-01',
        incomeAccount: 'emirates-islamic',
        incomeAmount: aed,
        incomeDate: '2026-03-02',
      }),
    ).toBe(true);
  });

  it('falls back to GBP when the account id is unknown', () => {
    expect(
      doAmountsAndDatesMatchForAccounts({
        expenseAccount: 'some-legacy-account',
        expenseAmount: -250,
        expenseDate: '2026-03-01',
        incomeAccount: 'barclays-current',
        incomeAmount: 250,
        incomeDate: '2026-03-01',
      }),
    ).toBe(true);
  });
});

describe('findInterCompanyPairs — DB integration', () => {
  let harness: TestDbHandles;

  beforeAll(() => {
    harness = createInMemoryTestDb();
  });

  afterAll(() => {
    harness.cleanup();
  });

  beforeEach(() => {
    resetTestData(harness.db);
  });

  it('returns a single inter-company pair (UK expense → UAE income)', () => {
    const gbp = 1000;
    const aed = gbp * getRateSync('GBP', 'AED');
    insertTxn(harness.db, {
      hash: 'h-expense',
      date: '2026-03-01',
      description: 'WISE GBP TRANSFER OUT',
      amount: -gbp,
      account: 'barclays-current',
      type: 'expense',
    });
    insertTxn(harness.db, {
      hash: 'h-income',
      date: '2026-03-02',
      description: 'Wise deposit',
      amount: aed,
      account: 'emirates-islamic',
      type: 'income',
    });

    const pairs = findInterCompanyPairs(harness.db);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].expense.hash).toBe('h-expense');
    expect(pairs[0].income.hash).toBe('h-income');
    expect(pairs[0].expense.entityId).toBe('autonize-it-ltd');
    expect(pairs[0].income.entityId).toBe('autonize-it-fzco');
  });

  it('rejects pairs that sit on the same entity', () => {
    insertTxn(harness.db, {
      hash: 'h-expense',
      date: '2026-03-01',
      description: 'Barclays → Barclays savings',
      amount: -500,
      account: 'barclays-current',
      type: 'expense',
    });
    insertTxn(harness.db, {
      hash: 'h-income',
      date: '2026-03-01',
      description: 'Barclays savings deposit',
      amount: 500,
      account: 'barclays-savings',
      type: 'income',
    });

    expect(findInterCompanyPairs(harness.db)).toHaveLength(0);
  });

  it('rejects personal-account sides even when entity ids differ', () => {
    const gbp = 400;
    const aed = gbp * getRateSync('GBP', 'AED');
    insertTxn(harness.db, {
      hash: 'h-expense',
      date: '2026-03-01',
      description: 'Personal NatWest → Emirates Islamic',
      amount: -gbp,
      account: 'natwest',
      type: 'expense',
    });
    insertTxn(harness.db, {
      hash: 'h-income',
      date: '2026-03-01',
      description: 'Emirates Islamic deposit',
      amount: aed,
      account: 'emirates-islamic',
      type: 'income',
    });

    expect(findInterCompanyPairs(harness.db)).toHaveLength(0);
  });

  it('skips transactions already marked as transfers (linked within-entity pairs)', () => {
    const gbp = 750;
    const aed = gbp * getRateSync('GBP', 'AED');
    const expenseId = insertTxn(harness.db, {
      hash: 'h-expense',
      date: '2026-03-01',
      description: 'WISE',
      amount: -gbp,
      account: 'barclays-current',
      type: 'expense',
      linkedTransactionId: 999,
    });
    insertTxn(harness.db, {
      hash: 'h-income',
      date: '2026-03-02',
      description: 'Wise deposit',
      amount: aed,
      account: 'emirates-islamic',
      type: 'income',
      linkedTransactionId: expenseId,
    });

    expect(findInterCompanyPairs(harness.db)).toHaveLength(0);
  });

  it('ignores pairs whose amount/date calibration is out of tolerance', () => {
    const gbp = 1000;
    const aedMismatched = gbp * getRateSync('GBP', 'AED') * 0.5;
    insertTxn(harness.db, {
      hash: 'h-expense',
      date: '2026-03-01',
      description: 'WISE',
      amount: -gbp,
      account: 'barclays-current',
      type: 'expense',
    });
    insertTxn(harness.db, {
      hash: 'h-income',
      date: '2026-03-02',
      description: 'Unrelated FZCO deposit',
      amount: aedMismatched,
      account: 'emirates-islamic',
      type: 'income',
    });

    expect(findInterCompanyPairs(harness.db)).toHaveLength(0);
  });
});
