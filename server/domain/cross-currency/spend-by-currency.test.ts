import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { TransactionRow } from '../../db/repositories/transactions.js';

vi.mock('../../db/repositories/transactions.js', () => ({
  getTransactions: vi.fn(),
}));

import { getTransactions } from '../../db/repositories/transactions.js';
import { buildSpendTotalsByCurrency } from './spend-by-currency.js';

describe('buildSpendTotalsByCurrency', () => {
  beforeEach(() => {
    vi.mocked(getTransactions).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sums expenses by account native currency for a calendar month', () => {
    vi.mocked(getTransactions).mockImplementation((filters = {}) => {
      if (filters.account === 'emirates-islamic' && filters.year === '2026' && filters.month === '05') {
        return [
          {
            id: 1,
            hash: 'h1',
            date: '2026-05-10',
            description: 'COFFEE SHOP',
            amount: -100,
            account: 'emirates-islamic',
            type: 'expense',
            linked_transaction_id: null,
          } satisfies TransactionRow,
        ];
      }
      if (filters.account === 'barclays-current' && filters.year === '2026' && filters.month === '05') {
        return [
          {
            id: 2,
            hash: 'h2',
            date: '2026-05-11',
            description: 'GROCERIES',
            amount: -25.5,
            account: 'barclays-current',
            type: 'expense',
            linked_transaction_id: null,
          } satisfies TransactionRow,
        ];
      }
      return [];
    });

    const { totalsByCurrency, fxNote } = buildSpendTotalsByCurrency({
      period: { kind: 'calendarMonth', yearMonth: '2026-05' },
    });

    expect(fxNote.length).toBeGreaterThan(10);
    const aed = totalsByCurrency.find(t => t.currency === 'AED');
    const gbp = totalsByCurrency.find(t => t.currency === 'GBP');
    expect(aed?.expenseNative).toBe(100);
    expect(aed?.transactionCount).toBe(1);
    expect(gbp?.expenseNative).toBe(25.5);
    expect(gbp?.expenseGbp).toBe(25.5);
    expect(gbp?.transactionCount).toBe(1);
  });

  it('excludes transfer-categorised expenses', () => {
    vi.mocked(getTransactions).mockImplementation((filters = {}) => {
      if (filters.account === 'barclays-current' && filters.financialYear === '2025-26') {
        return [
          {
            id: 1,
            hash: 'h1',
            date: '2025-08-10',
            description: 'OPTIONAL FT PAYMENT',
            amount: -500,
            account: 'barclays-current',
            type: 'expense',
            linked_transaction_id: null,
          } satisfies TransactionRow,
        ];
      }
      return [];
    });

    const { totalsByCurrency } = buildSpendTotalsByCurrency({
      period: { kind: 'financialYear', financialYear: '2025-26' },
      account: 'barclays-current',
    });

    expect(totalsByCurrency).toEqual([]);
  });
});
