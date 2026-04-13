import { describe, it, expect } from 'vitest';
import { detectPassThrough } from '../pass-through-detector.js';
import type { PassThroughTransaction } from '../pass-through-detector.js';

function tx(
  id: number,
  date: string,
  amount: number,
  type: 'income' | 'expense' | 'transfer' = amount > 0 ? 'income' : 'expense',
  account = 'natwest',
): PassThroughTransaction {
  return { id, date, amount, type, account };
}

describe('detectPassThrough', () => {
  it('flags dividend income that is immediately forwarded out', () => {
    const transactions = [
      tx(1, '2026-03-01', 1900, 'income'),
      tx(2, '2026-03-02', -1900, 'transfer'),
    ];
    const result = detectPassThrough(transactions);

    expect(result.passThroughIds.has(1)).toBe(true);
    expect(result.passThroughIds.has(2)).toBe(false);
    expect(result.totalExcluded).toBe(1900);
  });

  it('does not flag salary that stays in the account', () => {
    const transactions = [
      tx(1, '2026-03-01', 3000, 'income'),
      tx(2, '2026-03-05', -50, 'expense'),
      tx(3, '2026-03-10', -30, 'expense'),
    ];
    const result = detectPassThrough(transactions);

    expect(result.passThroughIds.size).toBe(0);
    expect(result.totalExcluded).toBe(0);
  });

  it('handles multiple pass-throughs in the same month', () => {
    const transactions = [
      tx(1, '2026-03-01', 1900, 'income'),
      tx(2, '2026-03-02', -1900, 'transfer'),
      tx(3, '2026-03-15', 500, 'income'),
      tx(4, '2026-03-16', -500, 'expense'),
    ];
    const result = detectPassThrough(transactions);

    expect(result.passThroughIds.size).toBe(2);
    expect(result.passThroughIds.has(1)).toBe(true);
    expect(result.passThroughIds.has(3)).toBe(true);
    expect(result.totalExcluded).toBe(2400);
  });

  it('does not match outgoing that occurs BEFORE the income', () => {
    const transactions = [
      tx(1, '2026-03-05', -1900, 'expense'),
      tx(2, '2026-03-07', 1900, 'income'),
    ];
    const result = detectPassThrough(transactions);

    expect(result.passThroughIds.size).toBe(0);
  });

  it('does not match if gap exceeds 5 days', () => {
    const transactions = [
      tx(1, '2026-03-01', 1000, 'income'),
      tx(2, '2026-03-07', -1000, 'expense'),
    ];
    const result = detectPassThrough(transactions);

    expect(result.passThroughIds.size).toBe(0);
  });

  it('matches within exactly 5 days', () => {
    const transactions = [
      tx(1, '2026-03-01', 1000, 'income'),
      tx(2, '2026-03-06', -1000, 'expense'),
    ];
    const result = detectPassThrough(transactions);

    expect(result.passThroughIds.has(1)).toBe(true);
  });

  it('does not match different amounts', () => {
    const transactions = [
      tx(1, '2026-03-01', 1900, 'income'),
      tx(2, '2026-03-02', -1850, 'expense'),
    ];
    const result = detectPassThrough(transactions);

    expect(result.passThroughIds.size).toBe(0);
  });

  it('tolerates penny rounding differences', () => {
    const transactions = [
      tx(1, '2026-03-01', 1900.00, 'income'),
      tx(2, '2026-03-02', -1900.01, 'expense'),
    ];
    const result = detectPassThrough(transactions);

    expect(result.passThroughIds.has(1)).toBe(true);
  });

  it('does not match across different accounts', () => {
    const transactions = [
      tx(1, '2026-03-01', 1900, 'income', 'natwest'),
      tx(2, '2026-03-02', -1900, 'expense', 'monzo-joint'),
    ];
    const result = detectPassThrough(transactions);

    expect(result.passThroughIds.size).toBe(0);
  });

  it('matches positive transfers as income (transfer with amount > 0)', () => {
    const transactions = [
      tx(1, '2026-03-01', 1900, 'transfer'),
      tx(2, '2026-03-02', -1900, 'expense'),
    ];
    const result = detectPassThrough(transactions);

    expect(result.passThroughIds.has(1)).toBe(true);
  });

  it('pairs 1:1 — each outgoing can only match one income', () => {
    const transactions = [
      tx(1, '2026-03-01', 500, 'income'),
      tx(2, '2026-03-02', 500, 'income'),
      tx(3, '2026-03-03', -500, 'expense'),
    ];
    const result = detectPassThrough(transactions);

    expect(result.passThroughIds.size).toBe(1);
    expect(result.passThroughIds.has(1)).toBe(true);
    expect(result.passThroughIds.has(2)).toBe(false);
  });

  it('prefers the nearest outgoing when multiple match', () => {
    const transactions = [
      tx(1, '2026-03-01', 1000, 'income'),
      tx(2, '2026-03-04', -1000, 'expense'),
      tx(3, '2026-03-02', -1000, 'expense'),
    ];
    const result = detectPassThrough(transactions);

    expect(result.passThroughIds.has(1)).toBe(true);
    expect(result.passThroughIds.size).toBe(1);
  });

  it('returns empty for no transactions', () => {
    const result = detectPassThrough([]);

    expect(result.passThroughIds.size).toBe(0);
    expect(result.totalExcluded).toBe(0);
  });

  it('returns empty for expenses only', () => {
    const transactions = [
      tx(1, '2026-03-01', -50, 'expense'),
      tx(2, '2026-03-02', -100, 'expense'),
    ];
    const result = detectPassThrough(transactions);

    expect(result.passThroughIds.size).toBe(0);
  });

  it('handles same-day pass-through', () => {
    const transactions = [
      tx(1, '2026-03-01', 2000, 'income'),
      tx(2, '2026-03-01', -2000, 'transfer'),
    ];
    const result = detectPassThrough(transactions);

    expect(result.passThroughIds.has(1)).toBe(true);
    expect(result.totalExcluded).toBe(2000);
  });

  it('real-world scenario: monthly dividends forwarded to joint account', () => {
    const transactions: PassThroughTransaction[] = [];
    let id = 1;
    for (let m = 1; m <= 12; m++) {
      const mm = String(m).padStart(2, '0');
      transactions.push(tx(id++, `2025-${mm}-01`, 1900, 'income'));
      transactions.push(tx(id++, `2025-${mm}-02`, -1900, 'transfer'));
      transactions.push(tx(id++, `2025-${mm}-25`, 3500, 'income'));
    }
    const result = detectPassThrough(transactions);

    expect(result.passThroughIds.size).toBe(12);
    expect(result.totalExcluded).toBe(1900 * 12);
    for (let i = 0; i < 12; i++) {
      expect(result.passThroughIds.has(i * 3 + 1)).toBe(true);
      expect(result.passThroughIds.has(i * 3 + 3)).toBe(false);
    }
  });
});
