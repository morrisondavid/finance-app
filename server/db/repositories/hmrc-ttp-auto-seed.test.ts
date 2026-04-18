import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { PipelineResult, Accumulator } from '../../utils/recurring-pipeline.js';
import type { RecurringExpense } from '../../../shared/api-contracts.js';

/**
 * HMRC Time-To-Pay auto-seed integration tests.
 *
 * The seeder is a thin bridge between the shared recurring-expense
 * pipeline and the obligations table. The pipeline itself is tested
 * elsewhere (recurring-pipeline.test.ts); here we fake its output so we
 * can drive the seeder with a deterministic "HMRC recurring" group and
 * assert the emitted obligation rows.
 */

const tmpObligationsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ttp-auto-seed-test-'));

let testDb: Database.Database;

vi.mock('../connection.js', () => ({
  getDb: () => testDb,
  OBLIGATIONS_DIR: tmpObligationsDir,
}));

// Controllable pipeline output. Each test sets `pipelineOutput` before
// calling the seeder.
let pipelineOutput: PipelineResult;
vi.mock('../../utils/expenses-overview-pipeline.js', () => ({
  runExpensesOverviewPipeline: (): PipelineResult => pipelineOutput,
}));

const { deriveAndInsertAutoTtpObligations } = await import('./hmrc-ttp-auto-seed.js');
const { addDismissal } = await import('./obligation-dismissals.js');
const { recurringKey } = await import('../../utils/recurring-pipeline.js');

function createSchema(): void {
  testDb.exec(`
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
      person_id TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS obligation_dismissals (
      obligation_id TEXT PRIMARY KEY,
      reason TEXT,
      dismissed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

/**
 * Build a synthetic pipeline result with a single HMRC recurring
 * accumulator. `transactions` drives both the historical `paid` rows
 * and (via `resolveLastChargeDate`) the next-cycle prediction.
 */
function makePipelineOutput(opts: {
  merchant?: string;
  sourceAccount?: string;
  amount: number;
  billingDayOfMonth: number | null;
  transactions: { date: string; amount: number }[];
}): PipelineResult {
  const expense: RecurringExpense = {
    merchant: opts.merchant ?? 'HMRC',
    category: 'Tax',
    colour: '#000',
    amount: opts.amount,
    frequency: 'monthly',
    monthsActive: opts.transactions.length,
    annualTotal: opts.amount * 12,
    logoUrl: null,
    sourceAccount: opts.sourceAccount ?? 'barclays-current',
    billingDayOfMonth: opts.billingDayOfMonth,
    billingMonth: null,
  };
  const acc: Accumulator = {
    merchant: expense.merchant,
    category: 'Tax',
    sourceAccount: expense.sourceAccount,
    accountCategory: 'business',
    monthlyTotals: new Map(),
    annualTotal: opts.transactions.reduce((s, t) => s + t.amount, 0),
    transactions: opts.transactions,
  };
  const acc2 = new Map<string, Accumulator>();
  acc2.set(recurringKey(expense), acc);

  return {
    expenseCandidates: [],
    incomeCandidates: [],
    expenseAccumulators: acc2,
    incomeAccumulators: new Map(),
    monthlyExpenseRecurring: [expense],
    annualExpenseRecurring: [],
    monthlyIncomeRecurring: [],
    annualIncomeRecurring: [],
    monthsCovered: opts.transactions.length,
  };
}

function emptyPipelineOutput(): PipelineResult {
  return {
    expenseCandidates: [],
    incomeCandidates: [],
    expenseAccumulators: new Map(),
    incomeAccumulators: new Map(),
    monthlyExpenseRecurring: [],
    annualExpenseRecurring: [],
    monthlyIncomeRecurring: [],
    annualIncomeRecurring: [],
    monthsCovered: 0,
  };
}

beforeAll(() => {
  testDb = new Database(':memory:');
  createSchema();
});
afterAll(() => {
  testDb.close();
  fs.rmSync(tmpObligationsDir, { recursive: true, force: true });
});
beforeEach(() => {
  testDb.exec('DELETE FROM financial_obligations');
  testDb.exec('DELETE FROM obligation_dismissals');
  pipelineOutput = emptyPipelineOutput();
  const csvPath = path.join(tmpObligationsDir, 'obligation-dismissals.csv');
  if (fs.existsSync(csvPath)) fs.unlinkSync(csvPath);
});

describe('deriveAndInsertAutoTtpObligations', () => {
  it('is a no-op when the pipeline surfaces no HMRC recurring group', () => {
    deriveAndInsertAutoTtpObligations(new Date('2025-06-15'));
    const rows = testDb.prepare(
      "SELECT * FROM financial_obligations WHERE source='auto' AND type='hmrc-ttp'"
    ).all();
    expect(rows).toHaveLength(0);
  });

  it('only processes groups whose merchant is "HMRC" (ignores other recurring expenses)', () => {
    const unrelated = makePipelineOutput({
      merchant: 'Amazon Prime',
      amount: 8.99,
      billingDayOfMonth: 10,
      transactions: [
        { date: '2025-04-10', amount: 8.99 },
        { date: '2025-05-10', amount: 8.99 },
      ],
    });
    pipelineOutput = unrelated;
    deriveAndInsertAutoTtpObligations(new Date('2025-06-15'));

    const rows = testDb.prepare(
      "SELECT * FROM financial_obligations WHERE source='auto' AND type='hmrc-ttp'"
    ).all();
    expect(rows).toHaveLength(0);
  });

  it('emits one paid obligation per historical HMRC instalment', () => {
    pipelineOutput = makePipelineOutput({
      amount: 643.69,
      billingDayOfMonth: 9,
      transactions: [
        { date: '2025-03-09', amount: 643.69 },
        { date: '2025-04-09', amount: 643.69 },
        { date: '2025-05-09', amount: 643.69 },
      ],
    });
    deriveAndInsertAutoTtpObligations(new Date('2025-05-20'));

    const paid = testDb.prepare(`
      SELECT id, status, due_date, paid_amount, paid_date, paid_from_account, expected_amount
      FROM financial_obligations
      WHERE source='auto' AND type='hmrc-ttp' AND status='paid'
      ORDER BY due_date ASC
    `).all() as Array<{
      id: string; status: string; due_date: string;
      paid_amount: number; paid_date: string; paid_from_account: string;
      expected_amount: number;
    }>;

    expect(paid).toHaveLength(3);
    expect(paid.map(r => r.due_date)).toEqual([
      '2025-03-09',
      '2025-04-09',
      '2025-05-09',
    ]);
    for (const row of paid) {
      expect(row.paid_amount).toBeCloseTo(643.69, 2);
      expect(row.paid_from_account).toBe('barclays-current');
      expect(row.expected_amount).toBeCloseTo(643.69, 2);
      expect(row.paid_date).toBe(row.due_date);
    }
  });

  it('emits a single not-yet-due obligation for the next predicted cycle', () => {
    pipelineOutput = makePipelineOutput({
      amount: 500,
      billingDayOfMonth: 9,
      transactions: [
        { date: '2025-03-09', amount: 500 },
        { date: '2025-04-09', amount: 500 },
      ],
    });
    deriveAndInsertAutoTtpObligations(new Date('2025-04-20'));

    const upcoming = testDb.prepare(`
      SELECT id, status, due_date, paid_date
      FROM financial_obligations
      WHERE source='auto' AND type='hmrc-ttp' AND status='not-yet-due'
    `).all() as Array<{ id: string; status: string; due_date: string; paid_date: string | null }>;

    expect(upcoming).toHaveLength(1);
    // Reference date 2025-04-20; last charge 2025-04-09 already billed this
    // month, so the seeder advances the reference date into May and re-asks
    // for the next unsettled cycle. The May billing day (9) has already
    // passed by the advanced reference (May 20), so the predictor rolls
    // forward to June.
    expect(upcoming[0].due_date).toBe('2025-06-09');
    expect(upcoming[0].paid_date).toBeNull();
  });

  it('predicts next cycle in the current month when no payment has landed yet this period', () => {
    pipelineOutput = makePipelineOutput({
      amount: 500,
      billingDayOfMonth: 25,
      transactions: [
        { date: '2025-03-25', amount: 500 },
        { date: '2025-04-25', amount: 500 },
      ],
    });
    // Ref date 2025-05-10 — billing day (25) still ahead in this month.
    deriveAndInsertAutoTtpObligations(new Date('2025-05-10'));

    const upcoming = testDb.prepare(`
      SELECT due_date FROM financial_obligations
      WHERE source='auto' AND type='hmrc-ttp' AND status='not-yet-due'
    `).all() as Array<{ due_date: string }>;

    expect(upcoming).toHaveLength(1);
    expect(upcoming[0].due_date).toBe('2025-05-25');
  });

  it('skips the upcoming row when billingDayOfMonth is null (cannot predict)', () => {
    pipelineOutput = makePipelineOutput({
      amount: 500,
      billingDayOfMonth: null,
      transactions: [
        { date: '2025-03-09', amount: 500 },
        { date: '2025-04-09', amount: 500 },
      ],
    });
    deriveAndInsertAutoTtpObligations(new Date('2025-05-20'));

    const upcoming = testDb.prepare(
      "SELECT id FROM financial_obligations WHERE source='auto' AND type='hmrc-ttp' AND status='not-yet-due'"
    ).all();
    const paid = testDb.prepare(
      "SELECT id FROM financial_obligations WHERE source='auto' AND type='hmrc-ttp' AND status='paid'"
    ).all();
    expect(upcoming).toHaveLength(0);
    expect(paid).toHaveLength(2);
  });

  it('dismissing a specific historical instalment suppresses only that row', () => {
    pipelineOutput = makePipelineOutput({
      amount: 500,
      billingDayOfMonth: 9,
      transactions: [
        { date: '2025-03-09', amount: 500 },
        { date: '2025-04-09', amount: 500 },
      ],
    });
    deriveAndInsertAutoTtpObligations(new Date('2025-04-20'));

    const all = testDb.prepare(
      "SELECT id FROM financial_obligations WHERE source='auto' AND type='hmrc-ttp'"
    ).all() as Array<{ id: string }>;
    const paidRow = all.find(r => r.id.endsWith('2025-03-09'));
    expect(paidRow).toBeDefined();

    addDismissal({ obligationId: paidRow!.id });
    // Reset state & rerun (seeder is idempotent via full DELETE of its rows).
    pipelineOutput = makePipelineOutput({
      amount: 500,
      billingDayOfMonth: 9,
      transactions: [
        { date: '2025-03-09', amount: 500 },
        { date: '2025-04-09', amount: 500 },
      ],
    });
    deriveAndInsertAutoTtpObligations(new Date('2025-04-20'));

    const after = testDb.prepare(
      "SELECT id FROM financial_obligations WHERE source='auto' AND type='hmrc-ttp'"
    ).all() as Array<{ id: string }>;

    expect(after.some(r => r.id === paidRow!.id)).toBe(false);
    // Other rows remain.
    expect(after.some(r => r.id.endsWith('2025-04-09'))).toBe(true);
  });

  it('rebuilds from scratch each run (deletes prior auto-ttp rows)', () => {
    pipelineOutput = makePipelineOutput({
      amount: 500,
      billingDayOfMonth: 9,
      transactions: [
        { date: '2025-03-09', amount: 500 },
        { date: '2025-04-09', amount: 500 },
      ],
    });
    deriveAndInsertAutoTtpObligations(new Date('2025-04-20'));
    const firstIds = testDb.prepare(
      "SELECT id FROM financial_obligations WHERE source='auto' AND type='hmrc-ttp'"
    ).all() as Array<{ id: string }>;

    deriveAndInsertAutoTtpObligations(new Date('2025-04-20'));
    const secondIds = testDb.prepare(
      "SELECT id FROM financial_obligations WHERE source='auto' AND type='hmrc-ttp'"
    ).all() as Array<{ id: string }>;

    expect(secondIds).toHaveLength(firstIds.length);
  });

  it('handles multiple distinct HMRC groups (e.g. two different monthly amounts)', () => {
    const aExpense: RecurringExpense = {
      merchant: 'HMRC',
      category: 'Tax',
      colour: '#000',
      amount: 643.69,
      frequency: 'monthly',
      monthsActive: 2,
      annualTotal: 1287.38,
      logoUrl: null,
      sourceAccount: 'barclays-current',
      billingDayOfMonth: 9,
      billingMonth: null,
    };
    const bExpense: RecurringExpense = {
      merchant: 'HMRC',
      category: 'Tax',
      colour: '#000',
      amount: 4192.21,
      frequency: 'monthly',
      monthsActive: 2,
      annualTotal: 8384.42,
      logoUrl: null,
      sourceAccount: 'capital-on-tap',
      billingDayOfMonth: 12,
      billingMonth: null,
    };
    const accs = new Map<string, Accumulator>();
    accs.set(recurringKey(aExpense), {
      merchant: 'HMRC', category: 'Tax', sourceAccount: 'barclays-current',
      accountCategory: 'business', monthlyTotals: new Map(), annualTotal: 1287.38,
      transactions: [
        { date: '2025-03-09', amount: 643.69 },
        { date: '2025-04-09', amount: 643.69 },
      ],
    });
    accs.set(recurringKey(bExpense), {
      merchant: 'HMRC', category: 'Tax', sourceAccount: 'capital-on-tap',
      accountCategory: 'business', monthlyTotals: new Map(), annualTotal: 8384.42,
      transactions: [
        { date: '2025-03-12', amount: 4192.21 },
        { date: '2025-04-12', amount: 4192.21 },
      ],
    });
    pipelineOutput = {
      expenseCandidates: [],
      incomeCandidates: [],
      expenseAccumulators: accs,
      incomeAccumulators: new Map(),
      monthlyExpenseRecurring: [aExpense, bExpense],
      annualExpenseRecurring: [],
      monthlyIncomeRecurring: [],
      annualIncomeRecurring: [],
      monthsCovered: 2,
    };

    deriveAndInsertAutoTtpObligations(new Date('2025-04-20'));

    const rows = testDb.prepare(`
      SELECT status, paid_from_account, expected_amount FROM financial_obligations
      WHERE source='auto' AND type='hmrc-ttp'
    `).all() as Array<{ status: string; paid_from_account: string | null; expected_amount: number }>;

    // 2 paid + 1 upcoming per group = 6 rows.
    expect(rows).toHaveLength(6);
    expect(rows.filter(r => r.paid_from_account === 'barclays-current').length).toBeGreaterThan(0);
    expect(rows.filter(r => r.expected_amount === 4192.21).length).toBeGreaterThan(0);
  });
});
