import { describe, it, expect, afterAll, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createInMemoryTestDb } from '../../db/test-harness/in-memory-db.js';

const harness = createInMemoryTestDb();

vi.mock('../../db/connection.js', () => ({
  getDb: () => harness.db,
  OBLIGATIONS_DIR: harness.obligationsDir,
}));

const { findObligationPaymentCandidates } = await import('./payment-candidates.js');
const { loadManualObligationsFromCsv } = await import('../../db/repositories/obligations.js');

const MANUAL_SA_ID = 'manual-sa-test-1';

const FILTERS = {
  account: 'barclaycard' as const,
  year: 2026,
  month: 5,
};

afterAll(() => harness.cleanup());

beforeEach(() => {
  harness.db.exec('DELETE FROM transactions; DELETE FROM financial_obligations;');
  const csvPath = path.join(harness.obligationsDir, 'obligations.csv');
  fs.writeFileSync(
    csvPath,
    'id,category,frequency,merchant,display_name,account,amount,currency,notes,ownership_david,ownership_heena,person_id,amount_tolerance,due_date,tax_type\n' +
    `${MANUAL_SA_ID},tax-manual,one-off,HMRC,Self Assessment Tax,,2123.24,GBP,,,,,,2026-01-31,self-assessment,\n`,
    'utf8',
  );
  loadManualObligationsFromCsv();
});

describe('findObligationPaymentCandidates', () => {
  it('returns null when obligation id is unknown', () => {
    expect(findObligationPaymentCandidates('missing-id', FILTERS)).toBeNull();
  });

  it('returns expense transactions on the account within the requested calendar month', () => {
    harness.db.prepare(`
      INSERT INTO transactions (hash, date, description, amount, account, type)
      VALUES ('late-sa', '2026-05-14', 'HMRC GOV.UK SA', -2123.24, 'barclaycard', 'expense')
    `).run();
    harness.db.prepare(`
      INSERT INTO transactions (hash, date, description, amount, account, type)
      VALUES ('other-month', '2026-04-10', 'HMRC GOV.UK SA', -100, 'barclaycard', 'expense')
    `).run();

    const candidates = findObligationPaymentCandidates(MANUAL_SA_ID, FILTERS);
    expect(candidates).toHaveLength(1);
    expect(candidates![0].hash).toBe('late-sa');
    expect(candidates![0].account).toBe('barclaycard');
  });

  it('excludes transactions whose amount is outside tolerance of the obligation expected amount', () => {
    harness.db.prepare(`
      INSERT INTO transactions (hash, date, description, amount, account, type)
      VALUES ('wrong-amt', '2026-05-14', 'HMRC GOV.UK SA', -5000, 'barclaycard', 'expense')
    `).run();
    harness.db.prepare(`
      INSERT INTO transactions (hash, date, description, amount, account, type)
      VALUES ('finance-charge', '2026-05-14', 'FINANCE CHARGE', -30.69, 'barclaycard', 'expense')
    `).run();

    const candidates = findObligationPaymentCandidates(MANUAL_SA_ID, FILTERS);
    expect(candidates).toEqual([]);
  });

  it('includes matching-amount transactions alongside other in-tolerance rows', () => {
    harness.db.prepare(`
      INSERT INTO transactions (hash, date, description, amount, account, type)
      VALUES ('sa-pay', '2026-05-14', 'HMRC GOV.UK SA', -2123.24, 'barclaycard', 'expense')
    `).run();
    harness.db.prepare(`
      INSERT INTO transactions (hash, date, description, amount, account, type)
      VALUES ('near-match', '2026-05-01', 'HMRC GOV.UK SA', -2000, 'barclaycard', 'expense')
    `).run();

    const candidates = findObligationPaymentCandidates(MANUAL_SA_ID, FILTERS);
    expect(candidates!.map(c => c.hash).sort()).toEqual(['near-match', 'sa-pay']);
  });

  it('includes non-expense rows for the account when amount is within tolerance (same surface as dashboard month drill-down)', () => {
    harness.db.prepare(`
      INSERT INTO transactions (hash, date, description, amount, account, type)
      VALUES ('card-payment', '2026-05-01', 'PAYMENT RECEIVED', 2000, 'barclaycard', 'income')
    `).run();
    harness.db.prepare(`
      INSERT INTO transactions (hash, date, description, amount, account, type)
      VALUES ('sa-pay', '2026-05-14', 'HMRC GOV.UK SA', -2123.24, 'barclaycard', 'expense')
    `).run();

    const candidates = findObligationPaymentCandidates(MANUAL_SA_ID, FILTERS);
    expect(candidates).toHaveLength(2);
    expect(candidates!.map(c => c.hash).sort()).toEqual(['card-payment', 'sa-pay']);
  });

  it('excludes transactions on other accounts', () => {
    harness.db.prepare(`
      INSERT INTO transactions (hash, date, description, amount, account, type)
      VALUES ('natwest-pay', '2026-05-14', 'HMRC GOV.UK SA', -2123.24, 'natwest', 'expense')
    `).run();

    const candidates = findObligationPaymentCandidates(MANUAL_SA_ID, FILTERS);
    expect(candidates).toEqual([]);
  });
});
