import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  matchManualObligationsToTransactions,
  descriptionMatchesMerchant,
  DEFAULT_AMOUNT_TOLERANCE_RATIO,
  MATCH_PROXIMITY_DAYS,
  type MatcherSlot,
} from './obligation-state-matcher.js';
import type { ExpenseTransactionMatch } from './transaction-queries.js';
import {
  writeObligationStateToFile,
  readObligationStateFromFile,
  type ObligationStateRow,
} from '../../domain/obligations/obligation-state.js';

/**
 * Fixed "today" used across matcher tests so date-dependent branches
 * (overdue-vs-not-yet-due) are deterministic. Chosen comfortably after
 * the 2025-11-06 Kingsbridge renewal fixture so past-due logic fires.
 */
const TODAY = new Date('2026-02-01T00:00:00Z');

function slot(overrides: Partial<MatcherSlot>): MatcherSlot {
  return {
    id: 'manual-ins-1',
    merchant: 'Kingsbridge',
    account: 'barclays-current',
    dueDate: '2025-11-06',
    expectedAmount: 615,
    amountTolerance: null,
    ...overrides,
  };
}

function tx(overrides: Partial<ExpenseTransactionMatch>): ExpenseTransactionMatch {
  return {
    date: '2025-11-06',
    amount: -615,
    account: 'barclays-current',
    description: 'Kingsbridge Insurance Ltd',
    ...overrides,
  };
}

describe('descriptionMatchesMerchant', () => {
  it('does a case-insensitive substring match', () => {
    expect(descriptionMatchesMerchant('PAYMENT TO KINGSBRIDGE LTD', 'Kingsbridge')).toBe(true);
    expect(descriptionMatchesMerchant('kingsbridge insurance', 'Kingsbridge')).toBe(true);
  });

  it('returns false when the merchant is absent', () => {
    expect(descriptionMatchesMerchant('Churchill Insurance', 'Kingsbridge')).toBe(false);
  });

  it('returns false for an empty merchant (a blank pattern would match everything — footgun)', () => {
    expect(descriptionMatchesMerchant('anything', '')).toBe(false);
  });
});

describe('matchManualObligationsToTransactions', () => {
  it('matches a payment within the proximity window → paid row', () => {
    const rows = matchManualObligationsToTransactions([slot({})], [tx({})], TODAY);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'manual-ins-1',
      status: 'paid',
      paidAmount: 615,
      paidDate: '2025-11-06',
      paidFromAccount: 'barclays-current',
      source: 'auto',
    });
  });

  it('accepts payments up to the proximity boundary (inclusive)', () => {
    const rows = matchManualObligationsToTransactions(
      [slot({ dueDate: '2025-11-06' })],
      [tx({ date: '2025-09-07' })], // exactly 60 days before
      TODAY,
    );
    expect(rows[0]?.status).toBe('paid');
  });

  it('rejects payments outside the proximity window → overdue unpaid row', () => {
    const rows = matchManualObligationsToTransactions(
      [slot({ dueDate: '2025-11-06' })],
      [tx({ date: '2025-07-01' })], // > MATCH_PROXIMITY_DAYS before
      TODAY,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'manual-ins-1',
      status: 'unpaid',
      paidAmount: null,
      source: 'auto',
    });
  });

  it('rejects a payment whose amount exceeds the default tolerance', () => {
    // 615 × 1.3 = 799.5; 900 sits clearly outside.
    const rows = matchManualObligationsToTransactions(
      [slot({ expectedAmount: 615 })],
      [tx({ amount: -900 })],
      TODAY,
    );
    expect(rows[0]?.status).toBe('unpaid');
  });

  it('per-slot amountTolerance override widens the acceptance window', () => {
    // Would be rejected at the default 30% tolerance, but accepted at 0.6.
    const rows = matchManualObligationsToTransactions(
      [slot({ expectedAmount: 615, amountTolerance: 0.6 })],
      [tx({ amount: -900 })],
      TODAY,
    );
    expect(rows[0]?.status).toBe('paid');
    expect(rows[0]?.paidAmount).toBe(900);
  });

  it('rejects payments on a different account when the slot pins an account', () => {
    const rows = matchManualObligationsToTransactions(
      [slot({ account: 'barclays-current' })],
      [tx({ account: 'monzo-joint' })],
      TODAY,
    );
    expect(rows[0]?.status).toBe('unpaid');
  });

  it('descriptions that do not contain the merchant string never match', () => {
    const rows = matchManualObligationsToTransactions(
      [slot({})],
      [tx({ description: 'Churchill Insurance' })],
      TODAY,
    );
    expect(rows[0]?.status).toBe('unpaid');
  });

  it('disambiguates two slots sharing a merchant+account via amount & distance (no double-claim)', () => {
    // Two Kingsbridge policies on the same account, very different premiums.
    // The matcher must pair each payment with the slot whose expected
    // amount is within tolerance — and never claim the same payment twice.
    const slots: MatcherSlot[] = [
      slot({ id: 'ins-big', expectedAmount: 615, dueDate: '2025-11-06' }),
      slot({ id: 'ins-small', expectedAmount: 200, dueDate: '2025-11-06' }),
    ];
    const txs: ExpenseTransactionMatch[] = [
      tx({ date: '2025-11-06', amount: -615 }),
      tx({ date: '2025-11-07', amount: -200 }),
    ];
    const rows = matchManualObligationsToTransactions(slots, txs, TODAY);
    const byId = new Map(rows.map(r => [r.id, r]));
    expect(byId.get('ins-big')?.status).toBe('paid');
    expect(byId.get('ins-big')?.paidAmount).toBe(615);
    expect(byId.get('ins-small')?.status).toBe('paid');
    expect(byId.get('ins-small')?.paidAmount).toBe(200);
  });

  it('emits no row when no match is found and the slot is not yet overdue', () => {
    const future = new Date('2025-09-01T00:00:00Z'); // before dueDate 2025-11-06
    const rows = matchManualObligationsToTransactions(
      [slot({ dueDate: '2025-11-06' })],
      [],
      future,
    );
    expect(rows).toHaveLength(0);
  });

  it('emits unpaid row when no match is found and the slot is overdue', () => {
    const rows = matchManualObligationsToTransactions([slot({})], [], TODAY);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'unpaid', source: 'auto' });
  });

  it('produces no rows on empty input', () => {
    expect(matchManualObligationsToTransactions([], [], TODAY)).toEqual([]);
  });

  it('is deterministic for ties — identical input produces identical output', () => {
    const slots = [slot({ id: 'a' }), slot({ id: 'b', expectedAmount: 200 })];
    const txs = [tx({ amount: -615 }), tx({ amount: -200, date: '2025-11-05' })];
    const a = matchManualObligationsToTransactions(slots, txs, TODAY);
    const b = matchManualObligationsToTransactions(slots, txs, TODAY);
    expect(a).toEqual(b);
  });

  it('honours opts.defaultToleranceRatio as a fallback when the slot omits one', () => {
    const rows = matchManualObligationsToTransactions(
      [slot({ expectedAmount: 615, amountTolerance: null })],
      [tx({ amount: -900 })],
      TODAY,
      { defaultToleranceRatio: 0.6 },
    );
    expect(rows[0]?.status).toBe('paid');
  });

  it('honours opts.maxProximityDays when overriding the default window', () => {
    const rows = matchManualObligationsToTransactions(
      [slot({ dueDate: '2025-11-06' })],
      [tx({ date: '2025-07-01' })],
      TODAY,
      { maxProximityDays: 200 },
    );
    expect(rows[0]?.status).toBe('paid');
  });
});

describe('public constants', () => {
  it('exports a 60-day proximity window (plan baseline)', () => {
    expect(MATCH_PROXIMITY_DAYS).toBe(60);
  });

  it('exports a 30% default tolerance (plan baseline)', () => {
    expect(DEFAULT_AMOUNT_TOLERANCE_RATIO).toBeCloseTo(0.3, 6);
  });
});

describe('obligation-state.csv source column roundtrip', () => {
  let tmpDir: string;
  let csvPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obligation-state-test-'));
    csvPath = path.join(tmpDir, 'obligation-state.csv');
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes and reads back mixed user/auto rows with full fidelity', () => {
    const rows: ObligationStateRow[] = [
      { id: 'z-user', status: 'paid', paidAmount: 123.45, paidDate: '2025-03-01', paidFromAccount: 'barclays-current', source: 'user' },
      { id: 'a-auto', status: 'paid', paidAmount: 615,    paidDate: '2025-11-06', paidFromAccount: 'barclays-current', source: 'auto' },
    ];
    writeObligationStateToFile(csvPath, rows);
    const read = readObligationStateFromFile(csvPath);
    expect(read.get('a-auto')).toEqual(rows[1]);
    expect(read.get('z-user')).toEqual(rows[0]);
  });

  it('emits the source header on every write so legacy readers break loudly (not silently)', () => {
    writeObligationStateToFile(csvPath, [
      { id: 'x', status: 'paid', paidAmount: null, paidDate: null, paidFromAccount: null, source: 'auto' },
    ]);
    const raw = fs.readFileSync(csvPath, 'utf8');
    const header = raw.split('\n')[0];
    expect(header.split(',')).toEqual(['id', 'status', 'paid_amount', 'paid_date', 'paid_from_account', 'source']);
  });

  it('defaults legacy rows missing the source column to source=user (backwards-compat)', () => {
    // Simulate a hand-authored file from before the source column existed.
    fs.writeFileSync(
      csvPath,
      'id,status,paid_amount,paid_date,paid_from_account\nlegacy-1,paid,100,2024-01-01,barclays-current\n',
      'utf8',
    );
    const read = readObligationStateFromFile(csvPath);
    expect(read.get('legacy-1')?.source).toBe('user');
    expect(read.get('legacy-1')?.status).toBe('paid');
  });

  it('defaults blank/unknown source values to user (conservative fallback)', () => {
    fs.writeFileSync(
      csvPath,
      'id,status,paid_amount,paid_date,paid_from_account,source\nrow-a,paid,100,2024-01-01,acc,\nrow-b,paid,100,2024-01-01,acc,bogus\n',
      'utf8',
    );
    const read = readObligationStateFromFile(csvPath);
    expect(read.get('row-a')?.source).toBe('user');
    expect(read.get('row-b')?.source).toBe('user');
  });
});
