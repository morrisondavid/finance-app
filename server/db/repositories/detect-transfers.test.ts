import { describe, it, expect, afterAll, beforeAll, beforeEach, vi } from 'vitest';
import {
  createInMemoryTestDb,
  resetTestData,
  type TestDbHandles,
} from '../test-harness/in-memory-db.js';

/**
 * Regression lock for `detectTransfers()` — specifically the
 * within-entity cross-account pairing that makes Wise "free" as an
 * intermediary account. Before `wise-ltd` was added every Barclays
 * debit whose amount coincidentally matched an Emirates-Islamic
 * inward remittance got surfaced as an inter-company false-positive
 * pair. With `wise-ltd` present, the Barclays debit pairs with the
 * Wise IN row automatically (both sides are business accounts on the
 * same `autonize-it-ltd` entity), flipping both rows to
 * `type = 'transfer'` and taking them out of the inter-company
 * pair-finder's scope.
 *
 * See `wise-account-and-smarter-transfers` plan §W2 for context.
 */

const harness: { current: TestDbHandles | null } = { current: null };

vi.mock('../connection.js', () => ({
  getDb: () => {
    if (!harness.current) throw new Error('test db not initialised');
    return harness.current.db;
  },
}));

beforeAll(() => {
  harness.current = createInMemoryTestDb();
});

afterAll(() => {
  harness.current?.cleanup();
});

beforeEach(() => {
  if (harness.current) resetTestData(harness.current.db);
});

let hashSeq = 0;
function insertTxn(
  account: string,
  date: string,
  amount: number,
  description: string,
  type: 'income' | 'expense' | 'transfer' = amount >= 0 ? 'income' : 'expense',
): number {
  if (!harness.current) throw new Error('test db not initialised');
  hashSeq++;
  const info = harness.current.db
    .prepare(
      `INSERT INTO transactions (hash, date, description, amount, account, type)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(`hash-${hashSeq}`, date, description, amount, account, type);
  return Number(info.lastInsertRowid);
}

describe('detectTransfers — Barclays ↔ Wise within-entity pairing', () => {
  it('pairs a Barclays debit with the Wise IN row without any description pattern', async () => {
    const { detectTransfers } = await import('./transactions.js');

    const barclaysId = insertTxn(
      'barclays-current',
      '2026-03-31',
      -1000,
      'PAYMENT TO WISE',
    );
    const wiseId = insertTxn(
      'wise-ltd',
      '2026-03-31',
      1000,
      'Wise: money added',
    );

    detectTransfers();

    const rows = harness.current!.db
      .prepare(
        `SELECT id, type, linked_transaction_id AS linkedId
           FROM transactions
          ORDER BY id`,
      )
      .all() as Array<{ id: number; type: string; linkedId: number | null }>;

    const barclays = rows.find(r => r.id === barclaysId);
    const wise = rows.find(r => r.id === wiseId);
    expect(barclays?.type).toBe('transfer');
    expect(wise?.type).toBe('transfer');
    expect(barclays?.linkedId).toBe(wiseId);
    expect(wise?.linkedId).toBe(barclaysId);
  });

  it('survives the shared harness reset — a fresh Wise leg still pairs', async () => {
    const { detectTransfers } = await import('./transactions.js');

    const barclaysId = insertTxn(
      'barclays-current',
      '2026-02-18',
      -5000,
      'MOBILE PAYMENT TO WISE',
    );
    const wiseId = insertTxn(
      'wise-ltd',
      '2026-02-18',
      5000,
      'Wise: money added',
    );

    detectTransfers();

    const barclays = harness.current!.db
      .prepare(`SELECT type, linked_transaction_id AS linkedId FROM transactions WHERE id = ?`)
      .get(barclaysId) as { type: string; linkedId: number | null };
    expect(barclays.type).toBe('transfer');
    expect(barclays.linkedId).toBe(wiseId);
  });
});
