import { describe, it, expect } from 'vitest';
import { computeAdHocExpenseGroups } from './ad-hoc-expenses.js';
import {
  accumulationFromTxn,
  recurringKey,
  type PipelineResult,
  type RawTransaction,
} from './recurring-pipeline.js';
import type { RecurringExpense } from '../../shared/api-contracts.js';
import type { AccountName } from '../types.js';

function emptyPipeline(): PipelineResult {
  return {
    expenseCandidates: [],
    incomeCandidates: [],
    expenseAccumulators: new Map(),
    incomeAccumulators: new Map(),
    monthlyExpenseRecurring: [],
    annualExpenseRecurring: [],
    monthlyIncomeRecurring: [],
    annualIncomeRecurring: [],
    monthsCovered: 24,
  };
}

describe('computeAdHocExpenseGroups', () => {
  const account: AccountName = 'natwest';

  it('aggregates same bucket and respects minTotal', () => {
    const expenseTransactions: RawTransaction[] = [
      { id: 1, date: '2024-01-05', description: '14APR A/C', amount: -150, account, type: 'expense' },
      { id: 2, date: '2024-02-05', description: '14APR A/C', amount: -160, account, type: 'expense' },
    ];
    const rows = computeAdHocExpenseGroups({
      pipeline: emptyPipeline(),
      account,
      expenseTransactions,
      minTotal: 300,
      limit: 25,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].total).toBe(310);
    expect(rows[0].count).toBe(2);
    expect(rows[0].lastDate).toBe('2024-02-05');
  });

  it('drops groups below minTotal', () => {
    const expenseTransactions: RawTransaction[] = [
      { id: 1, date: '2024-01-05', description: '14APR A/C', amount: -150, account, type: 'expense' },
      { id: 2, date: '2024-02-05', description: '14APR A/C', amount: -160, account, type: 'expense' },
    ];
    const rows = computeAdHocExpenseGroups({
      pipeline: emptyPipeline(),
      account,
      expenseTransactions,
      minTotal: 400,
      limit: 25,
    });
    expect(rows).toHaveLength(0);
  });

  it('caps rows by limit sorted by lastDate desc then total', () => {
    const expenseTransactions: RawTransaction[] = [
      { id: 1, date: '2024-01-01', description: 'SANTANDERCARDS LTD', amount: -300, account, type: 'expense' },
      { id: 2, date: '2024-01-02', description: 'MBNA LIMITED', amount: -200, account, type: 'expense' },
      { id: 3, date: '2024-01-03', description: 'FUNDING CIRCLE', amount: -100, account, type: 'expense' },
    ];
    const rows = computeAdHocExpenseGroups({
      pipeline: emptyPipeline(),
      account,
      expenseTransactions,
      minTotal: 50,
      limit: 2,
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].lastDate).toBe('2024-01-03');
    expect(rows[0].total).toBe(100);
    expect(rows[1].lastDate).toBe('2024-01-02');
    expect(rows[1].total).toBe(200);
  });

  it('excludes transactions whose bucket matches a surfaced monthly recurring', () => {
    const txn: RawTransaction = {
      id: 1,
      date: '2024-01-01',
      description: 'SANTANDERCARDS LTD',
      amount: -120,
      account,
      type: 'expense',
    };
    const bucket = accumulationFromTxn(txn, 'expense');
    if (bucket === null) {
      throw new Error('expected accumulation bucket for test txn');
    }

    const recurring: RecurringExpense = {
      merchant: bucket.displayMerchant,
      category: bucket.category,
      colour: '#000000',
      amount: 120,
      frequency: 'monthly',
      monthsActive: 12,
      annualTotal: 1440,
      logoUrl: null,
      sourceAccount: account,
      billingDay: null,
    };
    expect(recurringKey(recurring)).toBe(bucket.key);

    const pipeline = emptyPipeline();
    pipeline.monthlyExpenseRecurring = [recurring];

    const rows = computeAdHocExpenseGroups({
      pipeline,
      account,
      expenseTransactions: [txn],
      minTotal: 1,
      limit: 25,
    });
    expect(rows).toHaveLength(0);
  });
});
