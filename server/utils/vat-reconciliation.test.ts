import { describe, it, expect } from 'vitest';
import { reconcileVatQuarter } from './vat-reconciliation.js';
import type { VatQuarterRange } from '../config/tax-rates.js';
import type { HmrcPaymentMatch } from '../db/repositories/tax.js';

function makeQuarter(overrides: Partial<VatQuarterRange> = {}): VatQuarterRange {
  return {
    startDate: '2025-02-01',
    endDate: '2025-04-30',
    dueDate: '2025-06-07',
    label: 'Feb-Apr 2025',
    quarter: 2,
    ...overrides,
  };
}

function makePayment(overrides: Partial<HmrcPaymentMatch> = {}): HmrcPaymentMatch {
  return {
    date: '2025-06-01',
    amount: -1000,
    account: 'barclays-current',
    description: 'HMRC VAT',
    ...overrides,
  };
}

const VAT_FRACTION = 1 / 6;

describe('reconcileVatQuarter', () => {
  describe('status derivation', () => {
    it('returns no-income when quarter income is zero', () => {
      const result = reconcileVatQuarter(makeQuarter(), 0, VAT_FRACTION, null);
      expect(result.status).toBe('no-income');
      expect(result.expectedAmount).toBe(0);
    });

    it('returns paid when payment covers expected amount', () => {
      const income = 6000;
      const expected = income * VAT_FRACTION;
      const q = makeQuarter();
      const ref = new Date('2025-07-01');
      const result = reconcileVatQuarter(q, income, VAT_FRACTION, makePayment({ amount: -1000 }), ref);
      expect(result.status).toBe('paid');
      expect(result.expectedAmount).toBeCloseTo(expected, 1);
      expect(result.paidAmount).toBe(1000);
    });

    it('returns unpaid when no payment matched and due date passed', () => {
      const q = makeQuarter();
      const ref = new Date('2025-07-01');
      const result = reconcileVatQuarter(q, 6000, VAT_FRACTION, null, ref);
      expect(result.status).toBe('unpaid');
      expect(result.paidAmount).toBe(0);
    });

    it('returns underpaid when payment is less than 95% of expected', () => {
      const q = makeQuarter();
      const ref = new Date('2025-07-01');
      const result = reconcileVatQuarter(q, 6000, VAT_FRACTION, makePayment({ amount: -500 }), ref);
      expect(result.status).toBe('underpaid');
      expect(result.paidAmount).toBe(500);
    });

    it('returns not-yet-due when due date is in the future', () => {
      const q = makeQuarter({ dueDate: '2025-06-07' });
      const ref = new Date('2025-05-01');
      const result = reconcileVatQuarter(q, 6000, VAT_FRACTION, null, ref);
      expect(result.status).toBe('not-yet-due');
    });

    it('returns paid even before due date if payment is sufficient', () => {
      const q = makeQuarter({ dueDate: '2025-06-07' });
      const ref = new Date('2025-05-01');
      const result = reconcileVatQuarter(q, 6000, VAT_FRACTION, makePayment({ amount: -1000, date: '2025-04-15' }), ref);
      expect(result.status).toBe('paid');
    });
  });

  describe('cross-account detection', () => {
    it('reports correct paidFromAccount', () => {
      const q = makeQuarter();
      const ref = new Date('2025-07-01');
      const result = reconcileVatQuarter(q, 6000, VAT_FRACTION,
        makePayment({ account: 'capital-on-tap', amount: -1000 }),
        ref,
      );
      expect(result.paidFromAccount).toBe('capital-on-tap');
    });
  });

  describe('single-match semantics', () => {
    it('uses the amount/date/account of the provided match', () => {
      const q = makeQuarter();
      const ref = new Date('2025-07-01');
      const result = reconcileVatQuarter(q, 6000, VAT_FRACTION,
        makePayment({ account: 'barclays-current', amount: -1000, date: '2025-06-10' }),
        ref,
      );
      expect(result.paidAmount).toBe(1000);
      expect(result.paidFromAccount).toBe('barclays-current');
      expect(result.paidDate).toBe('2025-06-10');
    });

    it('never sums multiple amounts (single physical payment only)', () => {
      const q = makeQuarter();
      const ref = new Date('2025-07-01');
      const result = reconcileVatQuarter(q, 6000, VAT_FRACTION,
        makePayment({ amount: -1000 }),
        ref,
      );
      expect(result.paidAmount).toBe(1000);
    });
  });

  describe('edge cases', () => {
    it('treats payment within 5% tolerance as paid', () => {
      const q = makeQuarter();
      const ref = new Date('2025-07-01');
      const result = reconcileVatQuarter(q, 6000, VAT_FRACTION, makePayment({ amount: -960 }), ref);
      expect(result.status).toBe('paid');
    });

    it('returns null fields when no match and no income', () => {
      const result = reconcileVatQuarter(makeQuarter(), 0, VAT_FRACTION, null);
      expect(result.paidDate).toBeNull();
      expect(result.paidFromAccount).toBeNull();
    });
  });

  describe('insufficient-data status (dataCutoffDate = previous FY start)', () => {
    // If we're in FY 2025/26, previous FY is 2024/25 → cutoff = 2024-05-01.
    // Quarters ending before 2024-05-01 → insufficient-data.
    // Quarters in 2024/25 or 2025/26 → unpaid (we trust the data).
    const PREV_FY_START = '2024-05-01';

    it('returns insufficient-data for a quarter well before the previous FY', () => {
      const oldQuarter = makeQuarter({
        startDate: '2023-05-01',
        endDate: '2023-07-31',
        dueDate: '2023-10-07',
        label: 'May-Jul 2023',
      });
      const ref = new Date('2025-07-01');
      const result = reconcileVatQuarter(oldQuarter, 6000, VAT_FRACTION, null, ref, PREV_FY_START);
      expect(result.status).toBe('insufficient-data');
      expect(result.paidAmount).toBe(0);
    });

    it('returns unpaid for a quarter inside the previous FY', () => {
      const prevFyQuarter = makeQuarter({
        startDate: '2024-08-01',
        endDate: '2024-10-31',
        dueDate: '2025-01-07',
        label: 'Aug-Oct 2024',
      });
      const ref = new Date('2025-07-01');
      const result = reconcileVatQuarter(prevFyQuarter, 6000, VAT_FRACTION, null, ref, PREV_FY_START);
      expect(result.status).toBe('unpaid');
    });

    it('returns unpaid for a quarter inside the current FY', () => {
      const currentQuarter = makeQuarter({
        startDate: '2025-05-01',
        endDate: '2025-07-31',
        dueDate: '2025-10-07',
        label: 'May-Jul 2025',
      });
      const ref = new Date('2025-11-01');
      const result = reconcileVatQuarter(currentQuarter, 6000, VAT_FRACTION, null, ref, PREV_FY_START);
      expect(result.status).toBe('unpaid');
    });

    it('falls back to unpaid when dataCutoffDate is null', () => {
      const oldQuarter = makeQuarter({
        startDate: '2023-05-01',
        endDate: '2023-07-31',
        dueDate: '2023-10-07',
        label: 'May-Jul 2023',
      });
      const ref = new Date('2025-07-01');
      const result = reconcileVatQuarter(oldQuarter, 6000, VAT_FRACTION, null, ref, null);
      expect(result.status).toBe('unpaid');
    });

    it('does not apply insufficient-data when a match exists (even old quarter)', () => {
      const oldQuarter = makeQuarter({
        startDate: '2023-05-01',
        endDate: '2023-07-31',
        dueDate: '2023-10-07',
        label: 'May-Jul 2023',
      });
      const ref = new Date('2025-07-01');
      const result = reconcileVatQuarter(oldQuarter, 6000, VAT_FRACTION,
        makePayment({ amount: -1000, date: '2023-09-15' }),
        ref, PREV_FY_START,
      );
      expect(result.status).toBe('paid');
    });

    it('returns insufficient-data for quarter ending exactly one day before cutoff', () => {
      const borderQuarter = makeQuarter({
        startDate: '2024-02-01',
        endDate: '2024-04-30',
        dueDate: '2024-06-07',
        label: 'Feb-Apr 2024',
      });
      const ref = new Date('2025-07-01');
      const result = reconcileVatQuarter(borderQuarter, 6000, VAT_FRACTION, null, ref, PREV_FY_START);
      expect(result.status).toBe('insufficient-data');
    });

    it('returns unpaid for quarter ending on or after cutoff', () => {
      const borderQuarter = makeQuarter({
        startDate: '2024-05-01',
        endDate: '2024-07-31',
        dueDate: '2024-10-07',
        label: 'May-Jul 2024',
      });
      const ref = new Date('2025-12-01');
      const result = reconcileVatQuarter(borderQuarter, 6000, VAT_FRACTION, null, ref, PREV_FY_START);
      expect(result.status).toBe('unpaid');
    });
  });
});
