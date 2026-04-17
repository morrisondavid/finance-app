import { describe, it, expect } from 'vitest';
import { applySimulationExclusions, buildExpensesSheetResponse } from './expenses-sheet-build.js';
import type { ExpensesLineItem, ExpensesSection } from './api-contracts.js';

function line(
  key: string,
  merchant: string,
  amount: number,
  category: string,
  ownership: 'personal' | 'business',
  sourceAccount = 'barclays-current',
  frequency: 'monthly' | 'annual' = 'monthly',
): ExpensesLineItem {
  return {
    lineKey: key,
    merchant,
    category,
    amount,
    frequency,
    sourceAccount,
    ownership,
    isVariable: false,
    billingDayOfMonth: null,
    billingMonth: null,
    variance: [],
  };
}

function sec(name: string, items: ExpensesLineItem[]): ExpensesSection {
  const subtotal = items.reduce((s, i) => s + i.amount, 0);
  return { name, colour: '#000', subtotal, items };
}

describe('applySimulationExclusions', () => {
  it('reduces debt insight when a debt line is excluded', () => {
    const debtA = line('e|m|d1', 'Barclaycard', 300, 'Debt Repayment', 'personal');
    const debtB = line('e|m|d2', 'MBNA', 200, 'Debt Repayment', 'personal');
    const monthlyOutgoings: ExpensesSection[] = [sec('Debt Repayment', [debtA, debtB])];
    const incomeMonthlyItems: ExpensesLineItem[] = [
      line('i|m|r1', 'Rent Received', 100, 'Income', 'personal'),
    ];
    const baseline = buildExpensesSheetResponse({
      monthlyOutgoings,
      annualOutgoings: [],
      incomeMonthlyItems,
      incomeAnnualItems: [],
      monthsCovered: 24,
      periodDescription: 'Last 24 months',
    });
    expect(baseline.insight.debtTotal).toBeCloseTo(500, 2);

    const adjusted = applySimulationExclusions(baseline, new Set(['e|m|d1']));
    expect(adjusted.insight.debtTotal).toBeCloseTo(200, 2);
    expect(adjusted.summary.totalMonthlyOutgoings).toBeCloseTo(200, 2);
    expect(adjusted.monthlyOutgoings[0].subtotal).toBeCloseTo(200, 2);
    expect(adjusted.monthlyOutgoings[0].items).toHaveLength(2);
    expect(adjusted.excludedLineKeys).toEqual(['e|m|d1']);
  });

  it('excluding passive income increases monthly need after passive', () => {
    const housing = line('e|m|h1', 'Mortgage', 2000, 'Housing', 'personal');
    const monthlyOutgoings: ExpensesSection[] = [sec('Housing', [housing])];
    const rent = line('i|m|r1', 'Rent Received', 1500, 'Income', 'personal');
    const incomeMonthlyItems = [rent];
    const baseline = buildExpensesSheetResponse({
      monthlyOutgoings,
      annualOutgoings: [],
      incomeMonthlyItems,
      incomeAnnualItems: [],
      monthsCovered: 24,
      periodDescription: 'Last 24 months',
    });
    expect(baseline.insight.monthlyIncomeNeededAfterPassive).toBeCloseTo(500, 2);

    const adjusted = applySimulationExclusions(baseline, new Set(['i|m|r1']));
    expect(adjusted.insight.monthlyIncomeNeededAfterPassive).toBeCloseTo(2000, 2);
    expect(adjusted.summary.totalMonthlyIncome).toBe(0);
  });

  it('updates yearly pods when annual lines excluded', () => {
    const monthly = line('e|m|x', 'Small', 100, 'Utilities', 'personal');
    const annualOut = line('e|a|y1', 'Insurance annual', 500, 'Insurance', 'personal', 'barclays-current', 'annual');
    const annualIn = line('i|a|y2', 'Dividend annual', 200, 'Income', 'personal', 'natwest', 'annual');
    const baseline = buildExpensesSheetResponse({
      monthlyOutgoings: [sec('Utilities', [monthly])],
      annualOutgoings: [sec('Insurance', [annualOut])],
      incomeMonthlyItems: [],
      incomeAnnualItems: [annualIn],
      monthsCovered: 24,
      periodDescription: 'Last 24 months',
    });
    const adjusted = applySimulationExclusions(baseline, new Set(['e|a|y1']));
    expect(adjusted.summary.totalAnnualOutgoings).toBe(0);
    expect(adjusted.summary.totalYearlyFixedOutgoings).toBeCloseTo(12 * 100, 2);
  });
});
