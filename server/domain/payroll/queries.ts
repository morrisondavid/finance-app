/**
 * Payroll domain — public query surface.
 *
 * Every function answers one named question by reading a
 * precomputed index (or delegating to the categoriser / override
 * registry). No function in this file contains a `.filter(...)`
 * over raw obligation rows — if you find yourself writing one, the
 * answer belongs as a new index in `registry.ts`.
 */

import type { CategoryName } from '../merchants/index.js';
import { categorizeTransaction } from '../../utils/categorizer.js';
import {
  matchPersonInDescription,
  type PersonId,
} from '../people/index.js';
import { lookupOverride } from '../transaction-overrides/index.js';
import {
  getPayrollRegistry,
  personAccountKey,
  type PayrollEntry,
  type PayrollRegistry,
} from './registry.js';
import type { DirectorPayroll } from './schema.js';

/**
 * Resolve the hydrated payroll record for a director. Returns
 * `undefined` when no payroll obligation is on file for
 * `personId` — the caller is expected to treat that as "no salary
 * payments to attribute" rather than an error.
 */
export function getDirectorPayroll(
  personId: PersonId,
  reg: PayrollRegistry = getPayrollRegistry(),
): DirectorPayroll | undefined {
  return reg.indexes.directorsById.get(personId);
}

/** Every payroll obligation in declaration order. */
export function allPayrollEntries(
  reg: PayrollRegistry = getPayrollRegistry(),
): readonly PayrollEntry[] {
  return reg.indexes.entries;
}

/**
 * Match a configured payroll debit. Returns null for dividends, for
 * rows that don't reference a known person, and for amounts outside
 * the obligation's declared tolerance. When multiple payroll
 * obligations exist for the same (person, account) the closest
 * absolute amount wins — enabling a single account to host several
 * scheduled payroll runs.
 */
export function matchPayrollEntry(
  account: string,
  absAmount: number,
  description: string,
  reg: PayrollRegistry = getPayrollRegistry(),
): PayrollEntry | null {
  if (/\bDIVIDEND\b/i.test(description)) return null;
  const person = matchPersonInDescription(description);
  if (person === null) return null;
  const candidates = reg.indexes.byPersonAccount.get(
    personAccountKey(person.id, account),
  );
  if (candidates === undefined || candidates.length === 0) return null;
  let best = candidates[0];
  let bestDiff = Math.abs(absAmount - best.amount);
  for (let i = 1; i < candidates.length; i++) {
    const diff = Math.abs(absAmount - candidates[i].amount);
    if (diff < bestDiff) {
      best = candidates[i];
      bestDiff = diff;
    }
  }
  const tolerance = best.amountTolerance ?? Infinity;
  return bestDiff > tolerance ? null : best;
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
 * Resolve the final expense category when payroll obligations are in play:
 *
 *   - Matching payroll obligation → Payroll.
 *   - Registry said "Payroll" but no obligation matches:
 *       - description contains DIVIDEND → Dividends.
 *       - else → Transfers (salary-worded debit on an account that has no
 *         declared payroll obligation for this person, or whose amount
 *         falls outside the declared tolerance). These are treated as
 *         internal movements and excluded from Fixed Expenses / expense
 *         totals; declaring the missing obligation is how the user
 *         promotes them back to Payroll.
 *   - Otherwise → the registry category unchanged.
 */
export function resolveExpenseCategoryWithPayroll(
  description: string,
  account: string,
  absAmount: number,
  registryCategory: CategoryName,
  reg: PayrollRegistry = getPayrollRegistry(),
): ResolvePayrollCategoryResult {
  const payrollHit = matchPayrollEntry(account, absAmount, description, reg);
  if (payrollHit !== null) {
    return { category: 'Payroll', payrollHit };
  }
  if (registryCategory === 'Payroll') {
    if (/\bDIVIDEND\b/i.test(description)) {
      return { category: 'Dividends', payrollHit: null };
    }
    return { category: 'Transfers', payrollHit: null };
  }
  return { category: registryCategory, payrollHit: null };
}

/**
 * Category for API / charts: Payroll when an obligation matches an
 * outgoing transfer/expense, else the registry category.
 *
 * Accepts an optional `hash` so per-transaction category overrides
 * (Phase 8 inter-company classification) take precedence over the
 * pattern lookup. When an override is present we skip the
 * payroll-resolution branch entirely — a hash-level override is a
 * stronger human signal than a payroll-obligation amount match.
 */
export function transactionCategoryWithPayroll(
  description: string,
  amount: number,
  account: string,
  type: 'income' | 'expense' | 'transfer',
  hash?: string,
  reg: PayrollRegistry = getPayrollRegistry(),
): CategoryName {
  const base = categorizeTransaction(description, hash ? { hash } : undefined);
  if (hash !== undefined) {
    const override = lookupOverride(hash);
    if (override !== null) return override;
  }
  if (!isOutgoingExpense(type, amount)) return base;
  const { category } = resolveExpenseCategoryWithPayroll(
    description,
    account,
    Math.abs(amount),
    base,
    reg,
  );
  return category;
}
