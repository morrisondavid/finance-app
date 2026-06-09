import { describe, it, expect } from 'vitest';
import {
  deriveCategorySpendSurgeWarnings,
  deriveDiscretionaryBurnWarnings,
  CATEGORY_SURGE_30D_FLOOR_GBP,
  CATEGORY_SURGE_30D_CRITICAL_FLOOR_GBP,
  DISCRETIONARY_BURN_30D_FLOOR_GBP,
} from './discretionary-spend.js';
import type { RawTransaction, PipelineResult } from '../../utils/recurring-pipeline.js';
import type { RecurringExpense } from '../../../shared/api-contracts.js';
import type { Debt } from '../../db/repositories/debts.js';
import { shiftIsoDate } from '../../../shared/iso-date.js';

const today = '2026-06-10';

let txnId = 1;
function tx(
  date: string,
  amount: number,
  description: string,
  account = 'natwest',
): RawTransaction {
  return { id: txnId++, date, amount, description, account, type: 'expense' };
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

/** Emirates airline-shaped lines (budgetable Travel). */
function emiratesTx(date: string, amount: number): RawTransaction {
  return tx(date, amount, 'EMIRATES AIRLINE', 'natwest');
}

function baselineTravelMonths(monthlyAmount: number, count: number): RawTransaction[] {
  const out: RawTransaction[] = [];
  for (let i = 0; i < count; i++) {
    const d = shiftIsoDate(today, -(120 + i * 30));
    out.push(emiratesTx(d, -monthlyAmount));
  }
  return out;
}

describe('deriveCategorySpendSurgeWarnings', () => {
  it('does not emit when below floor and no baseline surge', () => {
    const out = deriveCategorySpendSurgeWarnings({
      today,
      expenseTransactions: [emiratesTx(shiftIsoDate(today, -5), -100)],
      pipeline: emptyPipeline(),
      budgetedCategories: new Set(),
    });
    expect(out).toHaveLength(0);
  });

  it('warns when rolling30d >= floor', () => {
    const txns = Array.from({ length: 5 }, (_, i) =>
      emiratesTx(shiftIsoDate(today, -(i + 1)), -200),
    );
    const out = deriveCategorySpendSurgeWarnings({
      today,
      expenseTransactions: txns,
      pipeline: emptyPipeline(),
      budgetedCategories: new Set(),
    });
    expect(out).toHaveLength(1);
    expect(out[0].code).toBe('category-spend-surge');
    expect(out[0].severity).toBe('warn');
    expect(out[0].context?.category).toBe('Travel');
  });

  it('warns when >= 1.5x baseline with >= 3 baseline months', () => {
    const baseline = baselineTravelMonths(100, 4);
    const recent = Array.from({ length: 4 }, (_, i) =>
      emiratesTx(shiftIsoDate(today, -(i + 1)), -200),
    );
    const out = deriveCategorySpendSurgeWarnings({
      today,
      expenseTransactions: [...baseline, ...recent],
      pipeline: emptyPipeline(),
      budgetedCategories: new Set(),
    });
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe('warn');
  });

  it('critical when >= floor critical and >= 2x baseline', () => {
    const baseline = baselineTravelMonths(200, 4);
    const recent = Array.from({ length: 8 }, (_, i) =>
      emiratesTx(shiftIsoDate(today, -(i + 1)), -400),
    );
    const out = deriveCategorySpendSurgeWarnings({
      today,
      expenseTransactions: [...baseline, ...recent],
      pipeline: emptyPipeline(),
      budgetedCategories: new Set(),
    });
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe('critical');
    expect(out[0].context?.rolling30d).toBeGreaterThanOrEqual(CATEGORY_SURGE_30D_CRITICAL_FLOOR_GBP);
  });

  it('suppresses budgeted categories', () => {
    const txns = Array.from({ length: 5 }, (_, i) =>
      emiratesTx(shiftIsoDate(today, -(i + 1)), -200),
    );
    const out = deriveCategorySpendSurgeWarnings({
      today,
      expenseTransactions: txns,
      pipeline: emptyPipeline(),
      budgetedCategories: new Set(['Travel']),
    });
    expect(out).toHaveLength(0);
  });

  it('excludes active-debt transactions', () => {
    const out = deriveCategorySpendSurgeWarnings({
      today,
      expenseTransactions: [
        tx(shiftIsoDate(today, -1), -390.71, 'MYSTERY LENDER REPAYMENT', 'natwest'),
      ],
      pipeline: emptyPipeline(),
      budgetedCategories: new Set(),
      activeDebts: [activeDebt],
    });
    expect(out).toHaveLength(0);
  });

  it('excludes surfaced recurring expenses', () => {
    const out = deriveCategorySpendSurgeWarnings({
      today,
      expenseTransactions: [tx(shiftIsoDate(today, -1), -15.99, 'NETFLIX.COM')],
      pipeline: emptyPipeline({ monthlyExpenseRecurring: [netflixRecurring] }),
      budgetedCategories: new Set(),
    });
    expect(out).toHaveLength(0);
  });

  it('excludes non-budgetable categories (Housing)', () => {
    const out = deriveCategorySpendSurgeWarnings({
      today,
      expenseTransactions: [
        tx(shiftIsoDate(today, -1), -2221.63, 'COVENTRY BS DDR', 'monzo-joint'),
      ],
      pipeline: emptyPipeline(),
      budgetedCategories: new Set(),
    });
    expect(out).toHaveLength(0);
  });

  it('baseline excludes recent 90d so surge in recent window still fires', () => {
    const lowBaseline = baselineTravelMonths(50, 4);
    const recentSurge = Array.from({ length: 4 }, (_, i) =>
      emiratesTx(shiftIsoDate(today, -(10 + i)), -250),
    );
    const out = deriveCategorySpendSurgeWarnings({
      today,
      expenseTransactions: [...lowBaseline, ...recentSurge],
      pipeline: emptyPipeline(),
      budgetedCategories: new Set(),
    });
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(out[0].context?.baselineAvailable).toBe(true);
  });

  it('high older baseline prevents multiple-based fire (floor may still apply)', () => {
    const highBaseline = baselineTravelMonths(500, 4);
    const modestRecent = [emiratesTx(shiftIsoDate(today, -5), -600)];
    const out = deriveCategorySpendSurgeWarnings({
      today,
      expenseTransactions: [...highBaseline, ...modestRecent],
      pipeline: emptyPipeline(),
      budgetedCategories: new Set(),
    });
    const ratio = out[0]?.context?.ratioToBaseline;
    if (out.length > 0 && ratio !== null && ratio !== undefined) {
      expect(ratio).toBeLessThan(1.5);
    }
  });
});

describe('deriveDiscretionaryBurnWarnings', () => {
  it('warns when total unbudgeted spend >= floor', () => {
    const travel = Array.from({ length: 6 }, (_, i) =>
      emiratesTx(shiftIsoDate(today, -(i + 1)), -400),
    );
    const eating = Array.from({ length: 4 }, (_, i) =>
      tx(shiftIsoDate(today, -(i + 1)), -100, 'JUST EAT ORDER'),
    );
    const out = deriveDiscretionaryBurnWarnings({
      today,
      expenseTransactions: [...travel, ...eating],
      pipeline: emptyPipeline(),
      budgetedCategories: new Set(),
    });
    expect(out).toHaveLength(1);
    expect(out[0].code).toBe('discretionary-burn-elevated');
    expect(out[0].severity).toBe('warn');
    expect(out[0].context?.total30d).toBeGreaterThanOrEqual(DISCRETIONARY_BURN_30D_FLOOR_GBP);
  });

  it('warns when >= 1.3x household baseline', () => {
    const baselineTravel = baselineTravelMonths(300, 4);
    const baselineEating = Array.from({ length: 4 }, (_, i) =>
      tx(shiftIsoDate(today, -(120 + i * 30)), -50, 'JUST EAT ORDER'),
    );
    const recentTravel = Array.from({ length: 3 }, (_, i) =>
      emiratesTx(shiftIsoDate(today, -(i + 1)), -500),
    );
    const recentEating = Array.from({ length: 3 }, (_, i) =>
      tx(shiftIsoDate(today, -(i + 1)), -200, 'JUST EAT ORDER'),
    );
    const out = deriveDiscretionaryBurnWarnings({
      today,
      expenseTransactions: [...baselineTravel, ...baselineEating, ...recentTravel, ...recentEating],
      pipeline: emptyPipeline(),
      budgetedCategories: new Set(),
    });
    expect(out).toHaveLength(1);
    expect(out[0].context?.ratioToBaseline).toBeGreaterThanOrEqual(1.3);
  });

  it('critical when >= 1.75x baseline', () => {
    const baselineTravel = baselineTravelMonths(200, 4);
    const recentTravel = Array.from({ length: 6 }, (_, i) =>
      emiratesTx(shiftIsoDate(today, -(i + 1)), -800),
    );
    const out = deriveDiscretionaryBurnWarnings({
      today,
      expenseTransactions: [...baselineTravel, ...recentTravel],
      pipeline: emptyPipeline(),
      budgetedCategories: new Set(),
    });
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe('critical');
  });

  it('excludes budgeted categories from the total', () => {
    const travel = Array.from({ length: 6 }, (_, i) =>
      emiratesTx(shiftIsoDate(today, -(i + 1)), -400),
    );
    const eating = Array.from({ length: 4 }, (_, i) =>
      tx(shiftIsoDate(today, -(i + 1)), -50, 'JUST EAT ORDER'),
    );
    const out = deriveDiscretionaryBurnWarnings({
      today,
      expenseTransactions: [...travel, ...eating],
      pipeline: emptyPipeline(),
      budgetedCategories: new Set(['Travel']),
    });
    const total = out[0]?.context?.total30d;
    if (total !== undefined) {
      expect(total).toBeLessThan(DISCRETIONARY_BURN_30D_FLOOR_GBP);
    }
  });

  it('reports unbudgeted category count in context and action', () => {
    const travel = Array.from({ length: 6 }, (_, i) =>
      emiratesTx(shiftIsoDate(today, -(i + 1)), -400),
    );
    const eating = Array.from({ length: 4 }, (_, i) =>
      tx(shiftIsoDate(today, -(i + 1)), -100, 'JUST EAT ORDER'),
    );
    const out = deriveDiscretionaryBurnWarnings({
      today,
      expenseTransactions: [...travel, ...eating],
      pipeline: emptyPipeline(),
      budgetedCategories: new Set(),
    });
    expect(out[0].context?.unbudgetedCategoryCount).toBeGreaterThanOrEqual(2);
    expect(out[0].recommended_action).toMatch(/no budget/i);
  });

  it('returns nothing when no discretionary spend', () => {
    const out = deriveDiscretionaryBurnWarnings({
      today,
      expenseTransactions: [],
      pipeline: emptyPipeline(),
      budgetedCategories: new Set(),
    });
    expect(out).toHaveLength(0);
  });
});

describe('threshold constants', () => {
  it('exports named floors for tuning', () => {
    expect(CATEGORY_SURGE_30D_FLOOR_GBP).toBe(750);
    expect(CATEGORY_SURGE_30D_CRITICAL_FLOOR_GBP).toBe(1500);
    expect(DISCRETIONARY_BURN_30D_FLOOR_GBP).toBe(2000);
  });
});
