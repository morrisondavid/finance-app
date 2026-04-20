import { describe, it, expect } from 'vitest';
import {
  buildRecurringPipeline,
  accKey,
  amountBucket,
  recurringKey,
  type RawTransaction,
} from './recurring-pipeline.js';
import type { RecurringExpense } from '../../shared/api-contracts.js';

function makeTxn(overrides: Partial<RawTransaction> & { date: string; description: string; amount: number }): RawTransaction {
  return {
    id: Math.floor(Math.random() * 100000),
    account: 'barclays-current',
    type: 'expense',
    ...overrides,
  };
}

function monthlyExpenseTxns(
  description: string,
  amount: number,
  months: number,
  account = 'barclays-current',
): RawTransaction[] {
  const txns: RawTransaction[] = [];
  for (let i = 0; i < months; i++) {
    const m = 12 - i;
    const year = m > 0 ? 2025 : 2024;
    const month = ((m - 1 + 12) % 12) + 1;
    txns.push(makeTxn({
      date: `${year}-${String(month).padStart(2, '0')}-15`,
      description,
      amount: -amount,
      account,
    }));
  }
  return txns;
}

describe('amountBucket', () => {
  it('clusters amortizing loan amounts (BBL £508-£538) into same bucket', () => {
    const buckets = new Set([508, 515, 520, 525, 530, 538].map(amountBucket));
    expect(buckets.size).toBe(1);
  });

  it('separates clearly distinct amounts from same merchant (Apple £2.99 vs £16.99)', () => {
    expect(amountBucket(2.99)).not.toBe(amountBucket(16.99));
  });

  it('separates two finance products (£232 vs £193)', () => {
    expect(amountBucket(232)).not.toBe(amountBucket(193));
  });

  it('separates two mortgages (£1055 vs £631)', () => {
    expect(amountBucket(1055)).not.toBe(amountBucket(631));
  });

  it('returns 0 for sub-pound amounts', () => {
    expect(amountBucket(0.50)).toBe(0);
    expect(amountBucket(0)).toBe(0);
  });
});

describe('accKey', () => {
  it('produces distinct keys for different amounts', () => {
    const k1 = accKey('Debt', 'BPF', 'barclays', 97);
    const k2 = accKey('Debt', 'BPF', 'barclays', 232);
    expect(k1).not.toBe(k2);
  });

  it('groups similar amounts within ~20% tolerance', () => {
    const k1 = accKey('Debt', 'BBL', 'barclays', 508);
    const k2 = accKey('Debt', 'BBL', 'barclays', 538);
    expect(k1).toBe(k2);
  });
});

describe('recurringKey', () => {
  it('round-trips with accKey for the same item', () => {
    const item: RecurringExpense = {
      merchant: 'Netflix',
      category: 'Entertainment',
      amount: 15.99,
      frequency: 'monthly',
      sourceAccount: 'barclays-current',
      billingDayOfMonth: 5,
      billingMonth: null,
      colour: '#A855F7',
      monthsActive: 12,
      annualTotal: 191.88,
      logoUrl: null,
    };
    const expected = accKey('Entertainment', 'Netflix', 'barclays-current', 15.99);
    expect(recurringKey(item)).toBe(expected);
  });

  it('uses zero amount bucket for Payroll (stable key like Property)', () => {
    const item: RecurringExpense = {
      merchant: 'Director salary — David',
      category: 'Payroll',
      amount: 758,
      frequency: 'monthly',
      sourceAccount: 'barclays-current',
      billingDayOfMonth: 1,
      billingMonth: null,
      colour: '#0D9488',
      monthsActive: 12,
      annualTotal: 9096,
      logoUrl: null,
    };
    expect(recurringKey(item)).toBe(accKey('Payroll', 'Director salary — David', 'barclays-current', 0));
  });
});

describe('buildRecurringPipeline', () => {
  it('returns empty transaction-driven results when given no transactions', () => {
    const result = buildRecurringPipeline({
      scopedTransactions: [],
      allTimeTransactions: [],
      includeIncome: true,
    });
    // With zero transactions the pipeline's synthesised-declaration pass
    // still emits a row for every declared outgoing (so Fixed Expenses shows
    // bills that the user has declared but not yet paid). Those rows all
    // carry `declaredObligationId`; any transaction-driven row would not.
    const transactionDriven = result.monthlyExpenseRecurring.filter(
      e => e.declaredObligationId === undefined,
    );
    expect(transactionDriven).toHaveLength(0);
    expect(result.monthlyIncomeRecurring).toHaveLength(0);
    expect(result.monthsCovered).toBe(1);
  });

  it('skips transfers categorised as Transfers', () => {
    const txns = monthlyExpenseTxns('DAVID MORRISON', 500, 10);
    const result = buildRecurringPipeline({
      scopedTransactions: txns,
      allTimeTransactions: txns,
      includeIncome: false,
    });
    expect(result.expenseCandidates).toHaveLength(0);
  });

  it('includes director salary transfer as Payroll (config matches amount + payee)', () => {
    const txns: RawTransaction[] = [];
    const now = new Date();
    for (let i = 0; i < 10; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 15);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      txns.push(makeTxn({
        date: `${y}-${m}-15`,
        description: 'STO SALARY DAVID MORRISON',
        amount: -758,
        type: 'transfer',
        account: 'barclays-current',
      }));
    }
    const result = buildRecurringPipeline({
      scopedTransactions: txns,
      allTimeTransactions: txns,
      includeIncome: false,
    });
    const payrollLines = result.monthlyExpenseRecurring.filter(e => e.category === 'Payroll');
    expect(payrollLines.length).toBeGreaterThanOrEqual(1);
    expect(payrollLines.some(p => p.merchant === 'Director salary — David')).toBe(true);
  });

  it('skips income when includeIncome is false', () => {
    const incomeTxns: RawTransaction[] = [];
    for (let i = 0; i < 10; i++) {
      incomeTxns.push(makeTxn({
        date: `2025-${String(i + 1).padStart(2, '0')}-28`,
        description: 'SALARY FROM EMPLOYER',
        amount: 3000,
        type: 'income',
      }));
    }
    const result = buildRecurringPipeline({
      scopedTransactions: incomeTxns,
      allTimeTransactions: incomeTxns,
      includeIncome: false,
    });
    expect(result.incomeCandidates).toHaveLength(0);
  });

  it('includes income when includeIncome is true', () => {
    const incomeTxns: RawTransaction[] = [];
    for (let i = 0; i < 10; i++) {
      incomeTxns.push(makeTxn({
        date: `2025-${String(i + 1).padStart(2, '0')}-28`,
        description: 'SALARY FROM EMPLOYER',
        amount: 3000,
        type: 'income',
      }));
    }
    const result = buildRecurringPipeline({
      scopedTransactions: incomeTxns,
      allTimeTransactions: incomeTxns,
      includeIncome: true,
    });
    expect(result.incomeCandidates.length).toBeGreaterThan(0);
  });

  it('filters out pass-through IDs', () => {
    const txns = monthlyExpenseTxns('SCOTTISH POWER', 85, 10);
    const passThroughIds = new Set(txns.map(t => t.id));
    const result = buildRecurringPipeline({
      scopedTransactions: txns,
      allTimeTransactions: txns,
      passThroughIds,
      includeIncome: false,
    });
    expect(result.expenseCandidates).toHaveLength(0);
  });

  it('keeps two payments to the same merchant at different amounts as separate accumulators', () => {
    const txns1 = monthlyExpenseTxns('BARCLAYS PARTNER FINANCE', 97.5, 10);
    const txns2 = monthlyExpenseTxns('BARCLAYS PARTNER FINANCE', 143.2, 10);
    const all = [...txns1, ...txns2];
    const result = buildRecurringPipeline({
      scopedTransactions: all,
      allTimeTransactions: all,
      includeIncome: false,
    });
    const bpfAccumulators = [...result.expenseAccumulators.values()].filter(
      a => a.merchant.includes('Barclays Partner'),
    );
    expect(bpfAccumulators.length).toBe(2);
  });

  it('attaches all-time transactions to accumulators built from scoped pass', () => {
    const scoped = monthlyExpenseTxns('SCOTTISH POWER', 85, 6);
    const historical = monthlyExpenseTxns('SCOTTISH POWER', 85, 24);
    const result = buildRecurringPipeline({
      scopedTransactions: scoped,
      allTimeTransactions: historical,
      includeIncome: false,
    });
    const acc = [...result.expenseAccumulators.values()].find(
      a => a.merchant.includes('Scottish Power'),
    );
    expect(acc).toBeDefined();
    expect(acc!.transactions.length).toBeGreaterThanOrEqual(scoped.length);
  });

  it('correctly counts monthsCovered from scoped transactions', () => {
    const txns = monthlyExpenseTxns('SCOTTISH POWER', 85, 5);
    const result = buildRecurringPipeline({
      scopedTransactions: txns,
      allTimeTransactions: txns,
      includeIncome: false,
    });
    expect(result.monthsCovered).toBe(5);
  });

  // =========================================================================
  // Income transfer filtering — merchant registry is single source of truth
  // =========================================================================

  function monthlyIncomeTxns(
    description: string,
    amount: number,
    months: number,
    account = 'monzo-joint',
  ): RawTransaction[] {
    const txns: RawTransaction[] = [];
    for (let i = 0; i < months; i++) {
      const m = 12 - i;
      const year = m > 0 ? 2025 : 2024;
      const month = ((m - 1 + 12) % 12) + 1;
      txns.push(makeTxn({
        date: `${year}-${String(month).padStart(2, '0')}-02`,
        description,
        amount,
        type: 'income',
        account,
      }));
    }
    return txns;
  }

  it('excludes DAVID MORRISON income credits (Transfer)', () => {
    const txns = monthlyIncomeTxns('DAVID MORRISON', 1900, 10);
    const result = buildRecurringPipeline({
      scopedTransactions: txns,
      allTimeTransactions: txns,
      includeIncome: true,
    });
    expect(result.incomeCandidates).toHaveLength(0);
  });

  it('excludes HEENA TAILOR income credits (Transfer)', () => {
    const txns = monthlyIncomeTxns('HEENA TAILOR', 1900, 10);
    const result = buildRecurringPipeline({
      scopedTransactions: txns,
      allTimeTransactions: txns,
      includeIncome: true,
    });
    expect(result.incomeCandidates).toHaveLength(0);
  });

  it('excludes MONZO JOINT income credits (Transfer)', () => {
    const txns = monthlyIncomeTxns('MONZO JOINT', 500, 10, 'barclays-current');
    const result = buildRecurringPipeline({
      scopedTransactions: txns,
      allTimeTransactions: txns,
      includeIncome: true,
    });
    expect(result.incomeCandidates).toHaveLength(0);
  });

  it('excludes AUTONIZE income credits (Transfer — own company)', () => {
    const txns = monthlyIncomeTxns('AUTONIZE LTD SALARY', 2500, 10, 'natwest');
    const result = buildRecurringPipeline({
      scopedTransactions: txns,
      allTimeTransactions: txns,
      includeIncome: true,
    });
    expect(result.incomeCandidates).toHaveLength(0);
  });

  it('excludes VIA MOBILE income credits (Transfer)', () => {
    const txns = monthlyIncomeTxns('VIA MOBILE', 300, 10);
    const result = buildRecurringPipeline({
      scopedTransactions: txns,
      allTimeTransactions: txns,
      includeIncome: true,
    });
    expect(result.incomeCandidates).toHaveLength(0);
  });

  it('excludes BARCLAYS STO income credits (Transfer)', () => {
    const txns = monthlyIncomeTxns('BARCLAYS 123 STO', 1000, 10);
    const result = buildRecurringPipeline({
      scopedTransactions: txns,
      allTimeTransactions: txns,
      includeIncome: true,
    });
    expect(result.incomeCandidates).toHaveLength(0);
  });

  it('includes genuinely external income (tenant rent)', () => {
    const txns = monthlyIncomeTxns('JOHN SMITH RENT', 1500, 10);
    const result = buildRecurringPipeline({
      scopedTransactions: txns,
      allTimeTransactions: txns,
      includeIncome: true,
    });
    expect(result.incomeCandidates.length).toBeGreaterThan(0);
    expect(result.incomeCandidates[0].merchant).toContain('John Smith');
  });

  it('includes bank interest as income', () => {
    const txns = monthlyIncomeTxns('INTEREST CREDIT', 12.50, 10, 'natwest');
    const result = buildRecurringPipeline({
      scopedTransactions: txns,
      allTimeTransactions: txns,
      includeIncome: true,
    });
    expect(result.incomeCandidates.length).toBeGreaterThan(0);
  });

  it('includes HMRC refund as income', () => {
    const txns = monthlyIncomeTxns('HMRC REFUND', 250, 10, 'barclays-current');
    const result = buildRecurringPipeline({
      scopedTransactions: txns,
      allTimeTransactions: txns,
      includeIncome: true,
    });
    expect(result.incomeCandidates.length).toBeGreaterThan(0);
  });

  it('expense debits for Transfer merchants are still excluded (no regression)', () => {
    const txns = monthlyExpenseTxns('DAVID MORRISON', 500, 10);
    const result = buildRecurringPipeline({
      scopedTransactions: txns,
      allTimeTransactions: txns,
      includeIncome: true,
    });
    expect(result.expenseCandidates).toHaveLength(0);
  });

  it('expense debits for normal merchants are still included (no regression)', () => {
    const txns = monthlyExpenseTxns('TESCO STORES', 120, 10);
    const result = buildRecurringPipeline({
      scopedTransactions: txns,
      allTimeTransactions: txns,
      includeIncome: true,
    });
    expect(result.expenseCandidates.length).toBeGreaterThan(0);
  });

  // =========================================================================
  // Property income — category preserved, flows into monthlyIncomeRecurring
  // =========================================================================

  it('Property income credits preserve real category (not overridden to Income)', () => {
    const txns = monthlyIncomeTxns('PROSPECT HOLDINGS', 1900, 10);
    const result = buildRecurringPipeline({
      scopedTransactions: txns,
      allTimeTransactions: txns,
      includeIncome: true,
    });
    const acc = [...result.incomeAccumulators.values()].find(
      a => a.merchant === '56 Thorney House',
    );
    expect(acc).toBeDefined();
    expect(acc!.category).toBe('Property');
  });

  it('STONESHAW income credits accumulate with category Property', () => {
    const txns = monthlyIncomeTxns('STONESHAW ESTATES', 1500, 10);
    const result = buildRecurringPipeline({
      scopedTransactions: txns,
      allTimeTransactions: txns,
      includeIncome: true,
    });
    const acc = [...result.incomeAccumulators.values()].find(
      a => a.merchant === '78 Hunters Square',
    );
    expect(acc).toBeDefined();
    expect(acc!.category).toBe('Property');
  });

  it('Property income with 3 months of data appears in monthlyIncomeRecurring', () => {
    const txns = monthlyIncomeTxns('PROSPECT HOLDINGS', 1900, 3);
    const result = buildRecurringPipeline({
      scopedTransactions: txns,
      allTimeTransactions: txns,
      includeIncome: true,
    });
    expect(result.monthlyIncomeRecurring.length).toBeGreaterThan(0);
    const rent = result.monthlyIncomeRecurring.find(e => e.merchant === '56 Thorney House');
    expect(rent).toBeDefined();
    expect(rent!.category).toBe('Property');
  });

  it('normal expense categorisation unchanged after income category change (no regression)', () => {
    const expTxns = monthlyExpenseTxns('SCOTTISH POWER', 85, 10);
    const incTxns = monthlyIncomeTxns('PROSPECT HOLDINGS', 1900, 10);
    const all = [...expTxns, ...incTxns];
    const result = buildRecurringPipeline({
      scopedTransactions: all,
      allTimeTransactions: all,
      includeIncome: true,
    });
    const sp = [...result.expenseAccumulators.values()].find(
      a => a.merchant.includes('Scottish Power'),
    );
    expect(sp).toBeDefined();
    expect(sp!.category).toBe('Utilities');
  });

  // =========================================================================
  // Amortizing loan — variable amounts cluster into one accumulator
  // =========================================================================

  it('amortizing loan (BBL-like) with gradually decreasing amounts clusters into one accumulator', () => {
    const txns: RawTransaction[] = [];
    for (let i = 0; i < 12; i++) {
      const totalMonth = 2026 * 12 + 3 - i;
      const year = Math.floor(totalMonth / 12);
      const month = (totalMonth % 12) + 1;
      const amount = 538 - i * 2.5;
      txns.push(makeTxn({
        date: `${year}-${String(month).padStart(2, '0')}-15`,
        description: 'BARCLAYS 0520A6538148615 DDR',
        amount: -amount,
        account: 'barclays-current',
      }));
    }
    const result = buildRecurringPipeline({
      scopedTransactions: txns,
      allTimeTransactions: txns,
      includeIncome: false,
    });
    const bblAccumulators = [...result.expenseAccumulators.values()].filter(
      a => a.merchant === 'Bounce Back Loan',
    );
    expect(bblAccumulators).toHaveLength(1);
    expect(bblAccumulators[0].monthlyTotals.size).toBe(12);
  });

  it('amortizing loan detected as monthly recurring expense', () => {
    const txns: RawTransaction[] = [];
    for (let i = 0; i < 12; i++) {
      const totalMonth = 2026 * 12 + 3 - i;
      const year = Math.floor(totalMonth / 12);
      const month = (totalMonth % 12) + 1;
      const amount = 538 - i * 2.5;
      txns.push(makeTxn({
        date: `${year}-${String(month).padStart(2, '0')}-15`,
        description: 'BARCLAYS 0520A6538148615 DDR',
        amount: -amount,
        account: 'barclays-current',
      }));
    }
    const result = buildRecurringPipeline({
      scopedTransactions: txns,
      allTimeTransactions: txns,
      includeIncome: false,
    });
    const bbl = result.monthlyExpenseRecurring.find(e => e.merchant === 'Bounce Back Loan');
    expect(bbl).toBeDefined();
    expect(bbl!.category).toBe('Debt Repayment');
  });

  it('distinct amounts from same merchant stay separate (Apple £2.99 vs £16.99)', () => {
    const txns: RawTransaction[] = [];
    for (let i = 0; i < 10; i++) {
      const m = 12 - i;
      const year = m > 0 ? 2025 : 2024;
      const month = ((m - 1 + 12) % 12) + 1;
      const date = `${year}-${String(month).padStart(2, '0')}-15`;
      txns.push(makeTxn({ date, description: 'APPLE.COM/BILL', amount: -2.99 }));
      txns.push(makeTxn({ date, description: 'APPLE.COM/BILL', amount: -16.99 }));
    }
    const result = buildRecurringPipeline({
      scopedTransactions: txns,
      allTimeTransactions: txns,
      includeIncome: false,
    });
    const appleAccumulators = [...result.expenseAccumulators.values()].filter(
      a => a.merchant === 'Apple',
    );
    expect(appleAccumulators).toHaveLength(2);
  });

  // =========================================================================
  // Config-driven rental property merging
  // =========================================================================

  it('Stoneshaw credits at varying amounts merge into one accumulator named after the property', () => {
    const amounts = [1292.72, 1190.72, 984.80, 776.72, 1292.72, 1100.00];
    const txns: RawTransaction[] = amounts.map((amt, i) => {
      const totalMonth = 2026 * 12 + 3 - i;
      const year = Math.floor(totalMonth / 12);
      const month = (totalMonth % 12) + 1;
      return makeTxn({
        date: `${year}-${String(month).padStart(2, '0')}-21`,
        description: 'STONESHAW ESTATES',
        amount: amt,
        account: 'monzo-joint',
        type: 'income',
      });
    });
    const result = buildRecurringPipeline({
      scopedTransactions: txns,
      allTimeTransactions: txns,
      includeIncome: true,
    });
    const stoneshaw = [...result.incomeAccumulators.values()].filter(
      a => a.category === 'Property',
    );
    expect(stoneshaw).toHaveLength(1);
    expect(stoneshaw[0].merchant).toBe('78 Hunters Square');
    expect(stoneshaw[0].monthlyTotals.size).toBe(6);
  });

  it('Prospect credits merge into one accumulator named after the property', () => {
    const amounts = [979.20, 804.52, 979.20, 750.00];
    const txns: RawTransaction[] = amounts.map((amt, i) => {
      const totalMonth = 2026 * 12 + 3 - i;
      const year = Math.floor(totalMonth / 12);
      const month = (totalMonth % 12) + 1;
      return makeTxn({
        date: `${year}-${String(month).padStart(2, '0')}-03`,
        description: 'PROSPECT HOLDINGS',
        amount: amt,
        account: 'monzo-joint',
        type: 'income',
      });
    });
    const result = buildRecurringPipeline({
      scopedTransactions: txns,
      allTimeTransactions: txns,
      includeIncome: true,
    });
    const prospect = [...result.incomeAccumulators.values()].filter(
      a => a.category === 'Property',
    );
    expect(prospect).toHaveLength(1);
    expect(prospect[0].merchant).toBe('56 Thorney House');
  });

  it('two different Property merchants produce two separate accumulators', () => {
    const txns: RawTransaction[] = [];
    for (let i = 0; i < 6; i++) {
      const totalMonth = 2026 * 12 + 3 - i;
      const year = Math.floor(totalMonth / 12);
      const month = (totalMonth % 12) + 1;
      const date = `${year}-${String(month).padStart(2, '0')}-15`;
      txns.push(makeTxn({ date, description: 'STONESHAW ESTATES', amount: 1292.72, account: 'monzo-joint', type: 'income' }));
      txns.push(makeTxn({ date, description: 'PROSPECT HOLDINGS', amount: 979.20, account: 'monzo-joint', type: 'income' }));
    }
    const result = buildRecurringPipeline({
      scopedTransactions: txns,
      allTimeTransactions: txns,
      includeIncome: true,
    });
    const props = [...result.incomeAccumulators.values()].filter(
      a => a.category === 'Property',
    );
    expect(props).toHaveLength(2);
    const names = props.map(p => p.merchant).sort();
    expect(names).toEqual(['56 Thorney House', '78 Hunters Square']);
  });

  // =========================================================================
  // Config-driven fixed bill overrides (EE mobile)
  // =========================================================================

  it('EE LIMITED varying amounts merge into one accumulator (fixed bill override)', () => {
    const amounts = [158.68, 122.19, 172.99, 105.97, 92.95, 105.95, 135.94, 85.95, 83.95, 88.95, 76.0, 118.68];
    const txns: RawTransaction[] = amounts.map((amt, i) => {
      const totalMonth = 2026 * 12 + 3 - i;
      const year = Math.floor(totalMonth / 12);
      const month = (totalMonth % 12) + 1;
      return makeTxn({
        date: `${year}-${String(month).padStart(2, '0')}-23`,
        description: 'EE LIMITED Q0447 DD',
        amount: -amt,
        account: 'barclays-current',
      });
    });
    const result = buildRecurringPipeline({
      scopedTransactions: txns,
      allTimeTransactions: txns,
      includeIncome: false,
    });
    const eeAccumulators = [...result.expenseAccumulators.values()].filter(
      a => a.merchant === 'EE',
    );
    expect(eeAccumulators).toHaveLength(1);
    expect(eeAccumulators[0].monthlyTotals.size).toBe(12);
  });

  it('EE recurring expense amount is overridden to configured £180', () => {
    const amounts = [158.68, 122.19, 172.99, 105.97, 92.95, 105.95, 135.94, 85.95, 83.95, 88.95, 76.0, 118.68];
    const txns: RawTransaction[] = amounts.map((amt, i) => {
      const totalMonth = 2026 * 12 + 3 - i;
      const year = Math.floor(totalMonth / 12);
      const month = (totalMonth % 12) + 1;
      return makeTxn({
        date: `${year}-${String(month).padStart(2, '0')}-23`,
        description: 'EE LIMITED Q0447 DD',
        amount: -amt,
        account: 'barclays-current',
      });
    });
    const result = buildRecurringPipeline({
      scopedTransactions: txns,
      allTimeTransactions: txns,
      includeIncome: false,
    });
    const ee = result.monthlyExpenseRecurring.find(e => e.merchant === 'EE');
    expect(ee).toBeDefined();
    expect(ee!.amount).toBe(180);
  });

  // =========================================================================
  // Config-driven fixed bill overrides — non-GBP currency (MCE Advisory AED)
  // =========================================================================

  it('MCE Advisory surfaces after a single AED payment (declared fixed via config)', () => {
    // Only one historical payment — mirrors the user's real-world first-month
    // scenario. The FIXED_BILL_OVERRIDES entry is the frequency signal, so the
    // detector should not require additional history.
    const txns: RawTransaction[] = [
      makeTxn({
        date: '2026-04-01',
        description: 'DFT-DTB TT REF EPH MCE ADVISORY FZ LLC PMS INV 0673 DTD 270326',
        amount: -4200,
        account: 'emirates-islamic',
      }),
    ];
    const result = buildRecurringPipeline({
      scopedTransactions: txns,
      allTimeTransactions: txns,
      includeIncome: false,
    });
    const mce = result.monthlyExpenseRecurring.find(e => e.merchant === 'MCE Advisory');
    expect(mce).toBeDefined();
    expect(mce!.amount).toBe(882); // 4200 AED * 0.21
    expect(mce!.nativeAmount).toBe(4200);
    expect(mce!.nativeCurrency).toBe('AED');
  });

  it('MCE Advisory AED payments convert to GBP on `amount` and preserve native fields', () => {
    // Two payments over a 24-month covered window — would not normally pass the
    // monthly detector gate, but the obligations-registry `fixed-bill` entry
    // sets `declaredFrequency: 'monthly'` on the candidate and unlocks the
    // relaxed classification branch.
    const txns: RawTransaction[] = [
      makeTxn({
        date: '2026-02-27',
        description: 'DFT-DTB TT REF EPH MCE ADVISORY FZ LLC PMS INV 0672',
        amount: -4200,
        account: 'emirates-islamic',
      }),
      makeTxn({
        date: '2026-03-28',
        description: 'DFT-DTB TT REF EPH MCE ADVISORY FZ LLC PMS INV 0673',
        amount: -4200,
        account: 'emirates-islamic',
      }),
    ];
    const result = buildRecurringPipeline({
      scopedTransactions: txns,
      allTimeTransactions: txns,
      includeIncome: false,
    });
    const mce = result.monthlyExpenseRecurring.find(e => e.merchant === 'MCE Advisory');
    expect(mce).toBeDefined();
    // 4200 AED * 0.21 (AED/GBP) = 882 GBP
    expect(mce!.amount).toBe(882);
    expect(mce!.nativeAmount).toBe(4200);
    expect(mce!.nativeCurrency).toBe('AED');
    expect(mce!.sourceAccount).toBe('emirates-islamic');
  });

  it('EE override (no currency configured) keeps amount in GBP and omits native fields', () => {
    const amounts = [158.68, 122.19, 172.99, 105.97, 92.95, 105.95, 135.94, 85.95, 83.95, 88.95, 76.0, 118.68];
    const txns: RawTransaction[] = amounts.map((amt, i) => {
      const totalMonth = 2026 * 12 + 3 - i;
      const year = Math.floor(totalMonth / 12);
      const month = (totalMonth % 12) + 1;
      return makeTxn({
        date: `${year}-${String(month).padStart(2, '0')}-23`,
        description: 'EE LIMITED Q0447 DD',
        amount: -amt,
        account: 'barclays-current',
      });
    });
    const result = buildRecurringPipeline({
      scopedTransactions: txns,
      allTimeTransactions: txns,
      includeIncome: false,
    });
    const ee = result.monthlyExpenseRecurring.find(e => e.merchant === 'EE');
    expect(ee).toBeDefined();
    expect(ee!.amount).toBe(180);
    expect(ee!.nativeAmount).toBeUndefined();
    expect(ee!.nativeCurrency).toBeUndefined();
  });

  // =========================================================================
  // Declared-annual outgoings (insurance, etc.) — surface on Fixed Expenses
  // annual tab with GBP primary + native-currency brackets, regardless of
  // whether the user has any matching historical transactions yet.
  // =========================================================================

  it('annual-declared insurance with zero matching transactions surfaces on annualExpenseRecurring', () => {
    // No transactions at all — exercises the `synthesiseMissingOutgoingObligations`
    // pass. obligations.csv declares two Orient Insurance policies billed
    // annually against the emirates-islamic account.
    const result = buildRecurringPipeline({
      scopedTransactions: [],
      allTimeTransactions: [],
      includeIncome: false,
    });
    const orientRows = result.annualExpenseRecurring.filter(
      e => e.merchant === 'Professional Indemnity' || e.merchant === 'Public Liability',
    );
    expect(orientRows).toHaveLength(2);
    for (const row of orientRows) {
      expect(row.nativeCurrency).toBe('AED');
      expect(row.sourceAccount).toBe('emirates-islamic');
      expect(row.declaredObligationId).toMatch(/^manual-/);
      // GBP primary = native AED * exchange rate; verify both directions.
      expect(row.amount).toBeGreaterThan(0);
      expect(row.amount).not.toBe(row.nativeAmount);
    }
    const profIndemnity = orientRows.find(r => r.merchant === 'Professional Indemnity');
    expect(profIndemnity!.nativeAmount).toBe(25200);
    const publicLiability = orientRows.find(r => r.merchant === 'Public Liability');
    expect(publicLiability!.nativeAmount).toBe(3150);
  });

  it('annual-declared insurance with one matching transaction surfaces once, not duplicated', () => {
    // Single matching transaction → detector emits a row; synthesiser must
    // NOT emit a second. The dedup keys off `declaredObligationId`.
    const txns: RawTransaction[] = [
      makeTxn({
        date: '2026-03-27',
        description: 'DFT-DTB TT ORIENT INSURANCE PJSC INS PAYMENT FOR PROFESSIONAL',
        amount: -25200,
        account: 'emirates-islamic',
      }),
    ];
    const result = buildRecurringPipeline({
      scopedTransactions: txns,
      allTimeTransactions: txns,
      includeIncome: false,
    });
    const profIndemnity = result.annualExpenseRecurring.filter(
      e => e.declaredObligationId === 'manual-665c8ca2-3383-47a8-8889-122435f74b3a',
    );
    expect(profIndemnity).toHaveLength(1);
    expect(profIndemnity[0].nativeAmount).toBe(25200);
    expect(profIndemnity[0].nativeCurrency).toBe('AED');
    // Public liability still comes through synthesis (no txn yet).
    const publicLiability = result.annualExpenseRecurring.filter(
      e => e.declaredObligationId === 'manual-0a2cda18-eb22-4526-bcba-711e802ffb2b',
    );
    expect(publicLiability).toHaveLength(1);
  });

  it('tax-manual obligations never surface on Fixed Expenses', () => {
    // obligations.csv has a `tax-manual` self-assessment row; regardless of
    // frequency it must not leak into monthly/annual expense lists.
    const result = buildRecurringPipeline({
      scopedTransactions: [],
      allTimeTransactions: [],
      includeIncome: false,
    });
    const taxRows = [
      ...result.monthlyExpenseRecurring,
      ...result.annualExpenseRecurring,
    ].filter(e => e.merchant === 'Self Assessment Tax' || e.merchant === 'HMRC');
    expect(taxRows).toHaveLength(0);
  });

  it('non-Property expense amounts still stay separate (no regression)', () => {
    const txns: RawTransaction[] = [];
    for (let i = 0; i < 10; i++) {
      const m = 12 - i;
      const year = m > 0 ? 2025 : 2024;
      const month = ((m - 1 + 12) % 12) + 1;
      const date = `${year}-${String(month).padStart(2, '0')}-15`;
      txns.push(makeTxn({ date, description: 'APPLE.COM/BILL', amount: -2.99 }));
      txns.push(makeTxn({ date, description: 'APPLE.COM/BILL', amount: -16.99 }));
    }
    const result = buildRecurringPipeline({
      scopedTransactions: txns,
      allTimeTransactions: txns,
      includeIncome: false,
    });
    const appleAccumulators = [...result.expenseAccumulators.values()].filter(
      a => a.merchant === 'Apple',
    );
    expect(appleAccumulators).toHaveLength(2);
  });

  // =========================================================================
  // Declaration-first Fixed Expenses — regression tests for the architecture
  // replacing applyOutgoingObligationOverrides + synthesiseMissingOutgoingObligations.
  // =========================================================================

  it('declared outgoing obligations on other accounts do not leak into a scoped view', () => {
    // Orient Insurance is declared on emirates-islamic. A barclays-current
    // scoped view must not surface it — this was the cross-account bug.
    const result = buildRecurringPipeline({
      scopedTransactions: [],
      allTimeTransactions: [],
      includeIncome: false,
      accountScope: ['barclays-current'],
    });
    const orientRows = [
      ...result.monthlyExpenseRecurring,
      ...result.annualExpenseRecurring,
    ].filter(e => e.merchant === 'Professional Indemnity' || e.merchant === 'Public Liability');
    expect(orientRows).toHaveLength(0);
    // MCE Advisory is also on emirates-islamic — also filtered out.
    const mce = result.monthlyExpenseRecurring.find(e => e.merchant === 'MCE Advisory');
    expect(mce).toBeUndefined();
  });

  it('declared outgoing obligations appear exactly once, even when the detector would match', () => {
    // MCE Advisory has both a declared obligation (4200 AED monthly) and
    // two historical transactions. The declaration-first pass must own the
    // row; the detector must not emit a duplicate.
    const txns: RawTransaction[] = [
      makeTxn({
        date: '2026-02-27',
        description: 'DFT-DTB TT REF EPH MCE ADVISORY FZ LLC PMS INV 0672',
        amount: -4200,
        account: 'emirates-islamic',
      }),
      makeTxn({
        date: '2026-03-28',
        description: 'DFT-DTB TT REF EPH MCE ADVISORY FZ LLC PMS INV 0673',
        amount: -4200,
        account: 'emirates-islamic',
      }),
    ];
    const result = buildRecurringPipeline({
      scopedTransactions: txns,
      allTimeTransactions: txns,
      includeIncome: false,
    });
    const mceRows = result.monthlyExpenseRecurring.filter(e => e.merchant === 'MCE Advisory');
    expect(mceRows).toHaveLength(1);
    expect(mceRows[0].declaredObligationId).toBe('seed-mce-advisory-emirates-islamic');
  });

  it('director salary is emitted once per payroll obligation, not duplicated at seed amount', () => {
    // Regression test: the old synthesiser emitted a second payroll row
    // whenever the detector-produced row's merchant label did not collide
    // with the obligation id. Under declaration-first there is a single
    // source (the registry) so exactly one row appears per obligation.
    const txns: RawTransaction[] = [];
    for (let i = 0; i < 6; i++) {
      const d = new Date(2026, 2 - i, 15);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      txns.push(makeTxn({
        date: `${y}-${m}-15`,
        description: 'STO SALARY DAVID MORRISON',
        amount: -758,
        type: 'transfer',
        account: 'barclays-current',
      }));
    }
    const result = buildRecurringPipeline({
      scopedTransactions: txns,
      allTimeTransactions: txns,
      includeIncome: false,
      accountScope: ['barclays-current'],
    });
    const davidPayroll = result.monthlyExpenseRecurring.filter(
      e => e.merchant === 'Director salary — David',
    );
    expect(davidPayroll).toHaveLength(1);
    expect(davidPayroll[0].declaredObligationId).toBe('seed-payroll-david');
    expect(davidPayroll[0].amount).toBe(758);
  });

  it('amount-aware matching routes two same-merchant same-account obligations to the right one', () => {
    // Two Orient Insurance policies on emirates-islamic, 25,200 AED and
    // 3,150 AED. Each transaction must match its own obligation by amount.
    const txns: RawTransaction[] = [
      makeTxn({
        date: '2026-03-27',
        description: 'DFT-DTB TT ORIENT INSURANCE PJSC INS PAYMENT FOR PROFESSIONAL',
        amount: -25200,
        account: 'emirates-islamic',
      }),
      makeTxn({
        date: '2026-03-27',
        description: 'DFT-DTB TT ORIENT INSURANCE PJSC INS PAYMENT FOR PUBLIC LIABILITY',
        amount: -3150,
        account: 'emirates-islamic',
      }),
    ];
    const result = buildRecurringPipeline({
      scopedTransactions: txns,
      allTimeTransactions: txns,
      includeIncome: false,
    });
    const profIndemnity = result.annualExpenseRecurring.find(
      e => e.declaredObligationId === 'manual-665c8ca2-3383-47a8-8889-122435f74b3a',
    );
    expect(profIndemnity).toBeDefined();
    expect(profIndemnity!.nativeAmount).toBe(25200);
    const publicLiability = result.annualExpenseRecurring.find(
      e => e.declaredObligationId === 'manual-0a2cda18-eb22-4526-bcba-711e802ffb2b',
    );
    expect(publicLiability).toBeDefined();
    expect(publicLiability!.nativeAmount).toBe(3150);
  });

  it('undeclared recurring merchants still flow through the detector', () => {
    // Scottish Power is not a declared obligation — the detector must
    // still surface it on Fixed Expenses based on transaction evidence.
    // Use current-relative dates so the detector's 2-month staleness gate
    // doesn't filter them out.
    const txns: RawTransaction[] = [];
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 15);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      txns.push(makeTxn({
        date: `${y}-${m}-15`,
        description: 'SCOTTISH POWER',
        amount: -85,
      }));
    }
    const result = buildRecurringPipeline({
      scopedTransactions: txns,
      allTimeTransactions: txns,
      includeIncome: false,
    });
    const scottishPower = result.monthlyExpenseRecurring.find(
      e => e.merchant === 'Scottish Power',
    );
    expect(scottishPower).toBeDefined();
    expect(scottishPower!.declaredObligationId).toBeUndefined();
  });

  it('declared outgoing row is enriched from an accumulator when transactions exist', () => {
    // When a matching accumulator exists, the declared row picks up the
    // observed billing day + category rather than the synthesised defaults.
    const txns: RawTransaction[] = [
      makeTxn({
        date: '2026-02-27',
        description: 'DFT-DTB TT REF EPH MCE ADVISORY FZ LLC',
        amount: -4200,
        account: 'emirates-islamic',
      }),
      makeTxn({
        date: '2026-03-27',
        description: 'DFT-DTB TT REF EPH MCE ADVISORY FZ LLC',
        amount: -4200,
        account: 'emirates-islamic',
      }),
    ];
    const result = buildRecurringPipeline({
      scopedTransactions: txns,
      allTimeTransactions: txns,
      includeIncome: false,
    });
    const mce = result.monthlyExpenseRecurring.find(e => e.merchant === 'MCE Advisory');
    expect(mce).toBeDefined();
    expect(mce!.monthsActive).toBeGreaterThan(0);
    expect(mce!.billingDayOfMonth).toBe(27);
    expect(mce!.category).toBe('Business');
  });
});
