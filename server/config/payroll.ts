/**
 * Director / payroll debits from the business current account (same idea as RENTAL_PROPERTIES).
 * Update `expectedAmount` when salaries change. Matching uses closest amount among same payee+account.
 */

import type { AccountName } from '../types.js';
import type { CategoryName } from '../utils/merchant-registry.js';
import { categorizeTransaction } from '../utils/categorizer.js';
import { normalizeMerchant } from '../utils/merchant-normalizer.js';
import { classifyTransactionSide } from '../utils/recurring-pipeline.js';

export interface PayrollEntry {
  sourceAccount: AccountName;
  /** Value from `normalizeMerchant(description)` for that payee */
  merchant: string;
  expectedAmount: number;
  displayName: string;
}

/** Reject config match when actual debit is this far from `expectedAmount` (update config after a pay rise). */
const MAX_AMOUNT_DEVIATION = 50;

export const PAYROLL_ENTRIES: PayrollEntry[] = [
  {
    sourceAccount: 'barclays-current',
    merchant: 'David Morrison',
    expectedAmount: 765,
    displayName: 'Director salary — David',
  },
  {
    sourceAccount: 'barclays-current',
    merchant: 'Heena Tailor',
    expectedAmount: 765,
    displayName: 'Director salary — Heena',
  },
];

/**
 * Match a configured payroll debit. Returns null for dividends or non-matching rows.
 */
export function matchPayrollEntry(
  merchant: string,
  account: string,
  absAmount: number,
  description: string,
): PayrollEntry | null {
  if (/\bDIVIDEND\b/i.test(description)) return null;
  const candidates = PAYROLL_ENTRIES.filter(
    p => p.sourceAccount === account && p.merchant === merchant,
  );
  if (candidates.length === 0) return null;
  let best = candidates[0]!;
  let bestDiff = Math.abs(absAmount - best.expectedAmount);
  for (let i = 1; i < candidates.length; i++) {
    const c = candidates[i]!;
    const diff = Math.abs(absAmount - c.expectedAmount);
    if (diff < bestDiff) {
      best = c;
      bestDiff = diff;
    }
  }
  if (bestDiff > MAX_AMOUNT_DEVIATION) return null;
  return best;
}

/** Category for API / charts: Payroll when config matches an outgoing transfer/expense, else registry. */
export function transactionCategoryWithPayroll(
  description: string,
  amount: number,
  account: string,
  type: 'income' | 'expense' | 'transfer',
): CategoryName {
  const base = categorizeTransaction(description);
  if (classifyTransactionSide({ type, amount }) !== 'expense') return base;
  const merchant = normalizeMerchant(description);
  const payroll = matchPayrollEntry(merchant, account, Math.abs(amount), description);
  if (payroll) return 'Payroll';
  return base;
}
