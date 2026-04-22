/**
 * Monthly spend series for one ad-hoc accumulator bucket (same rules as computeAdHocExpenseGroups).
 */

import type { AccountName } from '../types.js';
import { isValidAccountName } from '../domain/accounts/index.js';
import { SPECIAL_CATEGORY } from './category-constants.js';
import {
  accumulationFromTxn,
  recurringKey,
  type PipelineResult,
  type RawTransaction,
} from './recurring-pipeline.js';
import { round2 } from './math.js';

/** Fourth segment of ad-hoc `bucketKey` when grouping all amount bins for one merchant row. */
export const AD_HOC_MERGED_BUCKET_TAG = 'all' as const;

export type ParsedAdHocBucketKey =
  | { category: string; merchant: string; account: AccountName; mode: 'merged' }
  | { category: string; merchant: string; account: AccountName; mode: 'strict'; amountBucket: number };

export interface AdHocMerchantSeriesPoint {
  month: string;
  total: number;
  count: number;
}

export interface ComputeAdHocMerchantSeriesInput {
  pipeline: PipelineResult;
  account: AccountName;
  expenseTransactions: RawTransaction[];
  bucketKey: string;
}

function surfacedRecurringKeys(pipeline: PipelineResult, account: AccountName): Set<string> {
  const surfaced = new Set<string>();
  for (const e of pipeline.monthlyExpenseRecurring) {
    if (e.sourceAccount === account) surfaced.add(recurringKey(e));
  }
  for (const e of pipeline.annualExpenseRecurring) {
    if (e.sourceAccount === account) surfaced.add(recurringKey(e));
  }
  return surfaced;
}

/**
 * Validates `bucketKey` shape `category|merchant|account|amountBucket` or
 * `category|merchant|account|{@link AD_HOC_MERGED_BUCKET_TAG}` (all amount bins for ad-hoc table rows).
 */
export function parseAdHocBucketKey(bucketKey: string, requestAccount: AccountName): ParsedAdHocBucketKey | null {
  const trimmed = bucketKey.trim();
  const parts = trimmed.split('|');
  if (parts.length !== 4) return null;
  const [category, merchant, accountStr, bucketStr] = parts;
  if (!category || !merchant || !accountStr || bucketStr === undefined) return null;
  if (!isValidAccountName(accountStr) || accountStr !== requestAccount) return null;
  if (bucketStr === AD_HOC_MERGED_BUCKET_TAG) {
    return { category, merchant, account: accountStr as AccountName, mode: 'merged' };
  }
  const amountBucket = Number.parseInt(bucketStr, 10);
  if (!Number.isFinite(amountBucket)) return null;
  return {
    category,
    merchant,
    account: accountStr as AccountName,
    mode: 'strict',
    amountBucket,
  };
}

/**
 * Returns monthly points sorted by `month`, or `null` if `bucketKey` is invalid for `requestAccount`.
 */
export function computeAdHocMerchantSeries(
  input: ComputeAdHocMerchantSeriesInput,
): AdHocMerchantSeriesPoint[] | null {
  const parsed = parseAdHocBucketKey(input.bucketKey, input.account);
  if (parsed === null) return null;

  const surfaced = surfacedRecurringKeys(input.pipeline, input.account);
  const byMonth = new Map<string, { total: number; count: number }>();

  for (const txn of input.expenseTransactions) {
    const bucket = accumulationFromTxn(txn, 'expense');
    if (!bucket) continue;
    if (bucket.category === SPECIAL_CATEGORY.tax) continue;
    if (surfaced.has(bucket.key)) continue;
    if (parsed.mode === 'strict') {
      if (bucket.key !== input.bucketKey) continue;
    } else {
      if (
        bucket.category !== parsed.category ||
        bucket.displayMerchant !== parsed.merchant ||
        txn.account !== parsed.account
      ) {
        continue;
      }
    }

    const month = txn.date.slice(0, 7);
    const abs = Math.abs(txn.amount);
    const prev = byMonth.get(month);
    if (prev) {
      prev.total += abs;
      prev.count += 1;
    } else {
      byMonth.set(month, { total: abs, count: 1 });
    }
  }

  return Array.from(byMonth.entries())
    .map(([month, v]) => ({
      month,
      total: round2(v.total),
      count: v.count,
    }))
    .sort((a, b) => a.month.localeCompare(b.month));
}
