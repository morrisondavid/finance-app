/**
 * Director / payroll debits classifier.
 *
 * Thin adapter over the obligations registry — the actual payroll rows live
 * in `obligations/obligations-seed.csv` with `category: payroll`. Matching is
 * person-driven: the raw description is tested against
 * `PEOPLE[personId].matchAliases`, not against the `merchant` field. This
 * lets "STO SALARY DAVID MORRISON", "D MORRISON", and "MORRISON DD" all
 * resolve to the same person even though they normalise to different
 * merchant strings.
 */

import type { CategoryName } from '../utils/merchant-registry.js';
import { categorizeTransaction } from '../utils/categorizer.js';
import { matchPersonInDescription } from './people.js';
import { getObligationRegistry } from '../domain/obligations/registry.js';
import { getOverrideRegistry } from '../domain/transaction-overrides/registry.js';
import type { OutgoingObligation } from '../../shared/api-contracts.js';

export type PayrollEntry = Extract<OutgoingObligation, { category: 'payroll' }>;

/**
 * Match a configured payroll debit. Returns null for dividends, for rows
 * that don't reference a known person, and for amounts outside the
 * obligation's declared tolerance. When multiple payroll obligations
 * exist for the same (person, account), the closest absolute amount wins —
 * enabling a single account to host several scheduled payroll runs.
 */
export function matchPayrollEntry(
  account: string,
  absAmount: number,
  description: string,
): PayrollEntry | null {
  if (/\bDIVIDEND\b/i.test(description)) return null;
  const person = matchPersonInDescription(description);
  if (person === null) return null;
  const candidates = getObligationRegistry()
    .listByCategory('payroll')
    .filter(c => c.personId === person.id && c.account === account);
  if (candidates.length === 0) return null;
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
): ResolvePayrollCategoryResult {
  const payrollHit = matchPayrollEntry(account, absAmount, description);
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
): CategoryName {
  const base = categorizeTransaction(description, hash ? { hash } : undefined);
  if (hash !== undefined) {
    // The override registry returns a non-null category here iff
    // the hash is pinned. Re-query so we can skip payroll fallback
    // when pinned — `base` alone can't distinguish pattern-match
    // "Transfers" from a pinned "Transfers" override.
    const override = getOverrideRegistry().get(hash);
    if (override !== null) return override;
  }
  if (!isOutgoingExpense(type, amount)) return base;
  const { category } = resolveExpenseCategoryWithPayroll(
    description,
    account,
    Math.abs(amount),
    base,
  );
  return category;
}
