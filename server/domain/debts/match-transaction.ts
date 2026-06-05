/**
 * Pure debt ↔ transaction matching — mirrors {@link buildDebtMatchClause}
 * semantics in debts.ts so budget nudges and SQL summaries stay aligned.
 */

import type { Debt } from '../../db/repositories/debts.js';
import { descriptionMatchesMerchant } from '../../db/repositories/obligation-state-matcher.js';
import { classifyTransactionSide } from '../../utils/recurring-pipeline.js';
import { round2 } from '../../utils/math.js';

export interface DebtMatchTransaction {
  readonly description: string;
  readonly account: string;
  readonly amount: number;
  readonly type: string;
}

function amountMatchesDebt(absAmount: number, debt: Debt): boolean {
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
  debt: Debt,
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
  debts: readonly Debt[],
): boolean {
  for (const debt of debts) {
    if (transactionMatchesDebt(txn, debt)) return true;
  }
  return false;
}
