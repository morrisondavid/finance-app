import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RecurringExpense } from '../../shared/api-contracts.js';
import type { PipelineResult } from './recurring-pipeline.js';
import { applySimulationExclusionsToPipeline } from './expenses-overview-pipeline.js';
import { recurringLineKey } from './expenses-pipeline-to-sheet.js';
import { recurringKey } from './recurring-pipeline.js';

vi.mock('../db/repositories/fixed-expense-simulation-exclusions.js', () => ({
  getFixedExpenseSimulationExclusions: vi.fn(() => []),
}));

import { getFixedExpenseSimulationExclusions } from '../db/repositories/fixed-expense-simulation-exclusions.js';

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

function emptyPipeline(over: Partial<PipelineResult> = {}): PipelineResult {
  return {
    expenseCandidates: [],
    incomeCandidates: [],
    expenseAccumulators: new Map(),
    incomeAccumulators: new Map(),
    monthlyExpenseRecurring: [],
    annualExpenseRecurring: [],
    monthlyIncomeRecurring: [],
    annualIncomeRecurring: [],
    monthsCovered: 6,
    ...over,
  };
}

describe('applySimulationExclusionsToPipeline', () => {
  beforeEach(() => {
    vi.mocked(getFixedExpenseSimulationExclusions).mockReturnValue([]);
  });

  it('returns the same pipeline reference when no exclusions are persisted', () => {
    const pipeline = emptyPipeline({
      monthlyExpenseRecurring: [makeExpense()],
    });
    expect(applySimulationExclusionsToPipeline(pipeline)).toBe(pipeline);
  });

  it('drops excluded monthly expenses and keeps siblings', () => {
    const netflix = makeExpense({ merchant: 'Netflix', amount: 10 });
    const spotify = makeExpense({ merchant: 'Spotify', amount: 12 });
    const pipeline = emptyPipeline({
      monthlyExpenseRecurring: [netflix, spotify],
    });
    const netflixKey = recurringLineKey('expense', 'monthly', netflix);
    vi.mocked(getFixedExpenseSimulationExclusions).mockReturnValue([netflixKey]);

    const filtered = applySimulationExclusionsToPipeline(pipeline);

    expect(filtered.monthlyExpenseRecurring).toEqual([spotify]);
    expect(filtered).not.toBe(pipeline);
  });

  it('drops excluded monthly income rows', () => {
    const rent = makeExpense({
      merchant: 'Rent Received',
      category: 'Income',
      amount: 1500,
      frequency: 'monthly',
    });
    const pipeline = emptyPipeline({
      monthlyIncomeRecurring: [rent],
    });
    const rentKey = recurringLineKey('income', 'monthly', rent);
    vi.mocked(getFixedExpenseSimulationExclusions).mockReturnValue([rentKey]);

    const filtered = applySimulationExclusionsToPipeline(pipeline);

    expect(filtered.monthlyIncomeRecurring).toEqual([]);
  });

  it('matches persisted keys built as expense|frequency|recurringKey', () => {
    const expense = makeExpense({ merchant: 'EE', amount: 45 });
    const persistedKey = `expense|monthly|${recurringKey(expense)}`;
    expect(recurringLineKey('expense', 'monthly', expense)).toBe(persistedKey);
    vi.mocked(getFixedExpenseSimulationExclusions).mockReturnValue([persistedKey]);

    const filtered = applySimulationExclusionsToPipeline(
      emptyPipeline({ monthlyExpenseRecurring: [expense] }),
    );

    expect(filtered.monthlyExpenseRecurring).toEqual([]);
  });
});
