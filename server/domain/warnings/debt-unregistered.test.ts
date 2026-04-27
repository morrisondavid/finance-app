import { describe, it, expect, vi } from 'vitest';
import { deriveDebtUnregisteredWarnings } from './debt-unregistered.js';
import type { Debt } from '../../db/repositories/debts.js';
import type { BudgetNudgeRow } from '../../utils/budget-nudges.js';
import type { PipelineResult, RawTransaction } from '../../utils/recurring-pipeline.js';

vi.mock('../../utils/budget-nudges.js', () => ({
  computeBudgetNudges: vi.fn(),
}));

import { computeBudgetNudges } from '../../utils/budget-nudges.js';
const mockComputeBudgetNudges = vi.mocked(computeBudgetNudges);

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

function nudge(over: Partial<BudgetNudgeRow>): BudgetNudgeRow {
  return {
    merchant: over.merchant ?? 'KLARNA UK',
    suggestedCategory: over.suggestedCategory ?? 'Shopping',
    totalSpend: over.totalSpend ?? 600,
    transactionCount: over.transactionCount ?? 6,
    lastDate: over.lastDate ?? '2026-04-15',
    logoUrl: over.logoUrl ?? null,
  };
}

function makeDebt(over: Partial<Debt> = {}): Debt {
  return {
    id: 'klarna',
    name: 'Klarna',
    merchantPattern: 'KLARNA',
    sourceAccounts: ['barclays-current'],
    originalLoanAmount: 500,
    originalLoanDate: null,
    openingBalance: 200,
    openingBalanceDate: '2026-01-01',
    archived: false,
    matchAmounts: [50],
    matchTolerancePct: 0,
    kind: 'consumer',
    interestRate: null,
    fixedRateEndDate: null,
    repaymentType: null,
    propertyValueEstimate: null,
    propertyId: null,
    updatedAt: '2026-01-01',
    ...over,
  };
}

const txns: readonly RawTransaction[] = [];

describe('deriveDebtUnregisteredWarnings', () => {
  it('fires for a Klarna-style unregistered debt', () => {
    mockComputeBudgetNudges.mockReturnValue([nudge({ merchant: 'KLARNA UK' })]);
    const out = deriveDebtUnregisteredWarnings({
      expenseTransactions: txns,
      pipeline: emptyPipeline(),
      budgetedCategories: new Set(),
      debts: [],
    });
    expect(out).toHaveLength(1);
    expect(out[0].code).toBe('debt-unregistered');
    expect(out[0].severity).toBe('info');
    expect(out[0].context?.merchant).toBe('KLARNA UK');
    expect(out[0].context?.matchedPattern).toBe('KLARNA');
  });

  it('does NOT fire when an existing debt covers the merchant pattern', () => {
    mockComputeBudgetNudges.mockReturnValue([nudge({ merchant: 'KLARNA UK' })]);
    const out = deriveDebtUnregisteredWarnings({
      expenseTransactions: txns,
      pipeline: emptyPipeline(),
      budgetedCategories: new Set(),
      debts: [makeDebt({ id: 'klarna-existing', merchantPattern: 'KLARNA' })],
    });
    expect(out).toHaveLength(0);
  });

  it('does NOT fire when the existing-debt-coverage debt is archived (still does fire because archived is treated as no-coverage)', () => {
    mockComputeBudgetNudges.mockReturnValue([nudge({ merchant: 'KLARNA UK' })]);
    const out = deriveDebtUnregisteredWarnings({
      expenseTransactions: txns,
      pipeline: emptyPipeline(),
      budgetedCategories: new Set(),
      debts: [makeDebt({ id: 'klarna-old', merchantPattern: 'KLARNA', archived: true })],
    });
    expect(out).toHaveLength(1); // archived debts don't count as coverage
  });

  it('does NOT fire on a regular non-credit recurring (e.g. Netflix)', () => {
    mockComputeBudgetNudges.mockReturnValue([
      nudge({ merchant: 'NETFLIX', suggestedCategory: 'Entertainment' }),
    ]);
    const out = deriveDebtUnregisteredWarnings({
      expenseTransactions: txns,
      pipeline: emptyPipeline(),
      budgetedCategories: new Set(),
      debts: [],
    });
    expect(out).toHaveLength(0);
  });

  it('detects multiple credit providers in one pass', () => {
    mockComputeBudgetNudges.mockReturnValue([
      nudge({ merchant: 'KLARNA' }),
      nudge({ merchant: 'AFFIRM US' }),
      nudge({ merchant: 'NETFLIX' }), // not credit
    ]);
    const out = deriveDebtUnregisteredWarnings({
      expenseTransactions: txns,
      pipeline: emptyPipeline(),
      budgetedCategories: new Set(),
      debts: [],
    });
    expect(out.map(o => o.context?.matchedPattern).sort()).toEqual(['AFFIRM', 'KLARNA']);
  });

  it('case-insensitive on the merchant string', () => {
    mockComputeBudgetNudges.mockReturnValue([nudge({ merchant: 'klarna uk' })]);
    const out = deriveDebtUnregisteredWarnings({
      expenseTransactions: txns,
      pipeline: emptyPipeline(),
      budgetedCategories: new Set(),
      debts: [],
    });
    expect(out).toHaveLength(1);
  });
});
