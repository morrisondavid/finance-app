/**
 * Guards for getTaxLiabilities FY scoping and shared CT income helper.
 */

import { describe, it, expect, afterAll, beforeAll, vi, beforeEach } from 'vitest';
import {
  createInMemoryTestDb,
  type TestDbHandles,
} from '../test-harness/in-memory-db.js';

const harness: { current: TestDbHandles | null } = { current: null };

vi.mock('../connection.js', () => ({
  getDb: () => {
    if (!harness.current) throw new Error('test db not initialised');
    return harness.current.db;
  },
  get OBLIGATIONS_DIR() {
    if (!harness.current) throw new Error('test db not initialised');
    return harness.current.obligationsDir;
  },
}));

let hashSeq = 0;
function insertIncome(account: string, date: string, amount: number, description = 'Client payment'): void {
  if (!harness.current) throw new Error('test db not initialised');
  hashSeq++;
  harness.current.db.prepare(`
    INSERT INTO transactions (hash, date, description, amount, account, type)
    VALUES (?, ?, ?, ?, ?, 'income')
  `).run(`hash-${hashSeq}`, date, description, amount, account);
}

beforeAll(() => {
  harness.current = createInMemoryTestDb();
});

afterAll(() => {
  harness.current?.cleanup();
});

beforeEach(() => {
  if (!harness.current) return;
  harness.current.db.prepare('DELETE FROM transactions').run();
  hashSeq = 0;
});

describe('getTaxLiabilities — financial year guard', () => {
  it('throws when financialYear is missing', async () => {
    const { getTaxLiabilities } = await import('./tax.js');
    expect(() => getTaxLiabilities({ financialYear: '' })).toThrow(/requires an explicit financialYear/);
  });

  it('FY-scoped CT income excludes transactions outside the selected FY', async () => {
    insertIncome('barclays-current', '2024-06-01', 100_000);
    insertIncome('barclays-current', '2025-06-01', 50_000);

    const { getTaxLiabilities } = await import('./tax.js');
    const fy2425 = getTaxLiabilities({ financialYear: '2024/25' });
    const fy2526 = getTaxLiabilities({ financialYear: '2025/26' });

    expect(fy2425.taxableProfit).toBeCloseTo(100_000 - 100_000 / 6, 0);
    expect(fy2526.taxableProfit).toBeCloseTo(50_000 - 50_000 / 6, 0);
    expect(fy2425.corporationTax).toBeGreaterThan(fy2526.corporationTax);
  });
});

describe('sumCorpTaxIncomeForRange — shared with CT auto-seeder', () => {
  it('returns identical gross income for the same FY range', async () => {
    insertIncome('barclays-current', '2025-06-01', 80_000);

    const { sumCorpTaxIncomeForRange } = await import('./tax.js');
    const { getFinancialYearRange } = await import('../utils/financial-year.js');
    const range = getFinancialYearRange('2025/26');

    expect(sumCorpTaxIncomeForRange(range.startDate, range.endDate)).toBe(80_000);
  });
});
