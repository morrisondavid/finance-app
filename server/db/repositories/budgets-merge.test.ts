import { describe, it, expect } from 'vitest';
import { mergeBudgetsWithSpendTotals } from './budgets.js';

describe('mergeBudgetsWithSpendTotals', () => {
  it('computes remaining and overBy from spend', () => {
    const spend = new Map<string, number>([
      ['Groceries', 80],
      ['Utilities', 40],
    ]);
    const out = mergeBudgetsWithSpendTotals(
      [
        { category: 'Groceries', amount: 100 },
        { category: 'Utilities', amount: 50 },
      ],
      spend,
    );
    const g = out.find(r => r.category === 'Groceries');
    const u = out.find(r => r.category === 'Utilities');
    expect(g?.spent).toBe(80);
    expect(g?.remaining).toBe(20);
    expect(g?.overBy).toBe(0);
    expect(u?.spent).toBe(40);
    expect(u?.remaining).toBe(10);
    expect(u?.overBy).toBe(0);
  });

  it('flags overspend', () => {
    const spend = new Map<string, number>([['Entertainment', 200]]);
    const [row] = mergeBudgetsWithSpendTotals([{ category: 'Entertainment', amount: 150 }], spend);
    expect(row.spent).toBe(200);
    expect(row.remaining).toBe(0);
    expect(row.overBy).toBe(50);
  });

  it('treats missing spend as zero', () => {
    const [row] = mergeBudgetsWithSpendTotals([{ category: 'Other', amount: 25 }], new Map());
    expect(row.spent).toBe(0);
    expect(row.remaining).toBe(25);
    expect(row.overBy).toBe(0);
  });
});
