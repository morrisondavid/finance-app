/**
 * Merchant modal drill: SQL predicates must match {@link expenseTxnMatchesMerchantModal}.
 */

import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expenseTxnMatchesMerchantModal } from './merchant-drill-search.js';
import { buildMerchantModalDescriptionPredicate } from './merchant-modal-description-sql.js';
import type { RawTransaction } from './recurring-pipeline.js';

function registerRegexp(db: Database.Database): void {
  db.function(
    'regexp',
    { deterministic: true },
    (pattern: unknown, text: unknown) => {
      if (typeof pattern !== 'string' || typeof text !== 'string') return 0;
      try {
        const body = pattern.replace(/^\(\?i\)/, '');
        return new RegExp(body, 'i').test(text) ? 1 : 0;
      } catch {
        return 0;
      }
    },
  );
}

function sqlModalMatches(description: string, label: string, db: Database.Database): boolean | null {
  const pred = buildMerchantModalDescriptionPredicate(label);
  if (pred === null) return null;
  const row = db
    .prepare(
      `SELECT CASE WHEN (${pred.clause}) THEN 1 ELSE 0 END AS m FROM (SELECT ? AS description) AS row`,
    )
    .get(...pred.params, description) as { m: number };
  return row.m === 1;
}

function row(description: string, account = 'natwest'): RawTransaction {
  return {
    id: 1,
    date: '2026-01-15',
    description,
    amount: -12.5,
    account,
    type: 'expense',
  };
}

describe('buildMerchantModalDescriptionPredicate parity with expenseTxnMatchesMerchantModal', () => {
  let db: Database.Database;

  beforeAll(() => {
    db = new Database(':memory:');
    registerRegexp(db);
  });

  afterAll(() => {
    db.close();
  });

  const cases: { label: string; description: string }[] = [
    { label: 'Uber Eats', description: 'UBER   *EATS LONDON' },
    { label: 'Uber Eats', description: 'PAYMENT TO UBER*EATS' },
    { label: 'Uber Eats', description: 'UBER BV NOT EATS' },
    { label: 'Netflix', description: 'NETFLIX.COM 866-579-7172 NL' },
    { label: 'EE', description: 'EE LIMITED VIA MOBILE' },
    { label: 'Emirates', description: 'EMIRATES 622 LHR DXB' },
  ];

  for (const { label, description } of cases) {
    it(`label=${label} desc=${description}`, () => {
      const modal = expenseTxnMatchesMerchantModal(row(description), label);
      const sql = sqlModalMatches(description, label, db);
      expect(sql).not.toBeNull();
      expect(sql).toBe(modal);
    });
  }

  it('returns null for labels with no registry entry (caller uses JS fallback)', () => {
    const label = '___NoSuchModalLabel_xyz___';
    expect(buildMerchantModalDescriptionPredicate(label)).toBeNull();
    expect(expenseTxnMatchesMerchantModal(row('FOO'), label)).toBe(false);
  });
});
