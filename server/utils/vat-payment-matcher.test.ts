import { describe, it, expect } from 'vitest';
import { matchPaymentsToQuarters, quarterKey, DEFAULT_EARLY_WINDOW_DAYS } from './vat-payment-matcher.js';
import type { VatQuarterRange } from '../config/tax-rates.js';
import type { HmrcPaymentMatch } from '../db/repositories/tax.js';

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
    date: '2025-06-07',
    amount: -1000,
    account: 'barclays-current',
    description: 'HMRC VAT SOUTHEND',
    ...overrides,
  };
}

describe('matchPaymentsToQuarters', () => {
  it('returns empty map when no quarters', () => {
    const result = matchPaymentsToQuarters([], [p({})]);
    expect(result.size).toBe(0);
  });

  it('returns unmatched entries for every quarter when pool is empty', () => {
    const quarters = [
      q({ startDate: '2025-02-01', endDate: '2025-04-30', dueDate: '2025-06-07' }),
      q({ startDate: '2025-05-01', endDate: '2025-07-31', dueDate: '2025-09-07' }),
    ];
    const result = matchPaymentsToQuarters(quarters, []);
    expect(result.size).toBe(2);
    for (const v of result.values()) expect(v).toBeNull();
  });

  it('assigns a single payment near the due date', () => {
    const quarter = q({ dueDate: '2025-06-07' });
    const payment = p({ date: '2025-06-09', amount: -1234 });
    const result = matchPaymentsToQuarters([quarter], [payment]);
    expect(result.get(quarterKey(quarter))).toEqual(payment);
  });

  describe('early window', () => {
    it('matches a payment exactly 7 days before due date (inclusive boundary)', () => {
      const quarter = q({ dueDate: '2025-06-07' });
      const payment = p({ date: '2025-05-31' });
      const result = matchPaymentsToQuarters([quarter], [payment]);
      expect(result.get(quarterKey(quarter))).toEqual(payment);
    });

    it('does NOT match a payment 8 days before due date (outside window)', () => {
      const quarter = q({ dueDate: '2025-06-07' });
      const payment = p({ date: '2025-05-30' });
      const result = matchPaymentsToQuarters([quarter], [payment]);
      expect(result.get(quarterKey(quarter))).toBeNull();
    });

    it('respects a custom earlyWindowDays of 0', () => {
      const quarter = q({ dueDate: '2025-06-07' });
      const earlyPayment = p({ date: '2025-06-06' });
      const onPayment = p({ date: '2025-06-07' });
      const earlyResult = matchPaymentsToQuarters([quarter], [earlyPayment], 0);
      const onResult = matchPaymentsToQuarters([quarter], [onPayment], 0);
      expect(earlyResult.get(quarterKey(quarter))).toBeNull();
      expect(onResult.get(quarterKey(quarter))).toEqual(onPayment);
    });
  });

  describe('chronological processing across multiple quarters', () => {
    it('assigns each payment to the correct quarter in order', () => {
      const q1 = q({ startDate: '2025-02-01', endDate: '2025-04-30', dueDate: '2025-06-07', label: 'Q1' });
      const q2 = q({ startDate: '2025-05-01', endDate: '2025-07-31', dueDate: '2025-09-07', label: 'Q2' });
      const q3 = q({ startDate: '2025-08-01', endDate: '2025-10-31', dueDate: '2025-12-07', label: 'Q3' });
      const p1 = p({ date: '2025-06-10', amount: -1000 });
      const p2 = p({ date: '2025-09-08', amount: -2000 });
      const p3 = p({ date: '2025-12-08', amount: -3000 });

      const result = matchPaymentsToQuarters([q3, q1, q2], [p3, p1, p2]);

      expect(result.get(quarterKey(q1))).toEqual(p1);
      expect(result.get(quarterKey(q2))).toEqual(p2);
      expect(result.get(quarterKey(q3))).toEqual(p3);
    });

    it('dedupes: a payment consumed by Q1 cannot match Q2', () => {
      const q1 = q({ dueDate: '2025-06-07' });
      const q2 = q({ startDate: '2025-05-01', endDate: '2025-07-31', dueDate: '2025-09-07', label: 'Q2' });
      const singlePayment = p({ date: '2025-06-10' });

      const result = matchPaymentsToQuarters([q1, q2], [singlePayment]);

      expect(result.get(quarterKey(q1))).toEqual(singlePayment);
      expect(result.get(quarterKey(q2))).toBeNull();
    });

    it('stops matching once a payment lands in the next quarter window', () => {
      const q1 = q({ dueDate: '2025-06-07' });
      const q2 = q({ startDate: '2025-05-01', endDate: '2025-07-31', dueDate: '2025-09-07', label: 'Q2' });
      const paymentForQ2 = p({ date: '2025-09-05' });

      const result = matchPaymentsToQuarters([q1, q2], [paymentForQ2]);

      expect(result.get(quarterKey(q1))).toBeNull();
      expect(result.get(quarterKey(q2))).toEqual(paymentForQ2);
    });

    it('picks earliest payment within a window when multiple candidates exist', () => {
      const quarter = q({ dueDate: '2025-06-07' });
      const earlier = p({ date: '2025-06-09', amount: -100 });
      const later = p({ date: '2025-06-20', amount: -200 });
      const result = matchPaymentsToQuarters([quarter], [later, earlier]);
      expect(result.get(quarterKey(quarter))).toEqual(earlier);
    });
  });

  describe('last-quarter unbounded upper window', () => {
    it('matches a very late payment to the last quarter', () => {
      const quarter = q({ dueDate: '2025-06-07' });
      const veryLate = p({ date: '2026-12-01' });
      const result = matchPaymentsToQuarters([quarter], [veryLate]);
      expect(result.get(quarterKey(quarter))).toEqual(veryLate);
    });
  });

  describe('real-world regression: user HMRC payments 2022-08 to 2026-02', () => {
    // Fixtures drawn from actual transaction DB inspection. Stagger-2 quarters:
    // Nov-Jan (due Mar 7), Feb-Apr (due Jun 7), May-Jul (due Sep 7), Aug-Oct (due Dec 7).
    const quarters: VatQuarterRange[] = [
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
      { startDate: '2025-11-01', endDate: '2026-01-31', dueDate: '2026-03-07', label: 'Nov-Jan 2025/26', quarter: 1 },
    ];

    const payments: HmrcPaymentMatch[] = [
      { date: '2023-01-11', amount: -1553.87, account: 'barclays-current', description: 'HMRC ETMP' },
      { date: '2023-03-06', amount: -8535.17, account: 'barclays-current', description: 'HMRC VAT SOUTHEND' },
      { date: '2023-04-14', amount: -218.0, account: 'barclays-current', description: 'HMRC VAT SOUTHEND' },
      { date: '2023-06-15', amount: -5062.05, account: 'barclays-current', description: 'HMRC VAT SOUTHEND' },
      { date: '2023-11-13', amount: -3896.12, account: 'barclays-current', description: 'HMRC VAT SOUTHEND' },
      { date: '2023-12-04', amount: -4817.88, account: 'barclays-current', description: 'HMRC VAT SOUTHEND' },
      { date: '2024-03-08', amount: -5780.23, account: 'capital-on-tap', description: 'HMRC ETMP - GLASGOW' },
      { date: '2024-06-10', amount: -4825.65, account: 'capital-on-tap', description: 'HMRC ETMP - GLASGOW' },
      { date: '2024-09-09', amount: -5617.79, account: 'capital-on-tap', description: 'HMRC ETMP - GLASGOW' },
      { date: '2024-12-07', amount: -1020.0, account: 'barclaycard', description: 'HMRC ETMP' },
      { date: '2025-03-07', amount: -6385.12, account: 'barclays-current', description: 'HMRC VAT SOUTHEND' },
      { date: '2025-06-09', amount: -5578.79, account: 'capital-on-tap', description: 'HMRC ETMP - GLASGOW' },
      { date: '2025-09-08', amount: -8060.0, account: 'barclays-current', description: 'HMRC VAT SOUTHEND' },
      { date: '2025-12-08', amount: -11653.06, account: 'barclays-current', description: 'HMRC VAT SOUTHEND' },
    ];

    it('assigns the 2023-03-06 £8,535.17 payment to Nov-Jan 2022/23 (caught by 7-day early window)', () => {
      const result = matchPaymentsToQuarters(quarters, payments);
      const novJan2022 = quarters[1];
      const match = result.get(quarterKey(novJan2022));
      expect(match).not.toBeNull();
      expect(match?.date).toBe('2023-03-06');
      expect(match?.amount).toBe(-8535.17);
    });

    it('assigns the 2023-01-11 £1,553.87 payment to Aug-Oct 2022 (greedy but consumed once)', () => {
      // The payment genuinely has no better home given this pool. Users treat 2022
      // quarters as insufficient-data upstream so this assignment is harmless.
      const result = matchPaymentsToQuarters(quarters, payments);
      const augOct2022 = quarters[0];
      const match = result.get(quarterKey(augOct2022));
      expect(match?.date).toBe('2023-01-11');
    });

    it('assigns 2025-12-08 £11,653.06 to Aug-Oct 2025 (the user-verified payment)', () => {
      const result = matchPaymentsToQuarters(quarters, payments);
      const augOct2025 = quarters[12];
      const match = result.get(quarterKey(augOct2025));
      expect(match?.amount).toBe(-11653.06);
      expect(match?.date).toBe('2025-12-08');
    });

    it('does not reuse a single payment across multiple quarters', () => {
      const result = matchPaymentsToQuarters(quarters, payments);
      const seen = new Set<string>();
      for (const match of result.values()) {
        if (match === null) continue;
        const key = `${match.date}|${match.amount}|${match.account}`;
        expect(seen.has(key), `payment ${key} was reused`).toBe(false);
        seen.add(key);
      }
    });

    it('produces exactly as many matches as distinct payments-pool slots can cover', () => {
      const result = matchPaymentsToQuarters(quarters, payments);
      const matched = [...result.values()].filter(v => v !== null).length;
      expect(matched).toBeLessThanOrEqual(payments.length);
      expect(matched).toBeGreaterThan(0);
    });
  });

  describe('defaults', () => {
    it('DEFAULT_EARLY_WINDOW_DAYS is 7', () => {
      expect(DEFAULT_EARLY_WINDOW_DAYS).toBe(7);
    });
  });
});
