import { describe, it, expect } from 'vitest';
import {
  AD_HOC_MERGED_BUCKET_TAG,
  computeAdHocMerchantSeries,
  parseAdHocBucketKey,
} from './ad-hoc-merchant-series.js';
import { accumulationFromTxn, type PipelineResult, type RawTransaction } from './recurring-pipeline.js';
import type { AccountName } from '../types.js';

function emptyPipeline(): PipelineResult {
  return {
    expenseCandidates: [],
    incomeCandidates: [],
    expenseAccumulators: new Map(),
    incomeAccumulators: new Map(),
    monthlyExpenseRecurring: [],
    annualExpenseRecurring: [],
    monthlyIncomeRecurring: [],
    annualIncomeRecurring: [],
    monthsCovered: 24,
  };
}

describe('parseAdHocBucketKey', () => {
  const account: AccountName = 'natwest';

  it('accepts four-part strict key when embedded account matches', () => {
    const key = `Eating Out|Tesco|${account}|12`;
    expect(parseAdHocBucketKey(key, account)).toEqual({
      category: 'Eating Out',
      merchant: 'Tesco',
      account,
      mode: 'strict',
      amountBucket: 12,
    });
  });

  it('accepts merged bucket key fourth segment', () => {
    const key = `Eating Out|Tesco|${account}|${AD_HOC_MERGED_BUCKET_TAG}`;
    expect(parseAdHocBucketKey(key, account)).toEqual({
      category: 'Eating Out',
      merchant: 'Tesco',
      account,
      mode: 'merged',
    });
  });

  it('rejects when embedded account does not match request', () => {
    const key = 'Eating Out|Tesco|barclays-current|12';
    expect(parseAdHocBucketKey(key, account)).toBeNull();
  });

  it('rejects wrong segment count', () => {
    expect(parseAdHocBucketKey('a|b|c', account)).toBeNull();
  });

  it('rejects non-numeric amount bucket', () => {
    expect(parseAdHocBucketKey(`Eating Out|Tesco|${account}|x`, account)).toBeNull();
  });
});

describe('computeAdHocMerchantSeries', () => {
  const account: AccountName = 'natwest';

  it('aggregates by calendar month for matching bucket', () => {
    const t1: RawTransaction = {
      id: 1,
      date: '2024-01-05',
      description: '14APR A/C',
      amount: -100,
      account,
      type: 'expense',
    };
    const t2: RawTransaction = {
      id: 2,
      date: '2024-01-20',
      description: '14APR A/C',
      amount: -100,
      account,
      type: 'expense',
    };
    const t3: RawTransaction = {
      id: 3,
      date: '2024-02-01',
      description: '14APR A/C',
      amount: -100,
      account,
      type: 'expense',
    };
    const bucket = accumulationFromTxn(t1, 'expense');
    if (bucket === null) throw new Error('expected bucket');

    const points = computeAdHocMerchantSeries({
      pipeline: emptyPipeline(),
      account,
      expenseTransactions: [t1, t2, t3],
      bucketKey: bucket.key,
    });
    expect(points).not.toBeNull();
    expect(points).toEqual([
      { month: '2024-01', total: 200, count: 2 },
      { month: '2024-02', total: 100, count: 1 },
    ]);
  });

  it('returns null for invalid bucketKey', () => {
    expect(
      computeAdHocMerchantSeries({
        pipeline: emptyPipeline(),
        account,
        expenseTransactions: [],
        bucketKey: 'nope',
      }),
    ).toBeNull();
  });

  it('merged bucketKey aggregates txns across amount bins for the same merchant', () => {
    const t1: RawTransaction = {
      id: 1,
      date: '2024-01-05',
      description: 'TESCO STORES 1111',
      amount: -2.99,
      account,
      type: 'expense',
    };
    const t2: RawTransaction = {
      id: 2,
      date: '2024-01-10',
      description: 'TESCO STORES 2222',
      amount: -45.0,
      account,
      type: 'expense',
    };
    const b1 = accumulationFromTxn(t1, 'expense');
    const b2 = accumulationFromTxn(t2, 'expense');
    if (b1 === null || b2 === null) throw new Error('expected buckets');
    expect(b1.displayMerchant).toBe(b2.displayMerchant);
    expect(b1.key).not.toBe(b2.key);

    const mergedKey = `${b1.category}|${b1.displayMerchant}|${account}|${AD_HOC_MERGED_BUCKET_TAG}`;
    const points = computeAdHocMerchantSeries({
      pipeline: emptyPipeline(),
      account,
      expenseTransactions: [t1, t2],
      bucketKey: mergedKey,
    });
    expect(points).toEqual([{ month: '2024-01', total: 47.99, count: 2 }]);
  });
});
