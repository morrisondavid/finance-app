import { describe, it, expect } from 'vitest';
import {
  buildRecurringExpenseKeySet,
  classifyAdHocExpense,
} from './ad-hoc-spend-classifier.js';
import type { RawTransaction, PipelineResult } from './recurring-pipeline.js';
import type { RecurringExpense } from '../../shared/api-contracts.js';
import type { Debt } from '../db/repositories/debts.js';

function txn(overrides: Partial<RawTransaction> & { id: number; description: string; amount: number }): RawTransaction {
  return {
    date: '2025-06-15',
    account: 'barclays-current',
    type: 'expense',
    ...overrides,
  };
}

function emptyPipeline(overrides?: Partial<PipelineResult>): PipelineResult {
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
    ...overrides,
  };
}

const netflixRecurring: RecurringExpense = {
  merchant: 'Netflix',
  category: 'Entertainment',
  colour: '#000',
  amount: 15.99,
  frequency: 'monthly',
  monthsActive: 12,
  annualTotal: 191.88,
  logoUrl: null,
  sourceAccount: 'barclays-current',
  billingDayOfMonth: null,
  billingMonth: null,
};

const activeDebt: Debt = {
  id: 'test-debt',
  name: 'Test',
  merchantPattern: 'MYSTERY LENDER',
  sourceAccounts: ['natwest'],
  originalLoanAmount: 10000,
  originalLoanDate: null,
  openingBalance: 5000,
  openingBalanceDate: '2024-01-01',
  archived: false,
  matchAmounts: [390.71],
  matchTolerancePct: 0,
  kind: 'consumer',
  interestRate: null,
  fixedRateEndDate: null,
  repaymentType: null,
  propertyValueEstimate: null,
  propertyId: null,
  updatedAt: '2026-01-01',
};

describe('buildRecurringExpenseKeySet', () => {
  it('collects monthly and annual recurring keys', () => {
    const annual: RecurringExpense = {
      ...netflixRecurring,
      merchant: 'Spotify',
      frequency: 'annual',
      amount: 99,
    };
    const keys = buildRecurringExpenseKeySet(
      emptyPipeline({ monthlyExpenseRecurring: [netflixRecurring], annualExpenseRecurring: [annual] }),
    );
    expect(keys.size).toBe(2);
  });
});

describe('classifyAdHocExpense', () => {
  const recurringKeys = buildRecurringExpenseKeySet(
    emptyPipeline({ monthlyExpenseRecurring: [netflixRecurring] }),
  );

  it('returns category/merchant/amount for a budgetable expense debit', () => {
    const result = classifyAdHocExpense(
      txn({ id: 1, description: 'JUST EAT ORDER', amount: -25 }),
      { recurringKeys },
    );
    expect(result).toMatchObject({
      category: 'Eating Out',
      displayMerchant: 'Just Eat',
      absAmount: 25,
    });
  });

  it('returns null for income', () => {
    expect(
      classifyAdHocExpense(
        txn({ id: 1, description: 'SALARY', amount: 3000, type: 'income' }),
        { recurringKeys },
      ),
    ).toBeNull();
  });

  it('returns null for transfer side', () => {
    expect(
      classifyAdHocExpense(
        txn({ id: 1, description: 'DAVID MORRISON TFR', amount: -500, type: 'transfer' }),
        { recurringKeys },
      ),
    ).toBeNull();
  });

  it('returns null when txn matches an active debt', () => {
    expect(
      classifyAdHocExpense(
        txn({ id: 1, description: 'MYSTERY LENDER REPAYMENT', amount: -390.71, account: 'natwest' }),
        { recurringKeys, activeDebts: [activeDebt] },
      ),
    ).toBeNull();
  });

  it('returns null when key is in recurringKeys', () => {
    expect(
      classifyAdHocExpense(
        txn({ id: 1, description: 'NETFLIX.COM', amount: -15.99 }),
        { recurringKeys },
      ),
    ).toBeNull();
  });

  it('returns null for non-budgetable categories (Housing)', () => {
    expect(
      classifyAdHocExpense(
        txn({ id: 1, description: 'COVENTRY BS DDR', amount: -2221.63, account: 'monzo-joint' }),
        { recurringKeys },
      ),
    ).toBeNull();
  });
});
