/**
 * Typed lookup helpers over the declared-commitment registry. Keeps the
 * pipeline adapters thin: a caller asks "is there a fixed-bill declared for
 * this (merchant, account)?" and gets the narrowed category variant (or
 * null), without having to juggle the discriminated-union at the call site.
 */

import type {
  DeclaredCommitment,
  DeclaredOutgoing,
  DeclaredIncoming,
} from '../../../shared/api-contracts.js';
import type { DeclaredCommitmentRegistry } from './registry.js';

type FixedBill = Extract<DeclaredOutgoing, { category: 'fixed-bill' }>;
type RentalIncome = Extract<DeclaredIncoming, { category: 'rental-income' }>;
type Payroll = Extract<DeclaredOutgoing, { category: 'payroll' }>;

export function matchFixedBillCommitment(
  registry: DeclaredCommitmentRegistry,
  merchant: string,
  account: string,
): FixedBill | null {
  const hit = registry.matchByMerchantAccount(merchant, account);
  return hit !== null && hit.category === 'fixed-bill' ? hit : null;
}

export function matchRentalCommitment(
  registry: DeclaredCommitmentRegistry,
  merchant: string,
  account: string,
): RentalIncome | null {
  const hit = registry.matchByMerchantAccount(merchant, account);
  return hit !== null && hit.category === 'rental-income' ? hit : null;
}

/**
 * Amount-aware rental match, used by the recurring pipeline when multiple
 * rental properties share the same payee+account (unusual but supported).
 * Returns the rental row whose `amount` is closest to the transaction.
 */
export function matchRentalCommitmentByAmount(
  registry: DeclaredCommitmentRegistry,
  merchant: string,
  account: string,
  amount: number,
): RentalIncome | null {
  const candidates = registry
    .listByCategory('rental-income')
    .filter(c => c.merchant === merchant && c.account !== undefined && c.account === account);
  if (candidates.length === 0) return null;
  let best = candidates[0];
  let bestDiff = Math.abs(amount - best.amount);
  for (let i = 1; i < candidates.length; i++) {
    const diff = Math.abs(amount - candidates[i].amount);
    if (diff < bestDiff) {
      best = candidates[i];
      bestDiff = diff;
    }
  }
  return best;
}

export function matchPayrollCommitment(
  registry: DeclaredCommitmentRegistry,
  merchant: string,
  account: string,
  absAmount: number,
): Payroll | null {
  const candidates = registry
    .listByCategory('payroll')
    .filter(c => c.merchant === merchant && c.account !== undefined && c.account === account);
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

export type { FixedBill, RentalIncome, Payroll, DeclaredCommitment };
