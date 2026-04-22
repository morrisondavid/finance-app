import { describe, it, expect, afterAll, beforeAll, vi, beforeEach } from 'vitest';
import {
  createInMemoryTestDb,
  type TestDbHandles,
} from '../test-harness/in-memory-db.js';

/**
 * DB-layer regression locks for entity-scoped tax liabilities.
 *
 * Under the Phase A3 architecture `getTaxLiabilities` no longer
 * accepts an `entityId` — per-account flags (`vat.registered`,
 * `corpTax.qualifyingFreeZone`) pre-determine scope at the
 * `vatApplicable` / `corpTaxApplicable` index level. These tests
 * restate the original invariants against the new API:
 *   - AED income on `emirates-islamic` (FZCO) never contributes to
 *     UK VAT or UK CT aggregates;
 *   - UK income on `barclays-current` (UK Ltd) drives CT / VAT;
 *   - behaviour is deterministic regardless of narrative or amount.
 */

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
  harness.current?.db.exec('DELETE FROM transactions');
  hashSeq = 0;
});

describe('getTaxLiabilities — FZCO income cannot leak into UK aggregates', () => {
  it('AED income on emirates-islamic yields zero VAT / zero CT (vat.registered=false + QFZP=TBC gate)', async () => {
    insertIncome('emirates-islamic', '2026-06-15', 500_000, 'La Fosse invoice');

    const { getTaxLiabilities } = await import('./tax.js');
    const result = getTaxLiabilities({ financialYear: '2025/26' });

    expect(result.vatOwedThisQuarter).toBe(0);
    expect(result.vatInProgressEstimate).toBe(0);
    expect(result.vatOnIncome).toBe(0);
    expect(result.corporationTax).toBe(0);
    expect(result.taxableProfit).toBe(0);
  });

  it('UK income on barclays-current drives CT / VAT; parallel FZCO income does not leak', async () => {
    insertIncome('barclays-current', '2026-03-15', 12_000, 'Delta Capita invoice');
    insertIncome('emirates-islamic', '2026-03-15', 500_000, 'La Fosse invoice');

    const { getTaxLiabilities } = await import('./tax.js');
    const result = getTaxLiabilities({ financialYear: '2025/26' });

    const ukIncomeNetOfVat = 12_000 - 12_000 / 6;
    expect(result.taxableProfit).toBeCloseTo(ukIncomeNetOfVat, 0);
    expect(result.corporationTax).toBeLessThan(3_000);
  });

  it('AED 500k on FZCO alone never leaks into UK CT — the index gate holds', async () => {
    insertIncome('emirates-islamic', '2026-03-15', 500_000);

    const { getTaxLiabilities } = await import('./tax.js');
    const result = getTaxLiabilities({ financialYear: '2025/26' });

    expect(result.taxableProfit).toBe(0);
    expect(result.corporationTax).toBe(0);
    expect(result.vatOnIncome).toBe(0);
  });
});
