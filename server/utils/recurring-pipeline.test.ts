import { describe, it, expect } from 'vitest';
import {
  buildRecurringPipeline,
  accKey,
  recurringKey,
  type RawTransaction,
} from './recurring-pipeline.js';
import type { RecurringExpense } from '../../shared/api-contracts.js';

function makeTxn(overrides: Partial<RawTransaction> & { date: string; description: string; amount: number }): RawTransaction {
  return {
    id: Math.floor(Math.random() * 100000),
    account: 'barclays-current',
    type: 'expense',
    ...overrides,
  };
}

function monthlyExpenseTxns(
  description: string,
  amount: number,
  months: number,
  account = 'barclays-current',
): RawTransaction[] {
  const txns: RawTransaction[] = [];
  for (let i = 0; i < months; i++) {
    const m = 12 - i;
    const year = m > 0 ? 2025 : 2024;
    const month = ((m - 1 + 12) % 12) + 1;
    txns.push(makeTxn({
      date: `${year}-${String(month).padStart(2, '0')}-15`,
      description,
      amount: -amount,
      account,
    }));
  }
  return txns;
}

describe('accKey', () => {
  it('produces distinct keys for different amounts', () => {
    const k1 = accKey('Debt', 'BPF', 'barclays', 97);
    const k2 = accKey('Debt', 'BPF', 'barclays', 143);
    expect(k1).not.toBe(k2);
  });

  it('groups same amount (sub-pound)', () => {
    const k1 = accKey('Utilities', 'SP', 'barclays', 85.2);
    const k2 = accKey('Utilities', 'SP', 'barclays', 85.4);
    expect(k1).toBe(k2);
  });
});

describe('recurringKey', () => {
  it('round-trips with accKey for the same item', () => {
    const item: RecurringExpense = {
      merchant: 'Netflix',
      category: 'Entertainment',
      amount: 15.99,
      frequency: 'monthly',
      sourceAccount: 'barclays-current',
      billingDay: '5th',
      colour: '#A855F7',
      monthsActive: 12,
      annualTotal: 191.88,
      logoUrl: null,
    };
    const expected = accKey('Entertainment', 'Netflix', 'barclays-current', 15.99);
    expect(recurringKey(item)).toBe(expected);
  });
});

describe('buildRecurringPipeline', () => {
  it('returns empty results when given no transactions', () => {
    const result = buildRecurringPipeline({
      scopedTransactions: [],
      allTimeTransactions: [],
      includeIncome: true,
    });
    expect(result.monthlyExpenseRecurring).toHaveLength(0);
    expect(result.monthlyIncomeRecurring).toHaveLength(0);
    expect(result.monthsCovered).toBe(1);
  });

  it('skips transfers categorised as Transfers', () => {
    const txns = monthlyExpenseTxns('DAVID MORRISON', 500, 10);
    const result = buildRecurringPipeline({
      scopedTransactions: txns,
      allTimeTransactions: txns,
      includeIncome: false,
    });
    expect(result.expenseCandidates).toHaveLength(0);
  });

  it('skips income when includeIncome is false', () => {
    const incomeTxns: RawTransaction[] = [];
    for (let i = 0; i < 10; i++) {
      incomeTxns.push(makeTxn({
        date: `2025-${String(i + 1).padStart(2, '0')}-28`,
        description: 'SALARY FROM EMPLOYER',
        amount: 3000,
        type: 'income',
      }));
    }
    const result = buildRecurringPipeline({
      scopedTransactions: incomeTxns,
      allTimeTransactions: incomeTxns,
      includeIncome: false,
    });
    expect(result.incomeCandidates).toHaveLength(0);
  });

  it('includes income when includeIncome is true', () => {
    const incomeTxns: RawTransaction[] = [];
    for (let i = 0; i < 10; i++) {
      incomeTxns.push(makeTxn({
        date: `2025-${String(i + 1).padStart(2, '0')}-28`,
        description: 'SALARY FROM EMPLOYER',
        amount: 3000,
        type: 'income',
      }));
    }
    const result = buildRecurringPipeline({
      scopedTransactions: incomeTxns,
      allTimeTransactions: incomeTxns,
      includeIncome: true,
    });
    expect(result.incomeCandidates.length).toBeGreaterThan(0);
  });

  it('filters out pass-through IDs', () => {
    const txns = monthlyExpenseTxns('SCOTTISH POWER', 85, 10);
    const passThroughIds = new Set(txns.map(t => t.id));
    const result = buildRecurringPipeline({
      scopedTransactions: txns,
      allTimeTransactions: txns,
      passThroughIds,
      includeIncome: false,
    });
    expect(result.expenseCandidates).toHaveLength(0);
  });

  it('keeps two payments to the same merchant at different amounts as separate accumulators', () => {
    const txns1 = monthlyExpenseTxns('BARCLAYS PARTNER FINANCE', 97.5, 10);
    const txns2 = monthlyExpenseTxns('BARCLAYS PARTNER FINANCE', 143.2, 10);
    const all = [...txns1, ...txns2];
    const result = buildRecurringPipeline({
      scopedTransactions: all,
      allTimeTransactions: all,
      includeIncome: false,
    });
    const bpfAccumulators = [...result.expenseAccumulators.values()].filter(
      a => a.merchant.includes('Barclays Partner'),
    );
    expect(bpfAccumulators.length).toBe(2);
  });

  it('attaches all-time transactions to accumulators built from scoped pass', () => {
    const scoped = monthlyExpenseTxns('SCOTTISH POWER', 85, 6);
    const historical = monthlyExpenseTxns('SCOTTISH POWER', 85, 24);
    const result = buildRecurringPipeline({
      scopedTransactions: scoped,
      allTimeTransactions: historical,
      includeIncome: false,
    });
    const acc = [...result.expenseAccumulators.values()].find(
      a => a.merchant.includes('Scottish Power'),
    );
    expect(acc).toBeDefined();
    expect(acc!.transactions.length).toBeGreaterThanOrEqual(scoped.length);
  });

  it('correctly counts monthsCovered from scoped transactions', () => {
    const txns = monthlyExpenseTxns('SCOTTISH POWER', 85, 5);
    const result = buildRecurringPipeline({
      scopedTransactions: txns,
      allTimeTransactions: txns,
      includeIncome: false,
    });
    expect(result.monthsCovered).toBe(5);
  });
});
