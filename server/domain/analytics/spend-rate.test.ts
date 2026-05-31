import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/exchange-rates.js', () => ({
  convertAmountSync: (amount: number) => amount,
}));

vi.mock('../accounts/queries.js', () => ({
  getAccountConfig: (account: string) => ({
    currency: 'GBP',
    category: account.includes('barclays') ? 'business' : 'personal',
  }),
  getEntityIdForAccount: () => 'autonize-it-ltd',
}));

vi.mock('../payroll/index.js', () => ({
  transactionCategoryWithPayroll: (description: string) =>
    (description === 'Rent' ? 'Housing' : 'Groceries'),
}));

const queryRows = vi.fn();

vi.mock('../../db/connection.js', () => ({
  getDb: () => ({
    prepare: () => ({ all: queryRows }),
  }),
}));

import { computeTrailingSpendRate } from './spend-rate.js';

describe('computeTrailingSpendRate', () => {
  beforeEach(() => {
    queryRows.mockReset();
  });

  it('accumulates personal discretionary vs business mandatory buckets', () => {
    queryRows.mockReturnValue([
      { account: 'natwest', description: 'Tesco', hash: 'h1', spent: 100 },
      { account: 'barclays-current', description: 'Rent', hash: 'h2', spent: 2000 },
    ]);

    const result = computeTrailingSpendRate(30, undefined, '2026-05-31');
    expect(result.perDay).toBeGreaterThan(0);
    expect(result.split.personalDiscretionary).toBe(100);
    expect(result.split.businessMandatory).toBe(2000);
  });
});
