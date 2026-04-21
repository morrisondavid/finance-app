import { describe, it, expect, afterAll, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createInMemoryTestDb } from '../test-harness/in-memory-db.js';

/**
 * SA auto-seed integration tests.
 *
 * We point the real module at an in-memory SQLite via a vi.mock on
 * ../connection.js so the seed function's full path — including the
 * estimate query, the POA2 halving, and the manual-supersede gate — runs
 * end-to-end. This mirrors the pattern used by `tax-account-scoping.test.ts`.
 */

const harness = createInMemoryTestDb();

vi.mock('../connection.js', () => ({
  getDb: () => harness.db,
  OBLIGATIONS_DIR: harness.obligationsDir,
}));

const {
  deriveAndInsertAutoSaObligations,
  enumerateSaSlots,
  MANUAL_SUPERSEDE_WINDOW_DAYS,
} = await import('./sa-auto-seed.js');

const { addDismissal, removeDismissal } = await import('./obligation-dismissals.js');

let hashSeq = 0;
function insertDividend(date: string, who: 'DAVID MORRISON' | 'HEENA TAILOR', amount: number): void {
  hashSeq++;
  harness.db.prepare(`
    INSERT INTO transactions (hash, date, description, amount, account, type)
    VALUES (?, ?, ?, ?, 'barclays-current', 'expense')
  `).run(`hash-${hashSeq}`, date, `${who} DIVIDEND`, -amount);
}

function insertSaPayment(opts: { date: string; amount: number; account: string; description?: string }): void {
  hashSeq++;
  harness.db.prepare(`
    INSERT INTO transactions (hash, date, description, amount, account, type)
    VALUES (?, ?, ?, ?, ?, 'expense')
  `).run(
    `sa-hash-${hashSeq}`,
    opts.date,
    opts.description ?? 'HMRC GOV.UK SA',
    -Math.abs(opts.amount),
    opts.account,
  );
}

function insertManualSaObligation(opts: {
  id: string;
  personId: string;
  dueDate: string;
  expectedAmount?: number;
}): void {
  harness.db.prepare(`
    INSERT INTO financial_obligations
      (id, source, type, name, entity, frequency, expected_amount, due_date, status, person_id)
    VALUES (?, 'manual', 'self-assessment', 'SA manual', 'HMRC', 'annual', ?, ?, 'pending', ?)
  `).run(opts.id, opts.expectedAmount ?? 1000, opts.dueDate, opts.personId);
}

afterAll(() => {
  harness.cleanup();
});
beforeEach(() => {
  harness.db.exec('DELETE FROM transactions');
  harness.db.exec('DELETE FROM financial_obligations');
  harness.db.exec('DELETE FROM obligation_dismissals');
  hashSeq = 0;
  // Repo also syncs to a CSV in the obligations temp dir; drop it between
  // tests so stale dismissals from a previous test don't leak back in.
  const csvPath = path.join(harness.obligationsDir, 'obligation-dismissals.csv');
  if (fs.existsSync(csvPath)) fs.unlinkSync(csvPath);
});

describe('enumerateSaSlots', () => {
  it('emits both Jan and Jul slots per filer within the window', () => {
    const slots = enumerateSaSlots(new Date('2025-06-15'));
    const kinds = new Set(slots.map(s => s.kind));
    expect(kinds).toContain('jan');
    expect(kinds).toContain('jul');
    expect(new Set(slots.map(s => s.personId))).toEqual(new Set(['david', 'heena']));
  });

  it('dates are sorted ascending', () => {
    const slots = enumerateSaSlots(new Date('2025-06-15'));
    const sorted = [...slots].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    expect(slots.map(s => s.dueDate)).toEqual(sorted.map(s => s.dueDate));
  });
});

describe('deriveAndInsertAutoSaObligations', () => {
  it('is a no-op when there are no taxable transactions (zero estimate → skip)', () => {
    deriveAndInsertAutoSaObligations();
    const rows = harness.db.prepare(
      "SELECT * FROM financial_obligations WHERE source = 'auto' AND type = 'self-assessment'"
    ).all();
    expect(rows).toHaveLength(0);
  });

  it('seeds one auto row per slot with non-zero estimate', () => {
    insertDividend('2023-10-01', 'DAVID MORRISON', 60000);
    insertDividend('2024-10-01', 'DAVID MORRISON', 60000);

    deriveAndInsertAutoSaObligations();

    const rows = harness.db.prepare(`
      SELECT id, person_id, due_date, expected_amount FROM financial_obligations
      WHERE source = 'auto' AND type = 'self-assessment'
      ORDER BY due_date ASC
    `).all() as Array<{ id: string; person_id: string; due_date: string; expected_amount: number }>;

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.person_id).toBe('david');
      expect(row.expected_amount).toBeGreaterThan(0);
      expect(row.id).toBe(`auto-sa-${row.person_id}-${row.due_date}`);
    }
  });

  it('POA2 (Jul) expected amount is ~50% of the January slot for the same tax year', () => {
    insertDividend('2024-10-01', 'DAVID MORRISON', 60000);

    deriveAndInsertAutoSaObligations();

    const rows = harness.db.prepare(`
      SELECT id, due_date, expected_amount FROM financial_obligations
      WHERE source = 'auto' AND type = 'self-assessment' AND person_id = 'david'
    `).all() as Array<{ id: string; due_date: string; expected_amount: number }>;

    const jan2026 = rows.find(r => r.due_date === '2026-01-31');
    const jul2026 = rows.find(r => r.due_date === '2026-07-31');

    expect(jan2026).toBeDefined();
    expect(jul2026).toBeDefined();
    expect(jul2026!.expected_amount).toBeCloseTo(jan2026!.expected_amount * 0.5, 1);
  });

  it('suppresses auto row when a manual SA obligation exists within the supersede window', () => {
    insertDividend('2024-10-01', 'DAVID MORRISON', 60000);

    deriveAndInsertAutoSaObligations();
    const before = harness.db.prepare(`
      SELECT due_date FROM financial_obligations
      WHERE source = 'auto' AND type = 'self-assessment' AND person_id = 'david'
    `).all() as Array<{ due_date: string }>;
    expect(before.length).toBeGreaterThan(0);

    const targetDue = before[0].due_date;
    insertManualSaObligation({ id: 'manual-1', personId: 'david', dueDate: targetDue });

    deriveAndInsertAutoSaObligations();

    const after = harness.db.prepare(`
      SELECT due_date FROM financial_obligations
      WHERE source = 'auto' AND type = 'self-assessment' AND person_id = 'david'
    `).all() as Array<{ due_date: string }>;

    expect(after.some(r => r.due_date === targetDue)).toBe(false);
  });

  it('does NOT suppress when manual obligation is for a different person', () => {
    insertDividend('2024-10-01', 'DAVID MORRISON', 60000);

    deriveAndInsertAutoSaObligations();
    const before = harness.db.prepare(`
      SELECT due_date FROM financial_obligations
      WHERE source = 'auto' AND type = 'self-assessment' AND person_id = 'david'
    `).all() as Array<{ due_date: string }>;
    expect(before.length).toBeGreaterThan(0);

    const targetDue = before[0].due_date;
    insertManualSaObligation({ id: 'manual-heena', personId: 'heena', dueDate: targetDue });

    deriveAndInsertAutoSaObligations();

    const after = harness.db.prepare(`
      SELECT due_date FROM financial_obligations
      WHERE source = 'auto' AND type = 'self-assessment' AND person_id = 'david'
    `).all() as Array<{ due_date: string }>;

    expect(after.some(r => r.due_date === targetDue)).toBe(true);
  });

  it('supersede window is inclusive of MANUAL_SUPERSEDE_WINDOW_DAYS', () => {
    insertDividend('2024-10-01', 'DAVID MORRISON', 60000);

    deriveAndInsertAutoSaObligations();
    const before = harness.db.prepare(`
      SELECT due_date FROM financial_obligations
      WHERE source = 'auto' AND type = 'self-assessment' AND person_id = 'david'
    `).all() as Array<{ due_date: string }>;
    expect(before.length).toBeGreaterThan(0);

    const autoDue = new Date(`${before[0].due_date}T00:00:00`);
    const withinDate = new Date(autoDue);
    withinDate.setDate(withinDate.getDate() - (MANUAL_SUPERSEDE_WINDOW_DAYS - 1));
    const withinIso = withinDate.toISOString().slice(0, 10);

    insertManualSaObligation({ id: 'manual-within', personId: 'david', dueDate: withinIso });
    deriveAndInsertAutoSaObligations();

    const after = harness.db.prepare(`
      SELECT due_date FROM financial_obligations
      WHERE source = 'auto' AND type = 'self-assessment' AND person_id = 'david'
    `).all() as Array<{ due_date: string }>;

    expect(after.some(r => r.due_date === before[0].due_date)).toBe(false);
  });

  it('rebuilds from scratch each run (deletes prior auto rows)', () => {
    insertDividend('2024-10-01', 'DAVID MORRISON', 60000);
    deriveAndInsertAutoSaObligations();
    const firstCount = harness.db.prepare(
      "SELECT COUNT(*) as c FROM financial_obligations WHERE source = 'auto' AND type = 'self-assessment'"
    ).get() as { c: number };

    deriveAndInsertAutoSaObligations();
    const secondCount = harness.db.prepare(
      "SELECT COUNT(*) as c FROM financial_obligations WHERE source = 'auto' AND type = 'self-assessment'"
    ).get() as { c: number };

    expect(secondCount.c).toBe(firstCount.c);
  });

  describe('dismissals', () => {
    it('skips a slot whose id is in obligation_dismissals', () => {
      insertDividend('2024-10-01', 'DAVID MORRISON', 60000);

      deriveAndInsertAutoSaObligations();
      const before = harness.db.prepare(`
        SELECT id FROM financial_obligations
        WHERE source = 'auto' AND type = 'self-assessment' AND person_id = 'david'
        ORDER BY due_date ASC
      `).all() as Array<{ id: string }>;
      expect(before.length).toBeGreaterThan(0);

      const toHide = before[0].id;
      addDismissal({ obligationId: toHide, reason: 'Non-resident' });

      deriveAndInsertAutoSaObligations();
      const after = harness.db.prepare(`
        SELECT id FROM financial_obligations
        WHERE source = 'auto' AND type = 'self-assessment' AND person_id = 'david'
      `).all() as Array<{ id: string }>;

      expect(after.some(r => r.id === toHide)).toBe(false);
    });

    it('undismiss brings the slot back on the next run', () => {
      insertDividend('2024-10-01', 'DAVID MORRISON', 60000);

      deriveAndInsertAutoSaObligations();
      const before = harness.db.prepare(`
        SELECT id FROM financial_obligations
        WHERE source = 'auto' AND type = 'self-assessment' AND person_id = 'david'
        ORDER BY due_date ASC
      `).all() as Array<{ id: string }>;

      const id = before[0].id;
      addDismissal({ obligationId: id });
      deriveAndInsertAutoSaObligations();
      removeDismissal(id);
      deriveAndInsertAutoSaObligations();

      const after = harness.db.prepare(`
        SELECT id FROM financial_obligations
        WHERE source = 'auto' AND type = 'self-assessment' AND person_id = 'david'
      `).all() as Array<{ id: string }>;

      expect(after.some(r => r.id === id)).toBe(true);
    });

    it('only hides the specific dismissed slot, not the other person or year', () => {
      insertDividend('2024-10-01', 'DAVID MORRISON', 60000);
      insertDividend('2024-10-01', 'HEENA TAILOR', 60000);

      deriveAndInsertAutoSaObligations();
      const davidRow = harness.db.prepare(`
        SELECT id FROM financial_obligations
        WHERE source = 'auto' AND type = 'self-assessment' AND person_id = 'david'
        ORDER BY due_date ASC LIMIT 1
      `).get() as { id: string } | undefined;
      expect(davidRow).toBeDefined();

      addDismissal({ obligationId: davidRow!.id });
      deriveAndInsertAutoSaObligations();

      const heenaRows = harness.db.prepare(`
        SELECT id FROM financial_obligations
        WHERE source = 'auto' AND type = 'self-assessment' AND person_id = 'heena'
      `).all() as Array<{ id: string }>;
      expect(heenaRows.length).toBeGreaterThan(0);
    });
  });

  describe('payment attribution', () => {
    it('matches SA payments made from a personal account (NatWest) to the corresponding slot', () => {
      insertDividend('2024-10-01', 'DAVID MORRISON', 60000);

      deriveAndInsertAutoSaObligations();
      const janSlot = harness.db.prepare(`
        SELECT id, due_date FROM financial_obligations
        WHERE source = 'auto' AND type = 'self-assessment' AND person_id = 'david'
        ORDER BY due_date ASC LIMIT 1
      `).get() as { id: string; due_date: string } | undefined;
      expect(janSlot).toBeDefined();

      insertSaPayment({ date: janSlot!.due_date, amount: 4321.5, account: 'natwest' });
      deriveAndInsertAutoSaObligations();

      const row = harness.db.prepare(`
        SELECT status, paid_amount, paid_date, paid_from_account FROM financial_obligations
        WHERE id = ?
      `).get(janSlot!.id) as { status: string; paid_amount: number; paid_date: string; paid_from_account: string };

      expect(row.status).toBe('paid');
      expect(row.paid_amount).toBeCloseTo(4321.5, 2);
      expect(row.paid_date).toBe(janSlot!.due_date);
      expect(row.paid_from_account).toBe('natwest');
    });

    it('matches SA payments made from a business account (barclays-current) to the corresponding slot', () => {
      insertDividend('2024-10-01', 'DAVID MORRISON', 60000);

      deriveAndInsertAutoSaObligations();
      const janSlot = harness.db.prepare(`
        SELECT id, due_date FROM financial_obligations
        WHERE source = 'auto' AND type = 'self-assessment' AND person_id = 'david'
        ORDER BY due_date ASC LIMIT 1
      `).get() as { id: string; due_date: string } | undefined;
      expect(janSlot).toBeDefined();

      insertSaPayment({ date: janSlot!.due_date, amount: 999.99, account: 'barclays-current' });
      deriveAndInsertAutoSaObligations();

      const row = harness.db.prepare(`
        SELECT status, paid_from_account FROM financial_obligations WHERE id = ?
      `).get(janSlot!.id) as { status: string; paid_from_account: string };

      expect(row.status).toBe('paid');
      expect(row.paid_from_account).toBe('barclays-current');
    });

    it('leaves status pending when no SA payment lands within ±SA_MATCH_PROXIMITY_DAYS', () => {
      insertDividend('2024-10-01', 'DAVID MORRISON', 60000);

      deriveAndInsertAutoSaObligations();
      const janSlot = harness.db.prepare(`
        SELECT id, due_date FROM financial_obligations
        WHERE source = 'auto' AND type = 'self-assessment' AND person_id = 'david'
        ORDER BY due_date ASC LIMIT 1
      `).get() as { id: string; due_date: string } | undefined;
      expect(janSlot).toBeDefined();

      // 120 days before due date — well outside the ±60 window.
      const far = new Date(`${janSlot!.due_date}T00:00:00`);
      far.setDate(far.getDate() - 120);
      insertSaPayment({ date: far.toISOString().slice(0, 10), amount: 500, account: 'natwest' });

      deriveAndInsertAutoSaObligations();
      const row = harness.db.prepare(`
        SELECT status, paid_amount, paid_from_account FROM financial_obligations WHERE id = ?
      `).get(janSlot!.id) as { status: string; paid_amount: number | null; paid_from_account: string | null };

      expect(row.status).toBe('pending');
      expect(row.paid_amount).toBeNull();
      expect(row.paid_from_account).toBeNull();
    });
  });
});
