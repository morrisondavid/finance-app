import { describe, it, expect } from 'vitest';
import {
  matchPaymentsToSlots,
  matchPaymentsToSlotsAsymmetric,
  shiftIsoDate,
  DEFAULT_MAX_PROXIMITY_DAYS,
  type PaymentMatchSlot,
} from './payment-matcher.js';
import type { VatQuarterRange } from '../config/tax-rates.js';
import type { HmrcPaymentMatch } from '../db/repositories/tax.js';

/**
 * Test helpers translate the richer VAT quarter type into the generic
 * `PaymentMatchSlot` shape the matcher operates on. This mirrors what real
 * callers (VAT / SA / CT seeders) do at their call sites.
 */
function vatKey(q: VatQuarterRange): string {
  return `${q.startDate}-${q.endDate}`;
}

function slot(q: VatQuarterRange): PaymentMatchSlot {
  return { key: vatKey(q), dueDate: q.dueDate };
}

function q(overrides: Partial<VatQuarterRange>): VatQuarterRange {
  return {
    startDate: '2025-02-01',
    endDate: '2025-04-30',
    dueDate: '2025-06-07',
    label: 'Feb-Apr 2025',
    quarter: 2,
    ...overrides,
  };
}

function p(overrides: Partial<HmrcPaymentMatch>): HmrcPaymentMatch {
  return {
    hash: 'pay-1',
    date: '2025-06-07',
    amount: -1000,
    account: 'barclays-current',
    description: 'HMRC VAT SOUTHEND',
    ...overrides,
  };
}

describe('matchPaymentsToSlots', () => {
  describe('trivial cases', () => {
    it('returns empty map when no slots', () => {
      const result = matchPaymentsToSlots([], [p({})], DEFAULT_MAX_PROXIMITY_DAYS);
      expect(result.size).toBe(0);
    });

    it('returns null for every slot when pool is empty', () => {
      const quarters = [
        q({ startDate: '2025-02-01', endDate: '2025-04-30', dueDate: '2025-06-07' }),
        q({ startDate: '2025-05-01', endDate: '2025-07-31', dueDate: '2025-09-07' }),
      ];
      const result = matchPaymentsToSlots(quarters.map(slot), [], DEFAULT_MAX_PROXIMITY_DAYS);
      expect(result.size).toBe(2);
      for (const v of result.values()) expect(v).toBeNull();
    });

    it('assigns a single payment near the due date', () => {
      const quarter = q({ dueDate: '2025-06-07' });
      const payment = p({ date: '2025-06-09', amount: -1234 });
      const result = matchPaymentsToSlots([slot(quarter)], [payment], DEFAULT_MAX_PROXIMITY_DAYS);
      expect(result.get(vatKey(quarter))).toEqual(payment);
    });
  });

  describe('proximity window', () => {
    it('matches a payment exactly `maxProximityDays` away (inclusive boundary)', () => {
      const quarter = q({ dueDate: '2025-06-07' });
      const payment = p({ date: shiftIsoDate('2025-06-07', -DEFAULT_MAX_PROXIMITY_DAYS) });
      const result = matchPaymentsToSlots([slot(quarter)], [payment], DEFAULT_MAX_PROXIMITY_DAYS);
      expect(result.get(vatKey(quarter))).toEqual(payment);
    });

    it('does NOT match a payment one day outside the window', () => {
      const quarter = q({ dueDate: '2025-06-07' });
      const payment = p({ date: shiftIsoDate('2025-06-07', -(DEFAULT_MAX_PROXIMITY_DAYS + 1)) });
      const result = matchPaymentsToSlots([slot(quarter)], [payment], DEFAULT_MAX_PROXIMITY_DAYS);
      expect(result.get(vatKey(quarter))).toBeNull();
    });

    it('respects a custom proximity of 0 (payment must land exactly on due date)', () => {
      const quarter = q({ dueDate: '2025-06-07' });
      const onPayment = p({ date: '2025-06-07' });
      const offPayment = p({ date: '2025-06-08' });
      expect(matchPaymentsToSlots([slot(quarter)], [onPayment], 0).get(vatKey(quarter))).toEqual(onPayment);
      expect(matchPaymentsToSlots([slot(quarter)], [offPayment], 0).get(vatKey(quarter))).toBeNull();
    });

    it('honours a tight CT-style ±14 day window', () => {
      const quarter = q({ dueDate: '2025-06-07' });
      const inWindow = p({ date: shiftIsoDate('2025-06-07', 14) });
      const outOfWindow = p({ date: shiftIsoDate('2025-06-07', 15) });
      expect(matchPaymentsToSlots([slot(quarter)], [inWindow], 14).get(vatKey(quarter))).toEqual(inWindow);
      expect(matchPaymentsToSlots([slot(quarter)], [outOfWindow], 14).get(vatKey(quarter))).toBeNull();
    });

    it('honours a medium SA-style ±60 day window', () => {
      const quarter = q({ dueDate: '2025-01-31' });
      const inWindow = p({ date: shiftIsoDate('2025-01-31', 60) });
      const outOfWindow = p({ date: shiftIsoDate('2025-01-31', 61) });
      expect(matchPaymentsToSlots([slot(quarter)], [inWindow], 60).get(vatKey(quarter))).toEqual(inWindow);
      expect(matchPaymentsToSlots([slot(quarter)], [outOfWindow], 60).get(vatKey(quarter))).toBeNull();
    });
  });

  describe('global closest-wins semantics', () => {
    it('awards each payment to the slot whose due date it is closest to', () => {
      const q1 = q({ startDate: '2025-02-01', endDate: '2025-04-30', dueDate: '2025-06-07', label: 'Q1' });
      const q2 = q({ startDate: '2025-05-01', endDate: '2025-07-31', dueDate: '2025-09-07', label: 'Q2' });
      const q3 = q({ startDate: '2025-08-01', endDate: '2025-10-31', dueDate: '2025-12-07', label: 'Q3' });
      const p1 = p({ date: '2025-06-10', amount: -1000 });
      const p2 = p({ date: '2025-09-08', amount: -2000 });
      const p3 = p({ date: '2025-12-08', amount: -3000 });

      const result = matchPaymentsToSlots([q3, q1, q2].map(slot), [p3, p1, p2], DEFAULT_MAX_PROXIMITY_DAYS);

      expect(result.get(vatKey(q1))).toEqual(p1);
      expect(result.get(vatKey(q2))).toEqual(p2);
      expect(result.get(vatKey(q3))).toEqual(p3);
    });

    it('does NOT let an earlier slot steal a payment better suited to a later slot', () => {
      // Payment 2025-09-05 is 90 days after Q1 (boundary) but only 2 days
      // before Q2. Global greedy must award it to Q2.
      const q1 = q({ dueDate: '2025-06-07', label: 'Q1' });
      const q2 = q({ startDate: '2025-05-01', endDate: '2025-07-31', dueDate: '2025-09-07', label: 'Q2' });
      const payment = p({ date: '2025-09-05' });

      const result = matchPaymentsToSlots([q1, q2].map(slot), [payment], DEFAULT_MAX_PROXIMITY_DAYS);

      expect(result.get(vatKey(q1))).toBeNull();
      expect(result.get(vatKey(q2))).toEqual(payment);
    });

    it('dedupes: a payment awarded to one slot cannot appear on another', () => {
      const q1 = q({ dueDate: '2025-06-07', label: 'Q1' });
      const q2 = q({ startDate: '2025-05-01', endDate: '2025-07-31', dueDate: '2025-09-07', label: 'Q2' });
      const singlePayment = p({ date: '2025-06-10' });

      const result = matchPaymentsToSlots([q1, q2].map(slot), [singlePayment], DEFAULT_MAX_PROXIMITY_DAYS);

      expect(result.get(vatKey(q1))).toEqual(singlePayment);
      expect(result.get(vatKey(q2))).toBeNull();
    });

    it('two payments for one slot: closest to due date wins, other is orphaned', () => {
      const quarter = q({ dueDate: '2025-06-07' });
      const farther = p({ date: '2025-05-01', amount: -500 });  // 37 days before
      const closer = p({ date: '2025-06-09', amount: -1000 });  // 2 days after
      const result = matchPaymentsToSlots([slot(quarter)], [farther, closer], DEFAULT_MAX_PROXIMITY_DAYS);
      expect(result.get(vatKey(quarter))).toEqual(closer);
    });
  });

  describe('tie-breaking determinism', () => {
    it('when two payments are equidistant, chronologically earlier wins', () => {
      const quarter = q({ dueDate: '2025-06-07' });
      const earlier = p({ date: '2025-06-05', amount: -100 });
      const later = p({ date: '2025-06-09', amount: -200 });
      const result = matchPaymentsToSlots([slot(quarter)], [later, earlier], DEFAULT_MAX_PROXIMITY_DAYS);
      expect(result.get(vatKey(quarter))).toEqual(earlier);
    });
  });

  describe('heterogeneous slot keys', () => {
    it('preserves caller-supplied slot keys verbatim (e.g. SA "{personId}-{dueDate}")', () => {
      const saSlots: PaymentMatchSlot[] = [
        { key: 'david-2025-01-31', dueDate: '2025-01-31' },
        { key: 'heena-2025-01-31', dueDate: '2025-01-31' },
      ];
      const payment = p({ date: '2025-01-31' });
      const result = matchPaymentsToSlots(saSlots, [payment], 60);
      // Exactly one slot wins the payment; the other is null.
      const matched = [...result.entries()].filter(([, v]) => v !== null);
      expect(matched.length).toBe(1);
      expect(result.has('david-2025-01-31')).toBe(true);
      expect(result.has('heena-2025-01-31')).toBe(true);
    });
  });

  describe('real-world regression: user HMRC VAT payments 2022-04 to 2026-02', () => {
    // Stagger-2: Feb-Apr (due Jun 7), May-Jul (due Sep 7), Aug-Oct (due Dec 7),
    // Nov-Jan (due Mar 7). All VAT-only payments (HMRC VAT SOUTHEND).
    const quarters: VatQuarterRange[] = [
      { startDate: '2021-11-01', endDate: '2022-01-31', dueDate: '2022-03-07', label: 'Nov-Jan 2021/22', quarter: 1 },
      { startDate: '2022-02-01', endDate: '2022-04-30', dueDate: '2022-06-07', label: 'Feb-Apr 2022', quarter: 2 },
      { startDate: '2022-05-01', endDate: '2022-07-31', dueDate: '2022-09-07', label: 'May-Jul 2022', quarter: 3 },
      { startDate: '2022-08-01', endDate: '2022-10-31', dueDate: '2022-12-07', label: 'Aug-Oct 2022', quarter: 4 },
      { startDate: '2022-11-01', endDate: '2023-01-31', dueDate: '2023-03-07', label: 'Nov-Jan 2022/23', quarter: 1 },
      { startDate: '2023-02-01', endDate: '2023-04-30', dueDate: '2023-06-07', label: 'Feb-Apr 2023', quarter: 2 },
      { startDate: '2023-05-01', endDate: '2023-07-31', dueDate: '2023-09-07', label: 'May-Jul 2023', quarter: 3 },
      { startDate: '2023-08-01', endDate: '2023-10-31', dueDate: '2023-12-07', label: 'Aug-Oct 2023', quarter: 4 },
      { startDate: '2023-11-01', endDate: '2024-01-31', dueDate: '2024-03-07', label: 'Nov-Jan 2023/24', quarter: 1 },
      { startDate: '2024-02-01', endDate: '2024-04-30', dueDate: '2024-06-07', label: 'Feb-Apr 2024', quarter: 2 },
      { startDate: '2024-05-01', endDate: '2024-07-31', dueDate: '2024-09-07', label: 'May-Jul 2024', quarter: 3 },
      { startDate: '2024-08-01', endDate: '2024-10-31', dueDate: '2024-12-07', label: 'Aug-Oct 2024', quarter: 4 },
      { startDate: '2024-11-01', endDate: '2025-01-31', dueDate: '2025-03-07', label: 'Nov-Jan 2024/25', quarter: 1 },
      { startDate: '2025-02-01', endDate: '2025-04-30', dueDate: '2025-06-07', label: 'Feb-Apr 2025', quarter: 2 },
      { startDate: '2025-05-01', endDate: '2025-07-31', dueDate: '2025-09-07', label: 'May-Jul 2025', quarter: 3 },
      { startDate: '2025-08-01', endDate: '2025-10-31', dueDate: '2025-12-07', label: 'Aug-Oct 2025', quarter: 4 },
    ];

    // Real VAT-only payments pulled from the ledger.
    const payments: HmrcPaymentMatch[] = [
      { hash: 'vat-2022-04-29', date: '2022-04-29', amount: -12092.65, account: 'barclays-current', description: 'HMRC VAT SOUTHEND' },
      { hash: 'vat-2022-06-06', date: '2022-06-06', amount: -12107.72, account: 'barclays-current', description: 'HMRC VAT SOUTHEND' },
      { hash: 'vat-2022-07-25', date: '2022-07-25', amount: -14436.99, account: 'barclays-current', description: 'HMRC VAT SOUTHEND' },
      { hash: 'vat-2023-03-06', date: '2023-03-06', amount: -8535.17, account: 'barclays-current', description: 'HMRC VAT SOUTHEND' },
      { hash: 'vat-2023-06-15', date: '2023-06-15', amount: -5062.05, account: 'barclays-current', description: 'HMRC VAT SOUTHEND' },
      { hash: 'vat-2023-11-13', date: '2023-11-13', amount: -3896.12, account: 'barclays-current', description: 'HMRC VAT SOUTHEND' },
      { hash: 'vat-2023-12-04', date: '2023-12-04', amount: -4817.88, account: 'barclays-current', description: 'HMRC VAT SOUTHEND' },
      { hash: 'vat-2025-03-07', date: '2025-03-07', amount: -6385.12, account: 'barclays-current', description: 'HMRC VAT SOUTHEND' },
      { hash: 'vat-2025-09-08', date: '2025-09-08', amount: -8060.0, account: 'barclays-current', description: 'HMRC VAT SOUTHEND' },
      { hash: 'vat-2025-12-08', date: '2025-12-08', amount: -11653.06, account: 'barclays-current', description: 'HMRC VAT SOUTHEND' },
    ];

    const run = () => matchPaymentsToSlots(quarters.map(slot), payments, DEFAULT_MAX_PROXIMITY_DAYS);

    it('awards 2022-06-06 £12,107.72 to Feb-Apr 2022 (closest: 1 day after due date)', () => {
      const result = run();
      const febApr2022 = quarters.find(x => x.label === 'Feb-Apr 2022')!;
      expect(result.get(vatKey(febApr2022))?.date).toBe('2022-06-06');
      expect(result.get(vatKey(febApr2022))?.amount).toBe(-12107.72);
    });

    it('awards 2025-12-08 £11,653.06 to Aug-Oct 2025 (closest: 1 day after due date)', () => {
      const result = run();
      const augOct2025 = quarters.find(x => x.label === 'Aug-Oct 2025')!;
      expect(result.get(vatKey(augOct2025))?.date).toBe('2025-12-08');
      expect(result.get(vatKey(augOct2025))?.amount).toBe(-11653.06);
    });

    it('awards 2025-03-07 £6,385.12 to Nov-Jan 2024/25 (exact on-due-date)', () => {
      const result = run();
      const novJan2024 = quarters.find(x => x.label === 'Nov-Jan 2024/25')!;
      expect(result.get(vatKey(novJan2024))?.date).toBe('2025-03-07');
    });

    it('awards 2023-03-06 £8,535.17 to Nov-Jan 2022/23 (1 day before due date)', () => {
      const result = run();
      const novJan2022 = quarters.find(x => x.label === 'Nov-Jan 2022/23')!;
      expect(result.get(vatKey(novJan2022))?.date).toBe('2023-03-06');
    });

    it('awards 2022-04-29 to Nov-Jan 2021/22 (53 days after due) — global greedy picks up quarters earlier picks would have starved', () => {
      const result = run();
      const novJan2021 = quarters.find(x => x.label === 'Nov-Jan 2021/22')!;
      expect(result.get(vatKey(novJan2021))?.date).toBe('2022-04-29');
    });

    it('awards 2022-07-25 to May-Jul 2022 (44 days before due)', () => {
      const result = run();
      const mayJul2022 = quarters.find(x => x.label === 'May-Jul 2022')!;
      expect(result.get(vatKey(mayJul2022))?.date).toBe('2022-07-25');
    });

    it('leaves Aug-Oct 2022 unmatched (no payment within 90d of 2022-12-07)', () => {
      const result = run();
      const augOct2022 = quarters.find(x => x.label === 'Aug-Oct 2022')!;
      expect(result.get(vatKey(augOct2022))).toBeNull();
    });

    it('never reuses a single payment across multiple slots', () => {
      const result = run();
      const seen = new Set<string>();
      for (const match of result.values()) {
        if (match === null) continue;
        const key = `${match.date}|${match.amount}|${match.account}`;
        expect(seen.has(key), `payment ${key} was reused`).toBe(false);
        seen.add(key);
      }
    });
  });

  describe('defaults', () => {
    it('DEFAULT_MAX_PROXIMITY_DAYS is 90', () => {
      expect(DEFAULT_MAX_PROXIMITY_DAYS).toBe(90);
    });
  });

  describe('matchPaymentsToSlotsAsymmetric', () => {
    it('allows late payment beyond symmetric window when maxLateDays is larger', () => {
      const slots: PaymentMatchSlot[] = [
        { key: 'jan', dueDate: '2026-01-31' },
        { key: 'jul', dueDate: '2026-07-31' },
      ];
      const payments: HmrcPaymentMatch[] = [
        {
          date: '2026-05-14',
          amount: 2123.24,
          account: 'barclaycard',
          description: 'HMRC GOV.UK SA',
          hash: 'late-sa-hash',
        },
      ];
      const result = matchPaymentsToSlotsAsymmetric(slots, payments, {
        maxEarlyDays: 60,
        maxLateDays: 120,
      });
      expect(result.get('jan')?.hash).toBe('late-sa-hash');
      expect(result.get('jul')).toBeNull();
    });

    it('rejects payment too early for a slot even when late window is wide', () => {
      const slots: PaymentMatchSlot[] = [
        { key: 'jul', dueDate: '2026-07-31' },
      ];
      const payments: HmrcPaymentMatch[] = [
        {
          date: '2026-05-14',
          amount: 2123.24,
          account: 'barclaycard',
          description: 'HMRC GOV.UK SA',
          hash: 'early-for-jul',
        },
      ];
      const result = matchPaymentsToSlotsAsymmetric(slots, payments, {
        maxEarlyDays: 60,
        maxLateDays: 120,
      });
      expect(result.get('jul')).toBeNull();
    });
  });
});
