import { describe, it, expect, afterAll, beforeEach, vi } from 'vitest';
import { createInMemoryTestDb } from '../../db/test-harness/in-memory-db.js';

const harness = createInMemoryTestDb();

vi.mock('../../db/connection.js', () => ({
  getDb: () => harness.db,
}));

const { resolvePaidFieldsFromTxHash, paidFieldsFromTransactionMatch } = await import('./paid-fields.js');

afterAll(() => harness.cleanup());

beforeEach(() => {
  harness.db.exec('DELETE FROM transactions');
});

describe('resolvePaidFieldsFromTxHash', () => {
  it('returns paid fields for a known hash', () => {
    harness.db.prepare(`
      INSERT INTO transactions (hash, date, description, amount, account, type)
      VALUES ('tx-abc', '2026-05-14', 'HMRC GOV.UK SA', -2123.24, 'barclaycard', 'expense')
    `).run();

    const fields = resolvePaidFieldsFromTxHash('tx-abc');
    expect(fields).toEqual({
      paidAmount: 2123.24,
      paidDate: '2026-05-14',
      paidFromAccount: 'barclaycard',
    });
  });

  it('returns null for an unknown hash', () => {
    expect(resolvePaidFieldsFromTxHash('missing')).toBeNull();
  });
});

describe('paidFieldsFromTransactionMatch', () => {
  it('maps match row to paid fields plus hash', () => {
    const link = paidFieldsFromTransactionMatch({
      hash: 'tx-abc',
      date: '2026-05-14',
      amount: -2123.24,
      account: 'barclaycard',
      description: 'HMRC GOV.UK SA',
    });
    expect(link).toEqual({
      paidAmount: 2123.24,
      paidDate: '2026-05-14',
      paidFromAccount: 'barclaycard',
      paidFromTxHash: 'tx-abc',
    });
  });
});
