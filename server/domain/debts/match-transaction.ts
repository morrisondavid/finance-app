/**
 * Pure debt ↔ transaction matching — mirrors {@link buildDebtMatchClause}
 * semantics in debts.ts so budget nudges and SQL summaries stay aligned.
 */

import type { DebtKind } from '../../db/debts-csv.js';
import { descriptionMatchesMerchant } from '../../db/repositories/obligation-state-matcher.js';
import { classifyTransactionSide } from '../../utils/recurring-pipeline.js';
import { round2 } from '../../utils/math.js';

/** Shape required for transaction ↔ debt matching (CSV row or DB entity). */
export interface DebtMatchable {
  id: string;
  name: string;
  archived: boolean;
  merchantPattern: string;
  sourceAccounts: readonly string[];
  matchAmounts: readonly number[];
  matchTolerancePct: number;
  kind: DebtKind;
}

export interface DebtMatchTransaction {
  readonly description: string;
  readonly account: string;
  readonly amount: number;
  readonly type: string;
}

function amountMatchesDebt(absAmount: number, debt: DebtMatchable): boolean {
  if (debt.matchAmounts.length === 0) return true;
  const rounded = round2(absAmount);
  if (debt.matchTolerancePct === 0) {
    return debt.matchAmounts.some(a => round2(a) === rounded);
  }
  const tol = debt.matchTolerancePct;
  return debt.matchAmounts.some(a => {
    const min = round2(a * (1 - tol));
    const max = round2(a * (1 + tol));
    return rounded >= min && rounded <= max;
  });
}

export function transactionMatchesDebt(
  txn: DebtMatchTransaction,
  debt: DebtMatchable,
): boolean {
  if (debt.archived) return false;
  if (classifyTransactionSide(txn) !== 'expense') return false;
  if (!debt.sourceAccounts.some(account => account === txn.account)) {
    return false;
  }
  if (!descriptionMatchesMerchant(txn.description, debt.merchantPattern)) {
    return false;
  }
  return amountMatchesDebt(Math.abs(txn.amount), debt);
}

export function transactionMatchesAnyActiveDebt(
  txn: DebtMatchTransaction,
  debts: readonly DebtMatchable[],
): boolean {
  for (const debt of debts) {
    if (transactionMatchesDebt(txn, debt)) return true;
  }
  return false;
}

/**
 * First debt whose {@link matchAmounts} exactly matches this expense transaction.
 * When several debts match (same creditor pattern, different amounts), prefer the
 * one whose `matchAmounts[0]` is closest to the observed payment.
 */
export function findMatchingDebt(
  txn: DebtMatchTransaction,
  debts: readonly DebtMatchable[],
): DebtMatchable | null {
  const matches: DebtMatchable[] = [];
  for (const debt of debts) {
    if (transactionMatchesDebt(txn, debt)) {
      matches.push(debt);
    }
  }
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];

  const absAmount = Math.abs(txn.amount);
  let best = matches[0];
  let bestDiff = Math.abs(absAmount - best.matchAmounts[0]);
  for (let i = 1; i < matches.length; i++) {
    const candidate = matches[i];
    const diff = Math.abs(absAmount - candidate.matchAmounts[0]);
    if (diff < bestDiff) {
      best = candidate;
      bestDiff = diff;
    }
  }
  return best;
}
