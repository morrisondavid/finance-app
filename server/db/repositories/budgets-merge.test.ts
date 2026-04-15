import { describe, it, expect } from 'vitest';
import type { CategoryName } from '../../utils/categorizer.js';
import { mergeBudgetsWithMonthlySpend, mergeYearlyBudgetsWithFySpend } from './budgets.js';

const MONTH_KEYS = [
  '2025-05',
  '2025-06',
  '2025-07',
  '2025-08',
  '2025-09',
  '2025-10',
  '2025-11',
  '2025-12',
  '2026-01',
  '2026-02',
  '2026-03',
  '2026-04',
] as const;

describe('mergeBudgetsWithMonthlySpend', () => {
  it('returns a month row for each key with negative difference when under budget', () => {
    const byMonth = new Map<string, Map<string, number>>([
      ['2025-05', new Map([['Groceries', 50]])],
    ]);
    const [row] = mergeBudgetsWithMonthlySpend(
      [{ category: 'Groceries', amount: 100 }],
      byMonth,
      ['2025-05'],
    );
    expect(row.monthlyBudget).toBe(100);
    expect(row.months).toHaveLength(1);
    expect(row.months[0]).toMatchObject({
      monthKey: '2025-05',
      budget: 100,
      spent: 50,
      difference: -50,
    });
    expect(row.months[0].monthLabel).toContain('May');
  });

  it('returns positive difference when over budget', () => {
    const byMonth = new Map<string, Map<string, number>>([
      ['2025-06', new Map([['Entertainment', 200]])],
    ]);
    const [row] = mergeBudgetsWithMonthlySpend(
      [{ category: 'Entertainment', amount: 100 }],
      byMonth,
      ['2025-06'],
    );
    expect(row.months).toHaveLength(1);
    const m = row.months[0];
    expect(m.budget).toBe(100);
    expect(m.spent).toBe(200);
    expect(m.difference).toBe(100);
  });

  it('lists every month key with zero spend when map has no data', () => {
    const byMonth = new Map<string, Map<string, number>>();
    const [row] = mergeBudgetsWithMonthlySpend(
      [{ category: 'Other', amount: 25 }],
      byMonth,
      ['2025-05', '2025-06'],
    );
    expect(row.months).toHaveLength(2);
    expect(row.months[0]).toMatchObject({ spent: 0, budget: 25, difference: -25 });
    expect(row.months[1]).toMatchObject({ spent: 0, budget: 25, difference: -25 });
  });

  it('evaluates multiple keys in order', () => {
    const byMonth = new Map<string, Map<string, number>>([
      ['2025-05', new Map([['Other', 40]])],
      ['2025-06', new Map([['Other', 50]])],
    ]);
    const [row] = mergeBudgetsWithMonthlySpend([{ category: 'Other', amount: 25 }], byMonth, [
      '2025-05',
      '2025-06',
    ]);
    expect(row.months).toHaveLength(2);
    expect(row.months.map(x => x.difference)).toEqual([15, 25]);
  });

  it('supports full FY key list', () => {
    const byMonth = new Map<string, Map<string, number>>();
    const [row] = mergeBudgetsWithMonthlySpend([{ category: 'X', amount: 10 }], byMonth, MONTH_KEYS);
    expect(row.months).toHaveLength(12);
    expect(row.months.every(m => m.difference === -10)).toBe(true);
  });
});

describe('mergeYearlyBudgetsWithFySpend', () => {
  it('returns negative difference when under yearly cap', () => {
    const fyTotals = new Map<CategoryName, number>([['Travel', 400]]);
    const [row] = mergeYearlyBudgetsWithFySpend([{ category: 'Travel', amount: 1000 }], fyTotals);
    expect(row).toMatchObject({
      category: 'Travel',
      yearlyBudget: 1000,
      spent: 400,
      difference: -600,
    });
  });

  it('returns positive difference when over yearly cap', () => {
    const fyTotals = new Map<CategoryName, number>([['Travel', 1200]]);
    const [row] = mergeYearlyBudgetsWithFySpend([{ category: 'Travel', amount: 1000 }], fyTotals);
    expect(row.difference).toBe(200);
  });

  it('treats missing category spend as zero', () => {
    const fyTotals = new Map<CategoryName, number>();
    const [row] = mergeYearlyBudgetsWithFySpend([{ category: 'Other', amount: 500 }], fyTotals);
    expect(row.spent).toBe(0);
    expect(row.difference).toBe(-500);
  });
});
