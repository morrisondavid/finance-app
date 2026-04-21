import { describe, it, expect, afterAll, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createInMemoryTestDb } from '../test-harness/in-memory-db.js';

/**
 * Corporation Tax auto-seed integration tests.
 *
 * Mirrors the `sa-auto-seed.test.ts` harness: an in-memory SQLite
 * substitutes the real DB via a `vi.mock` on `../connection.js`, so the
 * full seed path — enumeration, income-sum, CT computation, payment
 * matching, manual-supersede gate, and dismissal — executes end-to-end.
 */

const harness = createInMemoryTestDb();

vi.mock('../connection.js', () => ({
  getDb: () => harness.db,
  OBLIGATIONS_DIR: harness.obligationsDir,
}));

const {
  deriveAndInsertAutoCtObligations,
  enumerateCtSlots,
  CT_MATCH_PROXIMITY_DAYS,
  CT_MANUAL_SUPERSEDE_WINDOW_DAYS,
} = await import('./ct-auto-seed.js');

const { addDismissal } = await import('./obligation-dismissals.js');

let hashSeq = 0;
function insertIncome(opts: { date: string; amount: number; account?: string; description?: string }): void {
  hashSeq++;
  harness.db.prepare(`
    INSERT INTO transactions (hash, date, description, amount, account, type)
    VALUES (?, ?, ?, ?, ?, 'income')
  `).run(
    `inc-${hashSeq}`,
    opts.date,
    opts.description ?? 'Client invoice',
    Math.abs(opts.amount),
    opts.account ?? 'barclays-current',
  );
}

function insertCtPayment(opts: { date: string; amount: number; account?: string; description?: string }): void {
  hashSeq++;
  harness.db.prepare(`
    INSERT INTO transactions (hash, date, description, amount, account, type)
    VALUES (?, ?, ?, ?, ?, 'expense')
  `).run(
    `ct-${hashSeq}`,
    opts.date,
    opts.description ?? 'HMRC CORPORATION T',
    -Math.abs(opts.amount),
    opts.account ?? 'barclays-current',
  );
}

function insertManualCtObligation(opts: { id: string; dueDate: string; expectedAmount?: number }): void {
  harness.db.prepare(`
    INSERT INTO financial_obligations
      (id, source, type, name, entity, frequency, expected_amount, due_date, status)
    VALUES (?, 'manual', 'corporation-tax', 'CT manual', 'HMRC', 'annual', ?, ?, 'pending')
  `).run(opts.id, opts.expectedAmount ?? 1000, opts.dueDate);
}

function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

afterAll(() => {
  harness.cleanup();
});
beforeEach(() => {
  harness.db.exec('DELETE FROM transactions');
  harness.db.exec('DELETE FROM financial_obligations');
  harness.db.exec('DELETE FROM obligation_dismissals');
  hashSeq = 0;
  const csvPath = path.join(harness.obligationsDir, 'obligation-dismissals.csv');
  if (fs.existsSync(csvPath)) fs.unlinkSync(csvPath);
});

describe('enumerateCtSlots', () => {
  it('emits one slot per FY visible in the ledger, with dueDate = fyEnd + 9 months + 1 day', () => {
    // FY 2023/24 ends 2024-04-30, due 2025-01-31 (Jan 31 because 9m after Apr 30 = Jan 30 + 1 = Jan 31)
    insertIncome({ date: '2023-09-01', amount: 10000 });
    // FY 2024/25 ends 2025-04-30, due 2026-01-31
    insertIncome({ date: '2024-09-01', amount: 20000 });

    const slots = enumerateCtSlots();
    const byFyEnd = new Map(slots.map(s => [s.fyEnd, s.dueDate]));

    expect(byFyEnd.get('2024-04-30')).toBe('2025-01-31');
    expect(byFyEnd.get('2025-04-30')).toBe('2026-01-31');
  });

  it('returns an empty list when there are no transactions', () => {
    expect(enumerateCtSlots()).toEqual([]);
  });
});

describe('deriveAndInsertAutoCtObligations', () => {
  it('is a no-op when the FY has zero CT-applicable income', () => {
    // Income on a non-CT-applicable account does not seed a CT obligation.
    insertIncome({ date: '2024-09-01', amount: 50000, account: 'natwest' });
    deriveAndInsertAutoCtObligations();
    const rows = harness.db.prepare(
      "SELECT * FROM financial_obligations WHERE source='auto' AND type='corporation-tax'"
    ).all();
    expect(rows).toHaveLength(0);
  });

  it('seeds a single auto row per FY with a computed expectedAmount > 0', () => {
    insertIncome({ date: '2024-09-01', amount: 100000 });
    deriveAndInsertAutoCtObligations();

    const rows = harness.db.prepare(`
      SELECT id, due_date, expected_amount, status FROM financial_obligations
      WHERE source='auto' AND type='corporation-tax'
    `).all() as Array<{ id: string; due_date: string; expected_amount: number; status: string }>;

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('auto-ct-2025-04-30');
    expect(rows[0].due_date).toBe('2026-01-31');
    expect(rows[0].expected_amount).toBeGreaterThan(0);
  });

  it('matches a CT payment landing inside ±CT_MATCH_PROXIMITY_DAYS and sets status=paid', () => {
    insertIncome({ date: '2023-09-01', amount: 100000 });
    // FY 2023/24 due 2025-01-31 — pay 5 days before
    insertCtPayment({ date: shiftDate('2025-01-31', -5), amount: 12500, description: 'HMRC CORPORATION T' });

    deriveAndInsertAutoCtObligations(new Date('2025-03-01'));

    const row = harness.db.prepare(`
      SELECT status, paid_amount, paid_date, paid_from_account FROM financial_obligations
      WHERE id='auto-ct-2024-04-30'
    `).get() as { status: string; paid_amount: number; paid_date: string; paid_from_account: string };

    expect(row.status).toBe('paid');
    expect(row.paid_amount).toBeCloseTo(12500, 2);
    expect(row.paid_date).toBe(shiftDate('2025-01-31', -5));
    expect(row.paid_from_account).toBe('barclays-current');
  });

  it('matches the COTAX GOV.UK narrative variant as well', () => {
    insertIncome({ date: '2023-09-01', amount: 100000 });
    insertCtPayment({ date: '2025-02-01', amount: 5000, description: 'HMRC GOV.UK COTAX - CUMBERNAULD' });

    deriveAndInsertAutoCtObligations(new Date('2025-03-01'));

    const row = harness.db.prepare(`
      SELECT status FROM financial_obligations WHERE id='auto-ct-2024-04-30'
    `).get() as { status: string };

    expect(row.status).toBe('paid');
  });

  it('does NOT attribute an HMRC ETMP debit to CT (tight narrative gate)', () => {
    insertIncome({ date: '2023-09-01', amount: 100000 });
    insertCtPayment({ date: '2025-01-28', amount: 12500, description: 'HMRC ETMP - GLASGOW' });

    deriveAndInsertAutoCtObligations(new Date('2025-03-01'));

    const row = harness.db.prepare(`
      SELECT status FROM financial_obligations WHERE id='auto-ct-2024-04-30'
    `).get() as { status: string };

    // Past deadline + no qualifying payment → unpaid (not paid).
    expect(row.status).toBe('unpaid');
  });

  /**
   * Regression-lock for the real-world case that prompted widening the
   * window from 14 → 90 days: the user settled CT FY 2023/24 on
   * 2025-02-20 via the HMRC card gateway, which is 20 days AFTER the
   * 2025-01-31 deadline. With the old ±14-day window this payment
   * orphaned and the slot incorrectly showed "unpaid / overdue".
   */
  it('matches a CT payment landing ~20 days AFTER the deadline (card-gateway posting delay)', () => {
    insertIncome({ date: '2023-09-01', amount: 100000 });
    insertCtPayment({
      date: shiftDate('2025-01-31', 20),
      amount: 5573.35,
      account: 'capital-on-tap',
      description: 'HMRC GOV.UK COTAX - GLASGOW - Card Ending: 8346',
    });

    deriveAndInsertAutoCtObligations(new Date('2025-03-01'));

    const row = harness.db.prepare(`
      SELECT status, paid_amount, paid_date, paid_from_account FROM financial_obligations
      WHERE id='auto-ct-2024-04-30'
    `).get() as {
      status: string;
      paid_amount: number;
      paid_date: string;
      paid_from_account: string;
    };

    expect(row.status).toBe('paid');
    expect(row.paid_amount).toBeCloseTo(5573.35, 2);
    expect(row.paid_from_account).toBe('capital-on-tap');
  });

  /**
   * Regression-lock for the other real-world case: CT FY 2022/23 was
   * settled in a batch on 2023-11-13 — 79 days BEFORE the 2024-01-31
   * deadline. The old 14-day window orphaned this too.
   */
  it('matches a CT payment landing ~79 days BEFORE the deadline (prior-quarter batch settlement)', () => {
    insertIncome({ date: '2022-09-01', amount: 100000 });
    insertCtPayment({
      date: shiftDate('2024-01-31', -79),
      amount: 17000,
      description: 'HMRC CORPORATION T    \t1046211398A00106A BBP',
    });

    deriveAndInsertAutoCtObligations(new Date('2024-03-01'));

    const row = harness.db.prepare(`
      SELECT status, paid_amount FROM financial_obligations
      WHERE id='auto-ct-2023-04-30'
    `).get() as { status: string; paid_amount: number };

    expect(row.status).toBe('paid');
    expect(row.paid_amount).toBeCloseTo(17000, 2);
  });

  it('does NOT match a CT payment landing outside ±CT_MATCH_PROXIMITY_DAYS', () => {
    insertIncome({ date: '2023-09-01', amount: 100000 });
    // 120 days before the deadline — beyond the 90-day window.
    insertCtPayment({ date: shiftDate('2025-01-31', -120), amount: 12500 });

    deriveAndInsertAutoCtObligations(new Date('2025-03-01'));

    const row = harness.db.prepare(`
      SELECT status, paid_from_account FROM financial_obligations
      WHERE id='auto-ct-2024-04-30'
    `).get() as { status: string; paid_from_account: string | null };

    expect(row.status).toBe('unpaid');
    expect(row.paid_from_account).toBeNull();
    // Sanity: the window must be generous enough to absorb real-world
    // early/late settlements but tight enough that a payment a whole
    // quarter away doesn't silently attach to the wrong CT slot.
    expect(CT_MATCH_PROXIMITY_DAYS).toBeGreaterThanOrEqual(90);
    expect(CT_MATCH_PROXIMITY_DAYS).toBeLessThan(120);
  });

  it('marks an unmatched future-dated slot as not-yet-due', () => {
    insertIncome({ date: '2025-09-01', amount: 100000 });
    // FY 2025/26 due 2027-01-31 — still in the future from today.
    deriveAndInsertAutoCtObligations(new Date('2025-12-15'));

    const row = harness.db.prepare(`
      SELECT status, paid_date FROM financial_obligations WHERE id='auto-ct-2026-04-30'
    `).get() as { status: string; paid_date: string | null };

    expect(row.status).toBe('not-yet-due');
    expect(row.paid_date).toBeNull();
  });

  it('marks an unmatched past-deadline slot as unpaid', () => {
    insertIncome({ date: '2023-09-01', amount: 100000 });
    deriveAndInsertAutoCtObligations(new Date('2025-06-01'));

    const row = harness.db.prepare(`
      SELECT status FROM financial_obligations WHERE id='auto-ct-2024-04-30'
    `).get() as { status: string };

    expect(row.status).toBe('unpaid');
  });

  it('manual CT obligation within ±CT_MANUAL_SUPERSEDE_WINDOW_DAYS suppresses the auto row', () => {
    insertIncome({ date: '2023-09-01', amount: 100000 });

    const manualDue = shiftDate('2025-01-31', -(CT_MANUAL_SUPERSEDE_WINDOW_DAYS - 1));
    insertManualCtObligation({ id: 'manual-ct-1', dueDate: manualDue });

    deriveAndInsertAutoCtObligations();
    const rows = harness.db.prepare(`
      SELECT id FROM financial_obligations WHERE source='auto' AND type='corporation-tax'
    `).all() as Array<{ id: string }>;

    expect(rows).toHaveLength(0);
  });

  it('manual CT obligation outside the supersede window does NOT suppress the auto row', () => {
    insertIncome({ date: '2023-09-01', amount: 100000 });

    const manualDue = shiftDate('2025-01-31', -(CT_MANUAL_SUPERSEDE_WINDOW_DAYS + 5));
    insertManualCtObligation({ id: 'manual-ct-far', dueDate: manualDue });

    deriveAndInsertAutoCtObligations();
    const rows = harness.db.prepare(`
      SELECT id FROM financial_obligations WHERE source='auto' AND type='corporation-tax'
    `).all() as Array<{ id: string }>;

    expect(rows.some(r => r.id === 'auto-ct-2024-04-30')).toBe(true);
  });

  it('dismissed slot is skipped on subsequent runs', () => {
    insertIncome({ date: '2023-09-01', amount: 100000 });
    deriveAndInsertAutoCtObligations();

    addDismissal({ obligationId: 'auto-ct-2024-04-30' });
    deriveAndInsertAutoCtObligations();

    const rows = harness.db.prepare(`
      SELECT id FROM financial_obligations WHERE source='auto' AND type='corporation-tax'
    `).all() as Array<{ id: string }>;

    expect(rows.some(r => r.id === 'auto-ct-2024-04-30')).toBe(false);
  });

  it('rebuilds from scratch each run (deletes prior auto rows)', () => {
    insertIncome({ date: '2023-09-01', amount: 100000 });

    deriveAndInsertAutoCtObligations();
    const first = harness.db.prepare(
      "SELECT COUNT(*) as c FROM financial_obligations WHERE source='auto' AND type='corporation-tax'"
    ).get() as { c: number };

    deriveAndInsertAutoCtObligations();
    const second = harness.db.prepare(
      "SELECT COUNT(*) as c FROM financial_obligations WHERE source='auto' AND type='corporation-tax'"
    ).get() as { c: number };

    expect(second.c).toBe(first.c);
  });
});
