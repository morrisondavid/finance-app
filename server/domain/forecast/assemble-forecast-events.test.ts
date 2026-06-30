import { describe, it, expect } from 'vitest';
import type { RecurringExpense, UpcomingRecurring } from '../../../shared/api-contracts.js';
import type { PipelineResult } from '../../utils/recurring-pipeline.js';
import { pickMonthlyIncomeRecurringForForecast } from './assemble-forecast-events.js';

const TODAY = '2026-06-10';

function makePipeline(rows: RecurringExpense[]): PipelineResult {
  return {
    expenseCandidates: [],
    incomeCandidates: [],
    expenseAccumulators: new Map(),
    incomeAccumulators: new Map(),
    monthlyExpenseRecurring: [],
    annualExpenseRecurring: [],
    monthlyIncomeRecurring: rows,
    annualIncomeRecurring: [],
    monthsCovered: 12,
  };
}

describe('pickMonthlyIncomeRecurringForForecast', () => {
  it('keeps every pipeline rental when only one line is in the this-month bucket', () => {
    const hunters: RecurringExpense = {
      merchant: '78 Hunters Square',
      category: 'Property',
      colour: '#888',
      amount: 1292.72,
      frequency: 'monthly',
      monthsActive: 24,
      annualTotal: 1292.72 * 12,
      logoUrl: null,
      sourceAccount: 'monzo-joint',
      billingDayOfMonth: 5,
      billingMonth: null,
      declaredObligationId: 'seed-hunters-square-78',
    };
    const heath: RecurringExpense = {
      merchant: '53 Heath Park Road',
      category: 'Property',
      colour: '#888',
      amount: 2850,
      frequency: 'monthly',
      monthsActive: 0,
      annualTotal: 2850 * 12,
      logoUrl: null,
      sourceAccount: 'monzo-joint',
      billingDayOfMonth: 1,
      billingMonth: null,
      declaredObligationId: 'manual-heath-park-rental',
    };
    const huntersUpcoming: UpcomingRecurring = {
      merchant: hunters.merchant,
      category: hunters.category,
      colour: hunters.colour,
      logoUrl: hunters.logoUrl,
      amount: hunters.amount,
      frequency: 'monthly',
      sourceAccount: hunters.sourceAccount,
      nextExpectedDate: '2026-06-15',
      lastChargeDate: '2026-05-05',
      declaredObligationId: 'seed-hunters-square-78',
    };

    const picked = pickMonthlyIncomeRecurringForForecast(
      TODAY,
      makePipeline([hunters, heath]),
      { thisMonth: [huntersUpcoming], thisYear: [] },
    );

    const ids = picked.map(p => p.declaredObligationId);
    expect(ids).toContain('seed-hunters-square-78');
    expect(ids).toContain('manual-heath-park-rental');
  });
});
