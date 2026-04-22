import { describe, it, expect, afterAll, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { buildAccountInFilter } from '../utils/tax-account-filter.js';
import {
  vatApplicableAccounts,
  corpTaxApplicableAccounts,
} from '../../domain/accounts/index.js';
import { createInMemoryTestDb } from '../test-harness/in-memory-db.js';

/**
 * Phase-4 regression locks (Roadmap 1.1) — restated on the Phase A3
 * architecture.
 *
 * Drives real SQL against an in-memory SQLite DB to prove, at the
 * query layer, that AED income sitting on the UAE FZCO account cannot
 * contribute to a UK VAT or UK CT aggregate.
 *
 * Under the new architecture the per-account flags (`vat.registered`,
 * `corpTax.qualifyingFreeZone`) already exclude the FZCO account from
 * `vatApplicable` / `corpTaxApplicable`. No separate entity filter is
 * required — and these tests assert that the single index-driven
 * filter still satisfies every invariant the old entity-scoped API
 * asserted.
 */

const harness = createInMemoryTestDb();

vi.mock('../connection.js', () => ({
  getDb: () => harness.db,
  OBLIGATIONS_DIR: harness.obligationsDir,
}));

let hashSeq = 0;
function insertIncome(account: string, date: string, amount: number, description = 'Client payment'): void {
  hashSeq++;
  harness.db.prepare(`
    INSERT INTO transactions (hash, date, description, amount, account, type)
    VALUES (?, ?, ?, ?, ?, 'income')
  `).run(`hash-${hashSeq}`, date, description, amount, account);
}

afterAll(() => {
  harness.cleanup();
});

beforeEach(() => {
  harness.db.exec('DELETE FROM transactions');
  hashSeq = 0;
  const csv = path.join(harness.obligationsDir, 'obligation-dismissals.csv');
  if (fs.existsSync(csv)) fs.unlinkSync(csv);
});

describe('UK VAT SQL excludes AED-denominated FZCO income', () => {
  it('VAT SUM returns 0 when only emirates-islamic has income', () => {
    insertIncome('emirates-islamic', '2026-03-15', 50_000, 'La Fosse weekly payout');

    const filter = buildAccountInFilter(vatApplicableAccounts());
    const row = harness.db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM transactions
      WHERE type = 'income' AND date >= ? AND date <= ? ${filter.clause}
    `).get('2026-01-01', '2026-12-31', ...filter.params) as { total: number };

    expect(row.total).toBe(0);
  });

  it('VAT SUM returns only the UK income when both UK and FZCO accounts have income', () => {
    insertIncome('barclays-current', '2026-03-15', 12_000, 'Delta Capita invoice');
    insertIncome('emirates-islamic', '2026-03-15', 50_000, 'La Fosse invoice');

    const filter = buildAccountInFilter(vatApplicableAccounts());
    const row = harness.db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM transactions
      WHERE type = 'income' AND date >= ? AND date <= ? ${filter.clause}
    `).get('2026-01-01', '2026-12-31', ...filter.params) as { total: number };

    expect(row.total).toBe(12_000);
  });

  it('VAT filter params never contain the FZCO account', () => {
    const filter = buildAccountInFilter(vatApplicableAccounts());
    expect(filter.params).not.toContain('emirates-islamic');
  });
});

describe('UK CT SQL excludes AED-denominated FZCO income', () => {
  it('CT SUM returns 0 when only emirates-islamic has income', () => {
    insertIncome('emirates-islamic', '2026-03-15', 50_000);

    const filter = buildAccountInFilter(corpTaxApplicableAccounts());
    const row = harness.db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM transactions
      WHERE type = 'income' AND date >= ? AND date <= ? ${filter.clause}
    `).get('2026-01-01', '2026-12-31', ...filter.params) as { total: number };

    expect(row.total).toBe(0);
  });

  it('CT SUM returns only the UK income when both UK and FZCO accounts have income', () => {
    insertIncome('barclays-current', '2026-03-15', 12_000);
    insertIncome('emirates-islamic', '2026-03-15', 50_000);

    const filter = buildAccountInFilter(corpTaxApplicableAccounts());
    const row = harness.db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM transactions
      WHERE type = 'income' AND date >= ? AND date <= ? ${filter.clause}
    `).get('2026-01-01', '2026-12-31', ...filter.params) as { total: number };

    expect(row.total).toBe(12_000);
  });

  it('CT filter params never contain the FZCO account', () => {
    const filter = buildAccountInFilter(corpTaxApplicableAccounts());
    expect(filter.params).not.toContain('emirates-islamic');
  });
});

describe('Inter-company regression — no amount or narrative can bypass the entity gate', () => {
  it.each([
    { desc: 'Client payment from La Fosse', amount: 100_000 },
    { desc: 'Edwin Group consulting fee', amount: 25_000 },
    { desc: 'HMRC VAT SOUTHEND', amount: 50_000 },
    { desc: 'Delta Capita Group Limited', amount: 15_000 },
  ])('FZCO row with description="$desc" amount=$amount never contributes to UK aggregates', ({ desc, amount }) => {
    insertIncome('emirates-islamic', '2026-06-15', amount, desc);

    const vatFilter = buildAccountInFilter(vatApplicableAccounts());
    const ctFilter = buildAccountInFilter(corpTaxApplicableAccounts());

    const vat = harness.db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total FROM transactions WHERE type = 'income' ${vatFilter.clause}
    `).get(...vatFilter.params) as { total: number };
    const ct = harness.db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total FROM transactions WHERE type = 'income' ${ctFilter.clause}
    `).get(...ctFilter.params) as { total: number };

    expect(vat.total).toBe(0);
    expect(ct.total).toBe(0);
  });
});
