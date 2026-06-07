import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import {
  toApiObligation,
  COMPLETED_STATUSES,
  getAllObligations,
  getOverdueObligations,
} from './obligations.js';

let testDb: Database.Database;

vi.mock('../connection.js', () => ({
  getDb: () => testDb,
  OBLIGATIONS_DIR: '/tmp/test-obligations',
}));

describe('obligations repository', () => {
  describe('toApiObligation', () => {
    it('maps snake_case DB row to camelCase API shape', () => {
      const row = {
        id: 'test-1',
        source: 'manual',
        type: 'vat',
        name: 'VAT Q1',
        entity: 'HMRC',
        frequency: 'quarterly',
        expected_amount: 5000,
        naive_amount: null,
        adjustment_basis: null,
        adjustment_source: null,
        due_date: '2025-03-07',
        status: 'pending',
        paid_amount: null,
        paid_date: null,
        paid_from_account: null,
        paid_from_tx_hash: null,
        notes: 'test notes',
        person_id: null,
        created_at: '2025-01-01',
        updated_at: '2025-01-01',
      };
      const result = toApiObligation(row);
      expect(result.id).toBe('test-1');
      expect(result.source).toBe('manual');
      expect(result.expectedAmount).toBe(5000);
      expect(result.dueDate).toBe('2025-03-07');
      expect(result.paidAmount).toBeNull();
      expect(result.paidFromAccount).toBeNull();
      expect(result.notes).toBe('test notes');
      expect(result.personId).toBeNull();
      expect(result.createdAt).toBe('2025-01-01');
    });

    it('maps auto-derived obligation with payment info', () => {
      const row = {
        id: 'auto-vat-2025-02-01',
        source: 'auto',
        type: 'vat',
        name: 'VAT Feb-Apr 2025',
        entity: 'HMRC',
        frequency: 'quarterly',
        expected_amount: 1000,
        naive_amount: null,
        adjustment_basis: null,
        adjustment_source: null,
        due_date: '2025-06-07',
        status: 'paid',
        paid_amount: 1000,
        paid_date: '2025-06-01',
        paid_from_account: 'barclays-current',
        paid_from_tx_hash: null,
        notes: null,
        person_id: null,
        created_at: '2025-06-15',
        updated_at: '2025-06-15',
      };
      const result = toApiObligation(row);
      expect(result.source).toBe('auto');
      expect(result.paidAmount).toBe(1000);
      expect(result.paidFromAccount).toBe('barclays-current');
      expect(result.status).toBe('paid');
    });

    it('exposes COMPLETED_STATUSES constant covering paid/confirmed', () => {
      expect([...COMPLETED_STATUSES]).toEqual(['paid', 'confirmed']);
    });

    it('preserves null fields', () => {
      const row = {
        id: 'test-2',
        source: 'manual',
        type: 'other',
        name: 'Test',
        entity: 'Entity',
        frequency: 'one-off',
        expected_amount: null,
        naive_amount: null,
        adjustment_basis: null,
        adjustment_source: null,
        due_date: null,
        status: 'pending',
        paid_amount: null,
        paid_date: null,
        paid_from_account: null,
        paid_from_tx_hash: null,
        notes: null,
        person_id: null,
        created_at: null,
        updated_at: null,
      };
      const result = toApiObligation(row);
      expect(result.expectedAmount).toBeNull();
      expect(result.dueDate).toBeNull();
      expect(result.paidAmount).toBeNull();
      expect(result.paidDate).toBeNull();
      expect(result.paidFromAccount).toBeNull();
      expect(result.notes).toBeNull();
      expect(result.personId).toBeNull();
      expect(result.createdAt).toBeNull();
      expect(result.updatedAt).toBeNull();
    });

    it('propagates person_id for Self Assessment rows', () => {
      const row = {
        id: 'auto-sa-david-2026-01-31',
        source: 'auto',
        type: 'self-assessment',
        name: 'Self Assessment — David (2025/26)',
        entity: 'HMRC',
        frequency: 'annual',
        expected_amount: 11430,
        naive_amount: null,
        adjustment_basis: null,
        adjustment_source: null,
        due_date: '2026-01-31',
        status: 'pending',
        paid_amount: null,
        paid_date: null,
        paid_from_account: null,
        paid_from_tx_hash: null,
        notes: null,
        person_id: 'david',
        created_at: null,
        updated_at: null,
      };
      const result = toApiObligation(row);
      expect(result.personId).toBe('david');
      expect(result.type).toBe('self-assessment');
    });
  });
});

// --------------------------------------------------------------------------
// DB-backed tests for getOverdueObligations + getAllObligations filters.
// Uses the same in-memory SQLite harness pattern as tax-account-scoping.test.ts.
// --------------------------------------------------------------------------

function createObligationsSchema(): void {
  testDb.exec(`
    CREATE TABLE IF NOT EXISTS financial_obligations (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      entity TEXT NOT NULL,
      frequency TEXT NOT NULL,
      expected_amount REAL,
      naive_amount REAL,
      adjustment_basis TEXT,
      adjustment_source TEXT,
      due_date TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      paid_amount REAL,
      paid_date TEXT,
      paid_from_account TEXT,
      paid_from_tx_hash TEXT,
      notes TEXT,
      person_id TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function insertObligation(o: {
  id: string;
  source?: string;
  type?: string;
  name?: string;
  entity?: string;
  frequency?: string;
  dueDate: string | null;
  status: string;
  expectedAmount?: number;
}): void {
  testDb.prepare(`
    INSERT INTO financial_obligations
      (id, source, type, name, entity, frequency, expected_amount, naive_amount, adjustment_basis, adjustment_source, due_date, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)
  `).run(
    o.id,
    o.source ?? 'manual',
    o.type ?? 'other',
    o.name ?? o.id,
    o.entity ?? 'HMRC',
    o.frequency ?? 'one-off',
    o.expectedAmount ?? 100,
    o.dueDate,
    o.status,
  );
}

const YESTERDAY = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const TODAY = new Date().toISOString().slice(0, 10);
const NEXT_WEEK = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

describe('getOverdueObligations + getAllObligations filters', () => {
  beforeAll(() => {
    testDb = new Database(':memory:');
    createObligationsSchema();
  });

  afterAll(() => {
    testDb.close();
  });

  beforeEach(() => {
    testDb.exec('DELETE FROM financial_obligations');
  });

  describe('getOverdueObligations', () => {
    it('returns only past-due rows with status NOT IN COMPLETED_STATUSES', () => {
      insertObligation({ id: 'o-overdue-pending', dueDate: YESTERDAY, status: 'pending' });
      insertObligation({ id: 'o-overdue-paid', dueDate: YESTERDAY, status: 'paid' });
      insertObligation({ id: 'o-overdue-confirmed', dueDate: YESTERDAY, status: 'confirmed' });
      insertObligation({ id: 'o-overdue-unpaid', dueDate: YESTERDAY, status: 'unpaid' });
      insertObligation({ id: 'o-future-pending', dueDate: NEXT_WEEK, status: 'pending' });
      insertObligation({ id: 'o-today-pending', dueDate: TODAY, status: 'pending' });

      const rows = getOverdueObligations();
      const ids = rows.map(r => r.id).sort();
      expect(ids).toEqual(['o-overdue-pending', 'o-overdue-unpaid']);
    });

    it('returns rows ordered by due_date ascending', () => {
      const d1 = '2024-01-01';
      const d2 = '2024-06-01';
      const d3 = '2024-12-01';
      insertObligation({ id: 'c', dueDate: d3, status: 'pending' });
      insertObligation({ id: 'a', dueDate: d1, status: 'pending' });
      insertObligation({ id: 'b', dueDate: d2, status: 'pending' });

      const rows = getOverdueObligations();
      expect(rows.map(r => r.id)).toEqual(['a', 'b', 'c']);
    });

    it('excludes rows with null due_date', () => {
      insertObligation({ id: 'null-due', dueDate: null, status: 'pending' });
      const rows = getOverdueObligations();
      expect(rows).toHaveLength(0);
    });

    it('applies an inclusive minDueDate lower bound to drop settled-history rows', () => {
      const recent = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const ancient = '2020-01-01';
      insertObligation({ id: 'ancient', dueDate: ancient, status: 'pending' });
      insertObligation({ id: 'recent', dueDate: recent, status: 'pending' });

      const rows = getOverdueObligations({ minDueDate: recent });
      expect(rows.map(r => r.id)).toEqual(['recent']);
    });

    it('minDueDate is inclusive (equal dates pass through)', () => {
      const boundary = '2024-04-16';
      insertObligation({ id: 'on-boundary', dueDate: boundary, status: 'pending' });
      const rows = getOverdueObligations({ minDueDate: boundary });
      expect(rows.map(r => r.id)).toEqual(['on-boundary']);
    });
  });

  describe('getAllObligations with hideCompleted', () => {
    it('default call (no flag) returns all statuses', () => {
      insertObligation({ id: 'a', dueDate: YESTERDAY, status: 'pending' });
      insertObligation({ id: 'b', dueDate: YESTERDAY, status: 'paid' });
      insertObligation({ id: 'c', dueDate: YESTERDAY, status: 'confirmed' });

      const rows = getAllObligations();
      expect(rows.map(r => r.id).sort()).toEqual(['a', 'b', 'c']);
    });

    it('excludes paid/confirmed rows when hideCompleted is true', () => {
      insertObligation({ id: 'a', dueDate: YESTERDAY, status: 'pending' });
      insertObligation({ id: 'b', dueDate: YESTERDAY, status: 'paid' });
      insertObligation({ id: 'c', dueDate: YESTERDAY, status: 'confirmed' });
      insertObligation({ id: 'd', dueDate: YESTERDAY, status: 'overdue' });

      const rows = getAllObligations({ hideCompleted: true });
      expect(rows.map(r => r.id).sort()).toEqual(['a', 'd']);
    });
  });

  describe('getAllObligations with financialYear', () => {
    it('returns only rows whose due_date falls in May-Apr of the given FY', () => {
      insertObligation({ id: 'before', dueDate: '2025-04-30', status: 'pending' });
      insertObligation({ id: 'start', dueDate: '2025-05-01', status: 'pending' });
      insertObligation({ id: 'mid', dueDate: '2025-10-15', status: 'pending' });
      insertObligation({ id: 'end', dueDate: '2026-04-30', status: 'pending' });
      insertObligation({ id: 'after', dueDate: '2026-05-01', status: 'pending' });

      const rows = getAllObligations({ financialYear: '2025/26' });
      expect(rows.map(r => r.id).sort()).toEqual(['end', 'mid', 'start']);
    });

    it('combines cleanly with hideCompleted', () => {
      insertObligation({ id: 'pending-fy', dueDate: '2025-06-01', status: 'pending' });
      insertObligation({ id: 'paid-fy', dueDate: '2025-06-01', status: 'paid' });
      insertObligation({ id: 'pending-other', dueDate: '2024-06-01', status: 'pending' });

      const rows = getAllObligations({ hideCompleted: true, financialYear: '2025/26' });
      expect(rows.map(r => r.id)).toEqual(['pending-fy']);
    });
  });

  describe('getAllObligations with minDueDate / maxDueDate', () => {
    it('applies an explicit range on due_date', () => {
      insertObligation({ id: 'before', dueDate: '2025-04-15', status: 'pending' });
      insertObligation({ id: 'in-start', dueDate: '2025-04-16', status: 'pending' });
      insertObligation({ id: 'in-mid', dueDate: '2026-01-01', status: 'pending' });
      insertObligation({ id: 'in-end', dueDate: '2027-04-16', status: 'pending' });
      insertObligation({ id: 'after', dueDate: '2027-04-17', status: 'pending' });

      const rows = getAllObligations({
        minDueDate: '2025-04-16',
        maxDueDate: '2027-04-16',
      });
      expect(rows.map(r => r.id)).toEqual(['in-start', 'in-mid', 'in-end']);
    });

    it('minDueDate alone acts as an open-ended lower bound', () => {
      insertObligation({ id: 'before', dueDate: '2024-12-31', status: 'pending' });
      insertObligation({ id: 'at', dueDate: '2025-01-01', status: 'pending' });
      insertObligation({ id: 'after', dueDate: '2025-06-01', status: 'pending' });

      const rows = getAllObligations({ minDueDate: '2025-01-01' });
      expect(rows.map(r => r.id).sort()).toEqual(['after', 'at']);
    });

    it('maxDueDate alone acts as an open-ended upper bound', () => {
      insertObligation({ id: 'before', dueDate: '2024-12-31', status: 'pending' });
      insertObligation({ id: 'at', dueDate: '2025-01-01', status: 'pending' });
      insertObligation({ id: 'after', dueDate: '2025-06-01', status: 'pending' });

      const rows = getAllObligations({ maxDueDate: '2025-01-01' });
      expect(rows.map(r => r.id).sort()).toEqual(['at', 'before']);
    });

    it('explicit range overrides financialYear when both are supplied', () => {
      insertObligation({ id: 'in-fy', dueDate: '2025-06-01', status: 'pending' });
      insertObligation({ id: 'outside-fy-in-range', dueDate: '2027-03-01', status: 'pending' });

      const rows = getAllObligations({
        financialYear: '2025/26',
        minDueDate: '2026-06-01',
        maxDueDate: '2027-06-01',
      });
      // If the FY branch ran, we'd see `in-fy`. Explicit range wins.
      expect(rows.map(r => r.id)).toEqual(['outside-fy-in-range']);
    });

    it('combines with hideCompleted', () => {
      insertObligation({ id: 'pending-in', dueDate: '2025-06-01', status: 'pending' });
      insertObligation({ id: 'paid-in', dueDate: '2025-06-01', status: 'paid' });
      insertObligation({ id: 'pending-out', dueDate: '2022-01-01', status: 'pending' });

      const rows = getAllObligations({
        hideCompleted: true,
        minDueDate: '2025-01-01',
        maxDueDate: '2026-01-01',
      });
      expect(rows.map(r => r.id)).toEqual(['pending-in']);
    });
  });
});
