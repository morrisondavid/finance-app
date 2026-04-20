import { describe, it, expect } from 'vitest';
import { classifyRecurring } from './recurring-detector.js';
import type { RecurringCandidate, TransactionDetail } from './recurring-detector.js';

/**
 * Generate N months of transactions ending near the reference date (Apr 2026).
 */
function makeTxns(opts: { months: number; day?: number; amount?: number }): TransactionDetail[] {
  const day = opts.day ?? 15;
  const amount = opts.amount ?? 50;
  const txns: TransactionDetail[] = [];
  for (let i = opts.months - 1; i >= 0; i--) {
    const refMonth = 3; // March 2026 = most recent
    const refYear = 2026;
    const totalMonths = refYear * 12 + refMonth - i;
    const y = Math.floor(totalMonths / 12);
    const m = (totalMonths % 12) + 1;
    txns.push({ date: `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`, amount });
  }
  return txns;
}

function makeCandidate(overrides: Partial<RecurringCandidate> & { transactions?: TransactionDetail[] } = {}): RecurringCandidate {
  const txns = overrides.transactions ?? makeTxns({ months: 10 });
  const amounts = txns.map(t => t.amount);
  return {
    merchant: 'Test Merchant',
    category: 'Utilities',
    sourceAccount: 'natwest',
    accountCategory: 'personal',
    monthlyMax: Math.max(...amounts),
    monthlyAvg: amounts.reduce((s, v) => s + v, 0) / amounts.length,
    monthsActive: new Set(txns.map(t => t.date.slice(0, 7))).size,
    annualTotal: amounts.reduce((s, v) => s + v, 0),
    transactions: txns,
    ...overrides,
  };
}

const REF_DATE = new Date('2026-04-12');

describe('classifyRecurring – monthly', () => {
  it('classifies consistent monthly billing as monthly', () => {
    const c = makeCandidate({
      merchant: 'Netflix',
      transactions: makeTxns({ months: 10, day: 5, amount: 15.99 }),
    });
    const result = classifyRecurring([c], 12, REF_DATE);

    expect(result.monthly).toHaveLength(1);
    expect(result.monthly[0].merchant).toBe('Netflix');
    expect(result.monthly[0].frequency).toBe('monthly');
  });

  it('uses median per-transaction amount, not monthlyMax', () => {
    const txns: TransactionDetail[] = [
      { date: '2026-01-15', amount: 100 },
      { date: '2026-02-15', amount: 100 },
      { date: '2026-03-15', amount: 100 },
      { date: '2025-10-15', amount: 100 },
      { date: '2025-09-15', amount: 100 },
      { date: '2025-08-15', amount: 100 },
      { date: '2025-07-15', amount: 100 },
    ];
    const c = makeCandidate({ merchant: 'Consistent', transactions: txns, monthlyMax: 200 });
    const result = classifyRecurring([c], 12, REF_DATE);

    expect(result.monthly[0].amount).toBe(100);
  });

  it('includes billingDayOfMonth for monthly items', () => {
    const c = makeCandidate({
      merchant: 'Gym',
      transactions: makeTxns({ months: 10, day: 15, amount: 30 }),
    });
    const result = classifyRecurring([c], 12, REF_DATE);

    expect(result.monthly[0].billingDayOfMonth).toBe(15);
    expect(result.monthly[0].billingMonth).toBeNull();
  });

  it('rejects items with highly variable amounts', () => {
    const txns: TransactionDetail[] = [];
    for (let i = 0; i < 10; i++) {
      const m = i + 1;
      txns.push({ date: `2025-${String(m).padStart(2, '0')}-15`, amount: 10 + i * 70 });
    }
    const c = makeCandidate({ merchant: 'Variable Spend', transactions: txns, monthsActive: 10 });
    const result = classifyRecurring([c], 12, REF_DATE);

    expect(result.monthly).toHaveLength(0);
  });

  it('rejects items billed on wildly different days', () => {
    const days = [2, 9, 17, 24, 5, 12, 20, 27, 8, 15];
    const txns = days.map((d, i) => ({
      date: `2025-${String(i + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
      amount: 50,
    }));
    const c = makeCandidate({ merchant: 'Random Days', transactions: txns, monthsActive: 10 });
    const result = classifyRecurring([c], 12, REF_DATE);

    expect(result.monthly).toHaveLength(0);
  });

  it('allows small day variance (weekends / bank holidays)', () => {
    const days = [14, 15, 15, 16, 14, 15, 16, 15, 14, 15];
    const txns = days.map((d, i) => ({
      date: `2026-${String(i + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
      amount: 29.99,
    }));
    const c = makeCandidate({ merchant: 'Gym', transactions: txns, monthsActive: 10 });
    const result = classifyRecurring([c], 12, REF_DATE);

    expect(result.monthly).toHaveLength(1);
  });

  it('sorts monthly by amount descending', () => {
    const items = [
      makeCandidate({ merchant: 'A', transactions: makeTxns({ months: 10, amount: 10 }) }),
      makeCandidate({ merchant: 'B', transactions: makeTxns({ months: 10, amount: 50 }) }),
      makeCandidate({ merchant: 'C', transactions: makeTxns({ months: 10, amount: 30 }) }),
    ];
    const result = classifyRecurring(items, 12, REF_DATE);

    expect(result.monthly.map(e => e.merchant)).toEqual(['B', 'C', 'A']);
  });

  it('requires at least 2 transactions', () => {
    const c = makeCandidate({
      transactions: [{ date: '2025-06-15', amount: 50 }],
      monthsActive: 1,
    });
    const result = classifyRecurring([c], 12, REF_DATE);

    expect(result.monthly).toHaveLength(0);
    expect(result.annual).toHaveLength(0);
  });

  it('filters out stale subscriptions with no charge in last 2 months', () => {
    const txns: TransactionDetail[] = [];
    for (let i = 0; i < 8; i++) {
      txns.push({ date: `2025-${String(i + 1).padStart(2, '0')}-10`, amount: 79 });
    }
    const c = makeCandidate({ merchant: 'Cancelled Service', transactions: txns, monthsActive: 8 });
    const result = classifyRecurring([c], 12, REF_DATE);

    expect(result.monthly).toHaveLength(0);
  });

  it('keeps subscriptions with a recent charge', () => {
    const txns: TransactionDetail[] = [];
    for (let i = 0; i < 8; i++) {
      const m = i + 6;
      const y = m > 12 ? 2026 : 2025;
      const mm = m > 12 ? m - 12 : m;
      txns.push({ date: `${y}-${String(mm).padStart(2, '0')}-10`, amount: 30 });
    }
    txns.push({ date: '2026-03-10', amount: 30 });
    const c = makeCandidate({ merchant: 'Active Service', transactions: txns, monthsActive: 9 });
    const result = classifyRecurring([c], 12, REF_DATE);

    expect(result.monthly).toHaveLength(1);
  });

  it('exempts Council Tax from the staleness check', () => {
    const txns: TransactionDetail[] = [];
    for (let i = 4; i <= 12; i++) {
      txns.push({ date: `2025-${String(i).padStart(2, '0')}-15`, amount: 283 });
    }
    txns.push({ date: '2026-01-15', amount: 283 });
    const c = makeCandidate({ merchant: 'Council Tax', transactions: txns, monthsActive: 10 });
    const result = classifyRecurring([c], 12, REF_DATE);

    expect(result.monthly).toHaveLength(1);
    expect(result.monthly[0].merchant).toBe('Council Tax');
  });
});

describe('classifyRecurring – annual', () => {
  it('accepts 2 consecutive years when amounts are identical', () => {
    const txns: TransactionDetail[] = [
      { date: '2024-03-10', amount: 99.99 },
      { date: '2025-03-12', amount: 99.99 },
    ];
    const c = makeCandidate({ merchant: 'Ring Security', transactions: txns, monthsActive: 2 });
    const result = classifyRecurring([c], 24, REF_DATE);

    expect(result.annual).toHaveLength(1);
    expect(result.annual[0].frequency).toBe('annual');
  });

  it('requires 3+ years when amounts differ', () => {
    const txns: TransactionDetail[] = [
      { date: '2024-10-05', amount: 49.99 },
      { date: '2025-10-07', amount: 99.99 },
    ];
    const c = makeCandidate({ merchant: 'Price Changed', transactions: txns, monthsActive: 2 });
    const result = classifyRecurring([c], 24, REF_DATE);

    expect(result.annual).toHaveLength(0);
  });

  it('accepts 3 years with varied amounts', () => {
    const txns: TransactionDetail[] = [
      { date: '2023-10-05', amount: 89.99 },
      { date: '2024-10-05', amount: 99.99 },
      { date: '2025-10-07', amount: 99.99 },
    ];
    const c = makeCandidate({ merchant: 'Price Went Up', transactions: txns, monthsActive: 3 });
    const result = classifyRecurring([c], 36, REF_DATE);

    expect(result.annual).toHaveLength(1);
  });

  it('detects annual subscription even with other purchases mixed in (PlayStation pattern)', () => {
    const txns: TransactionDetail[] = [
      // Game purchases (noise) scattered across years
      { date: '2023-03-13', amount: 17.99 },
      { date: '2024-04-15', amount: 18.58 },
      { date: '2024-04-16', amount: 52.79 },
      { date: '2024-05-13', amount: 3.35 },
      { date: '2024-07-15', amount: 44.99 },
      { date: '2024-12-11', amount: 69.99 },
      { date: '2024-12-27', amount: 17.49 },
      { date: '2025-04-01', amount: 77.58 },
      { date: '2025-09-01', amount: 38.99 },
      { date: '2025-12-22', amount: 24.99 },
      // Annual subscription renewals (signal) — largest charge each year
      { date: '2023-10-02', amount: 99.99 },
      { date: '2024-10-04', amount: 99.99 },
      { date: '2025-10-07', amount: 99.99 },
    ];
    const c = makeCandidate({ merchant: 'PlayStation', category: 'Entertainment', transactions: txns, monthsActive: 12 });
    const result = classifyRecurring([c], 36, REF_DATE);

    expect(result.annual).toHaveLength(1);
    expect(result.annual[0].merchant).toBe('PlayStation');
    expect(result.annual[0].amount).toBe(99.99);
  });

  it('includes billingDayOfMonth and billingMonth for annual items', () => {
    const txns: TransactionDetail[] = [
      { date: '2023-10-03', amount: 99.99 },
      { date: '2024-10-04', amount: 99.99 },
      { date: '2025-10-07', amount: 99.99 },
    ];
    const c = makeCandidate({ merchant: 'PS Plus', transactions: txns, monthsActive: 3 });
    const result = classifyRecurring([c], 12, REF_DATE);

    expect(result.annual).toHaveLength(1);
    expect(result.annual[0].billingMonth).toBe(10);
    expect(result.annual[0].billingDayOfMonth).toBeDefined();
  });

  it('rejects annuals whose most recent charge is under £90', () => {
    const txns: TransactionDetail[] = [
      { date: '2024-10-21', amount: 59.99 },
      { date: '2025-10-21', amount: 59.99 },
    ];
    const c = makeCandidate({ merchant: 'Sub-threshold', transactions: txns, monthsActive: 2 });
    const result = classifyRecurring([c], 24, REF_DATE);

    expect(result.annual).toHaveLength(0);
  });

  it('rejects items that only appear in a single year', () => {
    const txns: TransactionDetail[] = [
      { date: '2025-03-10', amount: 50 },
      { date: '2025-06-12', amount: 50 },
    ];
    const c = makeCandidate({ merchant: 'Single Year', transactions: txns, monthsActive: 2 });
    const result = classifyRecurring([c], 12, REF_DATE);

    expect(result.annual).toHaveLength(0);
  });

  it('rejects items in non-consecutive years (e.g. 2023, 2024, and 2026, skipping 2025)', () => {
    const txns: TransactionDetail[] = [
      { date: '2023-06-10', amount: 100 },
      { date: '2024-06-10', amount: 100 },
      { date: '2026-06-10', amount: 100 },
    ];
    const c = makeCandidate({ merchant: 'Gap Year', transactions: txns, monthsActive: 3 });
    const result = classifyRecurring([c], 36, REF_DATE);

    expect(result.annual).toHaveLength(0);
  });

  it('rejects annual if billing months are very different across years', () => {
    const txns: TransactionDetail[] = [
      { date: '2023-01-15', amount: 100 },
      { date: '2024-07-15', amount: 100 },
      { date: '2025-01-15', amount: 100 },
    ];
    const c = makeCandidate({ merchant: 'Wrong Month', transactions: txns, monthsActive: 3 });
    const result = classifyRecurring([c], 36, REF_DATE);

    expect(result.annual).toHaveLength(0);
  });

  it('rejects annual if picked amounts vary too much across years', () => {
    const txns: TransactionDetail[] = [
      { date: '2023-08-24', amount: 12 },
      { date: '2024-08-24', amount: 86.49 },
      { date: '2025-08-24', amount: 30 },
    ];
    const c = makeCandidate({ merchant: 'Random Store', transactions: txns, monthsActive: 3 });
    const result = classifyRecurring([c], 36, REF_DATE);

    expect(result.annual).toHaveLength(0);
  });

  it('sorts annual by annualTotal descending', () => {
    const items = [
      makeCandidate({ merchant: 'X', transactions: [
        { date: '2023-06-10', amount: 100 }, { date: '2024-06-10', amount: 100 }, { date: '2025-06-10', amount: 100 },
      ], monthsActive: 3, annualTotal: 300 }),
      makeCandidate({ merchant: 'Y', transactions: [
        { date: '2023-03-10', amount: 200 }, { date: '2024-03-10', amount: 200 }, { date: '2025-03-10', amount: 200 },
      ], monthsActive: 3, annualTotal: 600 }),
    ];
    const result = classifyRecurring(items, 36, REF_DATE);

    expect(result.annual.map(e => e.merchant)).toEqual(['Y', 'X']);
  });

  it('uses most recent year amount for display', () => {
    const txns: TransactionDetail[] = [
      { date: '2023-10-05', amount: 89.99 },
      { date: '2024-10-05', amount: 94.99 },
      { date: '2025-10-07', amount: 99.99 },
    ];
    const c = makeCandidate({ merchant: 'Price Increase', transactions: txns, monthsActive: 3 });
    const result = classifyRecurring([c], 36, REF_DATE);

    expect(result.annual).toHaveLength(1);
    expect(result.annual[0].amount).toBe(99.99);
  });

  it('rejects annual when yearly picks land in different months across years', () => {
    // Consecutive years, identical amounts, low day-of-month stddev — would
    // have passed the old independent month/day gates, but the picks are
    // ~31 days apart on the calendar so the tightened gap check rejects it.
    const txns: TransactionDetail[] = [
      { date: '2024-01-10', amount: 120 },
      { date: '2025-02-10', amount: 120 },
    ];
    const c = makeCandidate({ merchant: 'Cross Month', transactions: txns, monthsActive: 2 });
    const result = classifyRecurring([c], 24, REF_DATE);

    expect(result.annual).toHaveLength(0);
  });

  it('rejects annual when most recent pick is under £90 even if earlier years were higher', () => {
    const txns: TransactionDetail[] = [
      { date: '2023-06-10', amount: 120 },
      { date: '2024-06-10', amount: 110 },
      { date: '2025-06-10', amount: 59.99 },
    ];
    const c = makeCandidate({ merchant: 'Dropped Below', transactions: txns, monthsActive: 3 });
    const result = classifyRecurring([c], 36, REF_DATE);

    expect(result.annual).toHaveLength(0);
  });
});

describe('classifyRecurring – edge cases', () => {
  it('handles empty candidates', () => {
    const result = classifyRecurring([], 12, REF_DATE);

    expect(result.monthly).toHaveLength(0);
    expect(result.annual).toHaveLength(0);
  });

  it('handles 0 monthsCovered', () => {
    const c = makeCandidate({ transactions: makeTxns({ months: 2, amount: 50 }) });
    const result = classifyRecurring([c], 0, REF_DATE);

    expect(result.monthly.length + result.annual.length).toBeGreaterThanOrEqual(0);
  });

  it('attaches logo URL for known merchants', () => {
    const c = makeCandidate({ merchant: 'Netflix', transactions: makeTxns({ months: 10, amount: 15.99 }) });
    const result = classifyRecurring([c], 12, REF_DATE);

    expect(result.monthly[0].logoUrl).toBe('https://logo.clearbit.com/netflix.com');
  });

  it('attaches null logo for unknown merchants', () => {
    const c = makeCandidate({ merchant: 'Obscure Shop', transactions: makeTxns({ months: 10, amount: 25 }) });
    const result = classifyRecurring([c], 12, REF_DATE);

    expect(result.monthly[0].logoUrl).toBeNull();
  });

  it('assigns category colour', () => {
    const c = makeCandidate({ category: 'Entertainment', transactions: makeTxns({ months: 10, amount: 10 }) });
    const result = classifyRecurring([c], 12, REF_DATE);

    expect(result.monthly[0].colour).toBe('#A855F7');
  });
});

// ===========================================================================
// Property income (rental) — relaxed thresholds when isIncome=true
// ===========================================================================

function makeVaryingRentTxns(months: number, baseAmount: number): TransactionDetail[] {
  const txns: TransactionDetail[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const refMonth = 3;
    const refYear = 2026;
    const totalMonths = refYear * 12 + refMonth - i;
    const y = Math.floor(totalMonths / 12);
    const m = (totalMonths % 12) + 1;
    // Simulate agent deducting fees some months (lower amounts)
    const amount = i % 3 === 0 ? baseAmount * 0.7 : baseAmount;
    txns.push({ date: `${y}-${String(m).padStart(2, '0')}-02`, amount });
  }
  return txns;
}

describe('classifyRecurring – Property income (rental)', () => {
  it('Property income with only 2 months is classified as monthly recurring', () => {
    const c = makeCandidate({
      merchant: 'Prospect Holdings',
      category: 'Property',
      transactions: makeTxns({ months: 2, day: 2, amount: 1900 }),
    });
    const result = classifyRecurring([c], 12, REF_DATE, true);

    expect(result.monthly).toHaveLength(1);
    expect(result.monthly[0].merchant).toBe('Prospect Holdings');
  });

  it('Property income with varying amounts (agent deductions) is classified', () => {
    const txns = makeVaryingRentTxns(6, 1900);
    const c = makeCandidate({
      merchant: 'Stoneshaw Estates',
      category: 'Property',
      transactions: txns,
      monthsActive: 6,
    });
    const result = classifyRecurring([c], 12, REF_DATE, true);

    expect(result.monthly).toHaveLength(1);
    expect(result.monthly[0].merchant).toBe('Stoneshaw Estates');
  });

  it('Property income uses max amount (gross rent) not median', () => {
    const txns = makeVaryingRentTxns(6, 1900);
    const c = makeCandidate({
      merchant: 'Stoneshaw Estates',
      category: 'Property',
      transactions: txns,
      monthsActive: 6,
    });
    const result = classifyRecurring([c], 12, REF_DATE, true);

    expect(result.monthly[0].amount).toBe(1900);
  });

  it('Property income skips staleness check', () => {
    // All transactions are old (> 2 months ago) — would be stale under normal rules
    const txns: TransactionDetail[] = [];
    for (let i = 11; i >= 4; i--) {
      const totalMonths = 2026 * 12 + 3 - i;
      const y = Math.floor(totalMonths / 12);
      const m = (totalMonths % 12) + 1;
      txns.push({ date: `${y}-${String(m).padStart(2, '0')}-02`, amount: 1500 });
    }
    const c = makeCandidate({
      merchant: 'Prospect Holdings',
      category: 'Property',
      transactions: txns,
      monthsActive: txns.length,
    });
    const result = classifyRecurring([c], 12, REF_DATE, true);

    expect(result.monthly).toHaveLength(1);
  });

  it('non-Property income with only 2 months is NOT classified (standard threshold)', () => {
    const c = makeCandidate({
      merchant: 'Random Sender',
      category: 'Other',
      transactions: makeTxns({ months: 2, day: 10, amount: 500 }),
    });
    const result = classifyRecurring([c], 12, REF_DATE, true);

    expect(result.monthly).toHaveLength(0);
  });

  it('non-Property income passing standard thresholds is still classified (no regression)', () => {
    const c = makeCandidate({
      merchant: 'Interest Credit',
      category: 'Other',
      transactions: makeTxns({ months: 10, day: 1, amount: 12.50 }),
    });
    const result = classifyRecurring([c], 12, REF_DATE, true);

    expect(result.monthly).toHaveLength(1);
    expect(result.monthly[0].merchant).toBe('Interest Credit');
  });

  it('Property expense (isIncome=false) uses standard thresholds, not relaxed', () => {
    const c = makeCandidate({
      merchant: 'Plumber',
      category: 'Property',
      transactions: makeTxns({ months: 2, day: 15, amount: 200 }),
    });
    const result = classifyRecurring([c], 12, REF_DATE, false);

    expect(result.monthly).toHaveLength(0);
  });
});

// ===========================================================================
// Declared fixed bills (FIXED_BILL_OVERRIDES with relaxedMinMonths)
// ===========================================================================

describe('classifyRecurring – declared fixed bills', () => {
  it('classifies a declared-fixed expense as monthly after only 1 transaction (config is the signal)', () => {
    const c = makeCandidate({
      merchant: 'MCE Advisory',
      category: 'Business',
      transactions: [{ date: '2026-04-01', amount: 4200 }],
      monthsActive: 1,
      declaredFrequency: 'monthly',
    });
    const result = classifyRecurring([c], 1, REF_DATE);

    expect(result.monthly).toHaveLength(1);
    expect(result.monthly[0].merchant).toBe('MCE Advisory');
    expect(result.monthly[0].frequency).toBe('monthly');
  });

  it('a non-declared candidate with only 1 transaction is NOT classified (no regression)', () => {
    const c = makeCandidate({
      merchant: 'One-off Vendor',
      transactions: [{ date: '2026-04-01', amount: 4200 }],
      monthsActive: 1,
    });
    const result = classifyRecurring([c], 1, REF_DATE);

    expect(result.monthly).toHaveLength(0);
  });

  it('classifies a declared-fixed expense as monthly after only 2 transactions over 24 months', () => {
    const c = makeCandidate({
      merchant: 'MCE Advisory',
      category: 'Business',
      transactions: [
        { date: '2026-02-27', amount: 4200 },
        { date: '2026-03-28', amount: 4200 },
      ],
      monthsActive: 2,
      declaredFrequency: 'monthly',
    });
    const result = classifyRecurring([c], 24, REF_DATE);

    expect(result.monthly).toHaveLength(1);
    expect(result.monthly[0].merchant).toBe('MCE Advisory');
    expect(result.monthly[0].frequency).toBe('monthly');
  });

  it('a non-declared candidate with only 2 months in 24 is NOT classified (no regression)', () => {
    const c = makeCandidate({
      merchant: 'Some Vendor',
      category: 'Business',
      transactions: [
        { date: '2026-02-27', amount: 4200 },
        { date: '2026-03-28', amount: 4200 },
      ],
      monthsActive: 2,
    });
    const result = classifyRecurring([c], 24, REF_DATE);

    expect(result.monthly).toHaveLength(0);
  });

  it('declared-fixed candidates skip the day-of-month stddev gate (invoice timing drifts)', () => {
    // Day-of-month stddev here would normally fail MONTHLY_DAY_STDDEV_MAX.
    // Dates span Jul 2025–Apr 2026 so the most recent month is within the
    // staleness window relative to REF_DATE (2026-04-12).
    const days = [2, 9, 17, 24, 5, 12, 20, 27, 8, 3];
    const txns = days.map((d, i) => {
      const totalMonths = 2026 * 12 + 3 - (days.length - 1 - i);
      const y = Math.floor(totalMonths / 12);
      const m = (totalMonths % 12) + 1;
      return {
        date: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
        amount: 4200,
      };
    });
    const c = makeCandidate({
      merchant: 'MCE Advisory',
      category: 'Business',
      transactions: txns,
      monthsActive: 10,
      declaredFrequency: 'monthly',
    });
    const result = classifyRecurring([c], 12, REF_DATE);

    expect(result.monthly).toHaveLength(1);
  });

  it('declared-fixed tolerates wider amount variance than standard monthly', () => {
    // Amounts vary ~15% (invoice + VAT rounding); standard CV gate is tight.
    const txns: TransactionDetail[] = [
      { date: '2026-02-27', amount: 4000 },
      { date: '2026-03-28', amount: 4600 },
    ];
    const c = makeCandidate({
      merchant: 'MCE Advisory',
      category: 'Business',
      transactions: txns,
      monthsActive: 2,
      declaredFrequency: 'monthly',
    });
    const result = classifyRecurring([c], 24, REF_DATE);

    expect(result.monthly).toHaveLength(1);
  });
});
