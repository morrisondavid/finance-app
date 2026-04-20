import { describe, it, expect } from 'vitest';
import {
  predictNextChargeDate,
  resolveLastChargeDate,
  buildUpcomingRecurring,
} from './recurring-upcoming.js';
import { recurringKey } from './recurring-pipeline.js';
import type { PipelineResult, Accumulator } from './recurring-pipeline.js';
import type { RecurringExpense } from '../../shared/api-contracts.js';

// Use UTC noon dates so that `today.getUTCFullYear()` / `getUTCMonth()` match the
// calendar-day intention regardless of local timezone offsets in the test runner.
const apr16_2026 = new Date('2026-04-16T12:00:00Z');
const nov15_2026 = new Date('2026-11-15T12:00:00Z');

function makeExpense(partial: Partial<RecurringExpense> = {}): RecurringExpense {
  return {
    merchant: 'Netflix',
    category: 'Subscriptions',
    colour: '#ff0000',
    amount: 10,
    frequency: 'monthly',
    monthsActive: 12,
    annualTotal: 120,
    logoUrl: null,
    sourceAccount: 'barclays-current',
    billingDayOfMonth: 20,
    billingMonth: null,
    ...partial,
  };
}

describe('predictNextChargeDate — monthly', () => {
  it('returns this month when billing day is still ahead of today', () => {
    const result = predictNextChargeDate('monthly', 20, null, apr16_2026, null);
    expect(result).toBe('2026-04-20');
  });

  it('returns next month when billing day has already passed this month', () => {
    const result = predictNextChargeDate('monthly', 5, null, apr16_2026, null);
    expect(result).toBe('2026-05-05');
  });

  it('skips (returns null) when lastChargeDate is in the current calendar month', () => {
    const result = predictNextChargeDate('monthly', 20, null, apr16_2026, '2026-04-05');
    expect(result).toBeNull();
  });

  it('does not skip when lastChargeDate was in a previous calendar month', () => {
    const result = predictNextChargeDate('monthly', 5, null, apr16_2026, '2026-03-28');
    expect(result).toBe('2026-05-05');
  });

  it('returns null when billingDayOfMonth is missing', () => {
    const result = predictNextChargeDate('monthly', null, null, apr16_2026, null);
    expect(result).toBeNull();
  });
});

describe('predictNextChargeDate — annual', () => {
  it('returns this year when billing month is still ahead', () => {
    const result = predictNextChargeDate('annual', 15, 6, apr16_2026, null);
    expect(result).toBe('2026-06-15');
  });

  it('returns next year when billing month has already passed', () => {
    const result = predictNextChargeDate('annual', 1, 2, apr16_2026, null);
    expect(result).toBe('2027-02-01');
  });

  it('skips when last charge was within the previous 365 days', () => {
    const lastCharge = '2026-02-15'; // 60 days before Apr 16 2026
    const result = predictNextChargeDate('annual', 15, 6, apr16_2026, lastCharge);
    expect(result).toBeNull();
  });

  it('does not skip when last charge was more than 365 days ago', () => {
    const lastCharge = '2025-03-01'; // ~410 days before Apr 16 2026
    const result = predictNextChargeDate('annual', 15, 6, apr16_2026, lastCharge);
    expect(result).toBe('2026-06-15');
  });

  it('returns null when billingMonth is missing', () => {
    const result = predictNextChargeDate('annual', 15, null, apr16_2026, null);
    expect(result).toBeNull();
  });

  it('returns null when billingDayOfMonth is missing', () => {
    const result = predictNextChargeDate('annual', null, 6, apr16_2026, null);
    expect(result).toBeNull();
  });
});

describe('resolveLastChargeDate', () => {
  it('returns the max date from accumulator transactions', () => {
    const expense = makeExpense();
    const acc: Accumulator = {
      merchant: 'Netflix',
      category: 'Entertainment',
      sourceAccount: 'barclays-current',
      accountCategory: 'business',
      monthlyTotals: new Map(),
      annualTotal: 0,
      transactions: [
        { date: '2025-12-20', amount: 10 },
        { date: '2026-02-20', amount: 10 },
        { date: '2026-01-20', amount: 10 },
      ],
    };
    const map = new Map<string, Accumulator>();
    map.set(recurringKey(expense), acc);

    const result = resolveLastChargeDate(expense, map);
    expect(result).toBe('2026-02-20');
  });

  it('returns null when accumulator has no transactions', () => {
    const expense = makeExpense();
    const map = new Map<string, Accumulator>();
    map.set(recurringKey(expense), {
      merchant: 'Netflix',
      category: 'Entertainment',
      sourceAccount: 'barclays-current',
      accountCategory: 'business',
      monthlyTotals: new Map(),
      annualTotal: 0,
      transactions: [],
    });
    expect(resolveLastChargeDate(expense, map)).toBeNull();
  });

  it('returns null when no accumulator exists for the expense key', () => {
    const expense = makeExpense();
    const map = new Map<string, Accumulator>();
    expect(resolveLastChargeDate(expense, map)).toBeNull();
  });
});

describe('buildUpcomingRecurring', () => {
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
      monthsCovered: 12,
    };
  }

  it('splits items into thisMonth / thisYear correctly', () => {
    const pipeline = emptyPipeline();
    // Monthly: Netflix billed on the 20th → 2026-04-20 (this month)
    pipeline.monthlyExpenseRecurring = [makeExpense({ merchant: 'Netflix', billingDayOfMonth: 20 })];
    // Annual: Insurance billed Jun 15 → 2026-06-15 (this year, not this month)
    pipeline.annualExpenseRecurring = [
      makeExpense({
        merchant: 'Insurance',
        frequency: 'annual',
        billingDayOfMonth: 15,
        billingMonth: 6,
        amount: 500,
      }),
    ];

    const buckets = buildUpcomingRecurring(pipeline, apr16_2026);
    expect(buckets.thisMonth.map(i => i.merchant)).toEqual(['Netflix']);
    expect(buckets.thisYear.map(i => i.merchant)).toEqual(['Insurance']);
  });

  it('excludes items whose predicted next date is null (already paid this period)', () => {
    const pipeline = emptyPipeline();
    const expense = makeExpense({ merchant: 'Netflix', billingDayOfMonth: 20 });
    pipeline.monthlyExpenseRecurring = [expense];
    // Attach a last-charge transaction in April 2026 to trigger the skip
    pipeline.expenseAccumulators.set(recurringKey(expense), {
      merchant: 'Netflix',
      category: 'Entertainment',
      sourceAccount: 'barclays-current',
      accountCategory: 'business',
      monthlyTotals: new Map(),
      annualTotal: 0,
      transactions: [{ date: '2026-04-05', amount: 10 }],
    });

    const buckets = buildUpcomingRecurring(pipeline, apr16_2026);
    expect(buckets.thisMonth).toHaveLength(0);
    expect(buckets.thisYear).toHaveLength(0);
  });

  it('only places annual items in the thisYear bucket (not monthly items)', () => {
    const pipeline = emptyPipeline();
    pipeline.monthlyExpenseRecurring = [
      makeExpense({ merchant: 'Netflix', billingDayOfMonth: 20 }),
    ];
    const buckets = buildUpcomingRecurring(pipeline, apr16_2026);
    expect(buckets.thisYear).toHaveLength(0);
  });

  it('sorts each bucket ascending by nextExpectedDate', () => {
    const pipeline = emptyPipeline();
    pipeline.monthlyExpenseRecurring = [
      makeExpense({ merchant: 'B', billingDayOfMonth: 28 }),
      makeExpense({ merchant: 'A', billingDayOfMonth: 18 }),
      makeExpense({ merchant: 'C', billingDayOfMonth: 22 }),
    ];
    const buckets = buildUpcomingRecurring(pipeline, apr16_2026);
    expect(buckets.thisMonth.map(i => i.merchant)).toEqual(['A', 'C', 'B']);
  });

  it('includes an annual item in thisMonth when its predicted date lands in the current month', () => {
    const pipeline = emptyPipeline();
    // In Nov 2026, an annual item billed Nov 30 → 2026-11-30 is in the current month AND this year
    pipeline.annualExpenseRecurring = [
      makeExpense({
        merchant: 'Annual Tax Filing',
        frequency: 'annual',
        billingDayOfMonth: 30,
        billingMonth: 11,
        amount: 200,
      }),
    ];
    const buckets = buildUpcomingRecurring(pipeline, nov15_2026);
    expect(buckets.thisMonth.map(i => i.merchant)).toEqual(['Annual Tax Filing']);
    expect(buckets.thisYear.map(i => i.merchant)).toEqual(['Annual Tax Filing']);
  });
});
