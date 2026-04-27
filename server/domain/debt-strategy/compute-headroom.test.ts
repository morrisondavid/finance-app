import { describe, it, expect } from 'vitest';
import { computeHeadroom } from './compute-headroom.js';

describe('computeHeadroom', () => {
  it('returns income − mandatory − sum(budgets)', () => {
    expect(
      computeHeadroom({
        currency: 'GBP',
        forecastedMonthlyIncome: 5000,
        mandatoryMonthly: 2000,
        categoryBudgets: [
          { category: 'Groceries', monthlyCap: 600 },
          { category: 'Transport', monthlyCap: 300 },
          { category: 'Eating Out', monthlyCap: 200 },
        ],
      }),
    ).toBe(1900);
  });

  it('returns total income when there are no mandatories or budgets', () => {
    expect(
      computeHeadroom({
        currency: 'GBP',
        forecastedMonthlyIncome: 1000,
        mandatoryMonthly: 0,
        categoryBudgets: [],
      }),
    ).toBe(1000);
  });

  it('floors at 0 when budgets exceed income', () => {
    expect(
      computeHeadroom({
        currency: 'GBP',
        forecastedMonthlyIncome: 1000,
        mandatoryMonthly: 800,
        categoryBudgets: [{ category: 'Groceries', monthlyCap: 500 }],
      }),
    ).toBe(0);
  });

  it('floors at 0 when mandatory alone exceeds income', () => {
    expect(
      computeHeadroom({
        currency: 'GBP',
        forecastedMonthlyIncome: 1000,
        mandatoryMonthly: 1500,
        categoryBudgets: [],
      }),
    ).toBe(0);
  });

  it('treats QoL and malleable budgets identically (both are inviolable here)', () => {
    const result1 = computeHeadroom({
      currency: 'GBP',
      forecastedMonthlyIncome: 5000,
      mandatoryMonthly: 1000,
      categoryBudgets: [
        { category: 'Groceries', monthlyCap: 600 }, // qol
        { category: 'Eating Out', monthlyCap: 200 }, // malleable
      ],
    });
    // Same total budgets; tags don't affect the math.
    expect(result1).toBe(3200);
  });

  it('handles AED currency identically (currency is just metadata at this layer)', () => {
    expect(
      computeHeadroom({
        currency: 'AED',
        forecastedMonthlyIncome: 50000,
        mandatoryMonthly: 20000,
        categoryBudgets: [{ category: 'Groceries', monthlyCap: 5000 }],
      }),
    ).toBe(25000);
  });

  it('returns 0 for empty inputs', () => {
    expect(
      computeHeadroom({
        currency: 'GBP',
        forecastedMonthlyIncome: 0,
        mandatoryMonthly: 0,
        categoryBudgets: [],
      }),
    ).toBe(0);
  });
});
