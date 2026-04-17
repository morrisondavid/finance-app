import { describe, it, expect } from 'vitest';
import { expenseTxnMatchesMerchantModal, transactionDescriptionMatchesDrillSearch } from './merchant-drill-search.js';
import { computeBudgetNudges, type BudgetNudgesInput } from './budget-nudges.js';
import type { RawTransaction, PipelineResult } from './recurring-pipeline.js';
import type { RecurringExpense } from '../../shared/api-contracts.js';

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

describe('computeBudgetNudges', () => {
  it('rolls up variable amounts per merchant into one total', () => {
    const transactions = [
      txn({ id: 1, description: 'JUST EAT ORDER', amount: -12.99 }),
      txn({ id: 2, description: 'JUST EAT ORDER', amount: -8.50 }),
      txn({ id: 3, description: 'JUST EAT ORDER', amount: -15.00 }),
    ];

    const input: BudgetNudgesInput = {
      expenseTransactions: transactions,
      pipeline: emptyPipeline(),
      budgetedCategories: new Set(),
      options: { minTotal: 0 },
    };

    const result = computeBudgetNudges(input);
    const justEat = result.find(r => r.merchant === 'Just Eat');
    expect(justEat).toBeDefined();
    expect(justEat!.totalSpend).toBeCloseTo(36.49, 2);
    expect(justEat!.transactionCount).toBe(3);
  });

  it('excludes transactions matching recurring expense keys', () => {
    const recurringEntry: RecurringExpense = {
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

    const transactions = [
      txn({ id: 1, description: 'NETFLIX.COM', amount: -15.99 }),
      txn({ id: 2, description: 'JUST EAT ORDER', amount: -25.00 }),
    ];

    const input: BudgetNudgesInput = {
      expenseTransactions: transactions,
      pipeline: emptyPipeline({ monthlyExpenseRecurring: [recurringEntry] }),
      budgetedCategories: new Set(),
      options: { minTotal: 0 },
    };

    const result = computeBudgetNudges(input);
    expect(result.find(r => r.merchant === 'Netflix')).toBeUndefined();
    expect(result.find(r => r.merchant === 'Just Eat')).toBeDefined();
  });

  it('excludes merchants when their dominant category already has a budget', () => {
    const transactions = [
      txn({ id: 1, description: 'JUST EAT ORDER', amount: -50 }),
    ];

    const input: BudgetNudgesInput = {
      expenseTransactions: transactions,
      pipeline: emptyPipeline(),
      budgetedCategories: new Set(['Eating Out']),
      options: { minTotal: 0 },
    };

    const result = computeBudgetNudges(input);
    expect(result).toHaveLength(0);
  });

  it('excludes payroll and transfer transactions', () => {
    const transactions = [
      txn({ id: 1, description: 'David Morrison', amount: -765, account: 'barclays-current' }),
      txn({ id: 2, description: 'DAVID MORRISON TFR', amount: -500, type: 'transfer' }),
    ];

    const input: BudgetNudgesInput = {
      expenseTransactions: transactions,
      pipeline: emptyPipeline(),
      budgetedCategories: new Set(),
      options: { minTotal: 0 },
    };

    const result = computeBudgetNudges(input);
    expect(result).toHaveLength(0);
  });

  it('picks the dominant category by subtotal', () => {
    const transactions = [
      txn({ id: 1, description: 'AMAZON MARKETPLACE', amount: -200 }),
      txn({ id: 2, description: 'AMAZON MARKETPLACE', amount: -50 }),
    ];

    const input: BudgetNudgesInput = {
      expenseTransactions: transactions,
      pipeline: emptyPipeline(),
      budgetedCategories: new Set(),
      options: { minTotal: 0 },
    };

    const result = computeBudgetNudges(input);
    expect(result.length).toBeGreaterThanOrEqual(1);
    const amazon = result.find(r => r.merchant === 'Amazon');
    expect(amazon).toBeDefined();
    expect(amazon!.suggestedCategory).toBeTruthy();
  });

  it('respects minTotal threshold', () => {
    const transactions = [
      txn({ id: 1, description: 'JUST EAT ORDER', amount: -10 }),
    ];

    const input: BudgetNudgesInput = {
      expenseTransactions: transactions,
      pipeline: emptyPipeline(),
      budgetedCategories: new Set(),
      options: { minTotal: 50 },
    };

    const result = computeBudgetNudges(input);
    expect(result).toHaveLength(0);
  });

  it('respects maxRows cap', () => {
    const transactions = Array.from({ length: 20 }, (_, i) => {
      const names = [
        'DELIVEROO', 'JUST EAT', 'UBER EATS', 'MCDONALDS', 'KFC',
        'NANDOS', 'GREGGS', 'STARBUCKS', 'DOMINOS', 'COSTA',
      ];
      return txn({
        id: i + 1,
        description: names[i % names.length]!,
        amount: -(100 + i * 10),
      });
    });

    const input: BudgetNudgesInput = {
      expenseTransactions: transactions,
      pipeline: emptyPipeline(),
      budgetedCategories: new Set(),
      options: { minTotal: 0, maxRows: 3 },
    };

    const result = computeBudgetNudges(input);
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it('sorts results by totalSpend descending', () => {
    const transactions = [
      txn({ id: 1, description: 'JUST EAT ORDER', amount: -100 }),
      txn({ id: 2, description: 'DELIVEROO', amount: -200 }),
    ];

    const input: BudgetNudgesInput = {
      expenseTransactions: transactions,
      pipeline: emptyPipeline(),
      budgetedCategories: new Set(),
      options: { minTotal: 0 },
    };

    const result = computeBudgetNudges(input);
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[0]!.totalSpend).toBeGreaterThanOrEqual(result[1]!.totalSpend);
  });

  it('tracks lastDate correctly', () => {
    const transactions = [
      txn({ id: 1, description: 'JUST EAT ORDER', amount: -10, date: '2025-01-01' }),
      txn({ id: 2, description: 'JUST EAT ORDER', amount: -10, date: '2025-06-15' }),
      txn({ id: 3, description: 'JUST EAT ORDER', amount: -10, date: '2025-03-10' }),
      txn({ id: 4, description: 'JUST EAT ORDER', amount: -10, date: '2025-12-25' }),
    ];

    const input: BudgetNudgesInput = {
      expenseTransactions: transactions,
      pipeline: emptyPipeline(),
      budgetedCategories: new Set(),
      options: { minTotal: 0 },
    };

    const result = computeBudgetNudges(input);
    const justEat = result.find(r => r.merchant === 'Just Eat');
    expect(justEat?.lastDate).toBe('2025-12-25');
  });

  it('excludes credit-line drawdowns (categorised as Transfers) from nudges', () => {
    const transactions = [
      txn({ id: 1, description: 'DRAW DOWN OF 1000.00 CAP ONE', amount: -1000 }),
      txn({ id: 2, description: 'DRAW DOWN OF 6000.00 CAP ONE', amount: -6000 }),
    ];

    const input: BudgetNudgesInput = {
      expenseTransactions: transactions,
      pipeline: emptyPipeline(),
      budgetedCategories: new Set(),
      options: { minTotal: 0 },
    };

    const result = computeBudgetNudges(input);
    expect(result.find(r => r.merchant === 'Credit line drawdown')).toBeUndefined();
    expect(result).toHaveLength(0);
  });
});

/**
 * Budget nudge cards and the merchant modal both use {@link expenseTxnMatchesMerchantModal}
 * (see `showMerchantTransactionsModal` + `getTransactions` with `merchantModalLabel`).
 */
describe('budget nudge drill search contract', () => {
  const variedCursorLikeLines = [
    'CURSOR USAGE MID MAR - +18314259504 - Card Ending: 8454',
    'CURSOR USAGE MID FEB - +18314259504 - Card Ending: 8454',
    'CURSOR AI SUBSCRIPTION LONDON',
  ];
  const displayMerchant = 'Cursor';

  it('display merchant matches every varied bank line (required for modal list to match nudge count)', () => {
    expect(
      variedCursorLikeLines.every(d =>
        transactionDescriptionMatchesDrillSearch(d, displayMerchant),
      ),
    ).toBe(true);
  });

  it('using the full raw line from one txn as search does not match all lines (regression guard)', () => {
    const narrowNeedle = variedCursorLikeLines[0]!;
    expect(
      variedCursorLikeLines.every(d => transactionDescriptionMatchesDrillSearch(d, narrowNeedle)),
    ).toBe(false);
  });

  const variedUberEatsLikeLines = [
    '5120 15APR26 UBER *EATS NATWEST GBR',
    'UBER EATS HELP.UBER.COM',
    'UBER*EATS 4434321',
  ];

  it('Uber Eats display label matches statement variants (modal vs bank text)', () => {
    expect(
      variedUberEatsLikeLines.every(d =>
        transactionDescriptionMatchesDrillSearch(d, 'Uber Eats'),
      ),
    ).toBe(true);
  });

  it('Emirates: specialised drill excludes hotel / country noise (same rule as nudge totals)', () => {
    expect(transactionDescriptionMatchesDrillSearch('EMIRATES AIRLINE', 'Emirates')).toBe(true);
    expect(transactionDescriptionMatchesDrillSearch('H-HOTEL EMIRATES HILLS', 'Emirates')).toBe(false);
    expect(transactionDescriptionMatchesDrillSearch('MASAFI CO LLC U.A.EMIRATES', 'Emirates')).toBe(
      false,
    );
    const airline = { id: 1, date: '2026-01-01', account: 'natwest', type: 'expense' as const, description: 'EMIRATES AIRLINE', amount: -1 };
    const hotel = { id: 2, date: '2026-01-01', account: 'natwest', type: 'expense' as const, description: 'H-HOTEL EMIRATES HILLS', amount: -1 };
    expect(expenseTxnMatchesMerchantModal(airline, 'Emirates')).toBe(true);
    expect(expenseTxnMatchesMerchantModal(hotel, 'Emirates')).toBe(false);
  });

  it('MCE Advisors modal search matches advisory wording on statements', () => {
    expect(transactionDescriptionMatchesDrillSearch('MCE ADVISORY LTD', 'MCE Advisors')).toBe(true);
  });
});
