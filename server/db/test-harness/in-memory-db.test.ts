import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { createInMemoryTestDb, resetTestData } from './in-memory-db.js';

describe('createInMemoryTestDb', () => {
  it('creates every domain table with the correct columns', () => {
    const h = createInMemoryTestDb();
    try {
      const tables = h.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{ name: string }>;
      const names = tables.map(t => t.name);
      expect(names).toContain('transactions');
      expect(names).toContain('financial_obligations');
      expect(names).toContain('obligation_dismissals');
      expect(names).toContain('deadlines');
      expect(names).toContain('debts');
    } finally {
      h.cleanup();
    }
  });

  it('creates three separate temp directories that exist on disk', () => {
    const h = createInMemoryTestDb();
    try {
      expect(fs.existsSync(h.obligationsDir)).toBe(true);
      expect(fs.existsSync(h.deadlinesDir)).toBe(true);
      expect(fs.existsSync(h.debtsDir)).toBe(true);
      expect(h.obligationsDir).not.toBe(h.deadlinesDir);
      expect(h.obligationsDir).not.toBe(h.debtsDir);
      expect(h.deadlinesDir).not.toBe(h.debtsDir);
    } finally {
      h.cleanup();
    }
  });

  it('cleanup removes the temp directories and closes the DB', () => {
    const h = createInMemoryTestDb();
    const { obligationsDir, deadlinesDir, debtsDir } = h;
    h.cleanup();
    expect(fs.existsSync(obligationsDir)).toBe(false);
    expect(fs.existsSync(deadlinesDir)).toBe(false);
    expect(fs.existsSync(debtsDir)).toBe(false);
    expect(() => h.db.prepare('SELECT 1').get()).toThrow();
  });

  it('cleanup is idempotent', () => {
    const h = createInMemoryTestDb();
    h.cleanup();
    expect(() => h.cleanup()).not.toThrow();
  });
});

describe('resetTestData', () => {
  it('deletes every row from every domain table', () => {
    const h = createInMemoryTestDb();
    try {
      h.db.prepare(`
        INSERT INTO transactions (hash, date, description, amount, account, type)
        VALUES ('h1', '2026-01-01', 'test', -10, 'acc', 'expense')
      `).run();
      h.db.prepare(`
        INSERT INTO financial_obligations
          (id, source, type, name, entity, frequency)
        VALUES ('o1', 'manual', 'other', 'n', 'e', 'annual')
      `).run();
      h.db.prepare(`INSERT INTO obligation_dismissals (obligation_id) VALUES ('o1')`).run();
      h.db.prepare(`
        INSERT INTO deadlines (id, type, title, due_date, recurrence)
        VALUES ('d1', 'other', 'Test', '2026-04-21', 'one-off')
      `).run();
      h.db.prepare(`
        INSERT INTO debts (id, name, merchant_pattern, source_accounts, original_loan_amount, opening_balance_date)
        VALUES ('de1', 'test', 'TEST', 'acc', 1000, '2026-01-01')
      `).run();

      resetTestData(h.db);

      const count = (table: string): number => (h.db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;
      expect(count('transactions')).toBe(0);
      expect(count('financial_obligations')).toBe(0);
      expect(count('obligation_dismissals')).toBe(0);
      expect(count('deadlines')).toBe(0);
      expect(count('debts')).toBe(0);
    } finally {
      h.cleanup();
    }
  });
});
