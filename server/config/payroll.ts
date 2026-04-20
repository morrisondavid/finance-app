/**
 * Director / payroll debits classifier.
 *
 * Thin adapter over the declared-commitments registry — the actual payroll
 * rows live in `commitments/seed.csv` as `category: payroll` commitments.
 * This module keeps the category-resolution API stable for the many call
 * sites that classify transactions as Payroll vs Dividends vs Business.
 */

import type { CategoryName } from '../utils/merchant-registry.js';
import { categorizeTransaction } from '../utils/categorizer.js';
import { normalizeMerchant } from '../utils/merchant-normalizer.js';
import { getDeclaredCommitmentRegistry } from '../domain/commitments/registry.js';
import {
  matchPayrollCommitment,
  type Payroll,
} from '../domain/commitments/lookups.js';

export type PayrollEntry = Payroll;

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
  return matchPayrollCommitment(getDeclaredCommitmentRegistry(), merchant, account, absAmount);
}

function isOutgoingExpense(type: string, amount: number): boolean {
  if (type === 'expense') return true;
  if (type === 'transfer' && amount < 0) return true;
  return false;
}

export interface ResolvePayrollCategoryResult {
  category: CategoryName;
  payrollHit: PayrollEntry | null;
}

/**
 * Registry can label salary-like text as Payroll before payee-specific rules
 * run. Only commitments-registry `payroll` matches (amount within tolerance)
 * stay Payroll; other registry Payroll rows become Dividends (if DIVIDEND in
 * description) or Business (director drawings / non-matching amounts — not
 * Transfers, which are omitted from expense buckets).
 */
export function resolveExpenseCategoryWithPayroll(
  description: string,
  merchant: string,
  account: string,
  absAmount: number,
  registryCategory: CategoryName,
): ResolvePayrollCategoryResult {
  const payrollHit = matchPayrollEntry(merchant, account, absAmount, description);
  if (payrollHit !== null) {
    return { category: 'Payroll', payrollHit };
  }
  if (registryCategory === 'Payroll') {
    if (/\bDIVIDEND\b/i.test(description)) {
      return { category: 'Dividends', payrollHit: null };
    }
    return { category: 'Business', payrollHit: null };
  }
  return { category: registryCategory, payrollHit: null };
}

/** Category for API / charts: Payroll when a commitment matches an outgoing transfer/expense, else registry. */
export function transactionCategoryWithPayroll(
  description: string,
  amount: number,
  account: string,
  type: 'income' | 'expense' | 'transfer',
): CategoryName {
  const base = categorizeTransaction(description);
  if (!isOutgoingExpense(type, amount)) return base;
  const merchant = normalizeMerchant(description);
  const { category } = resolveExpenseCategoryWithPayroll(
    description,
    merchant,
    account,
    Math.abs(amount),
    base,
  );
  return category;
}
