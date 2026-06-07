/**
 * Derive obligation paid_* fields from a linked bank transaction.
 *
 * Single source of truth for manual Mark Paid (via hash), auto-matchers,
 * and HMRC seeders — keeps `paid_amount` / `paid_date` / `paid_from_account`
 * aligned with the ledger row they reference.
 */

import { getDb } from '../../db/connection.js';
import type { ExpenseTransactionMatch } from '../../db/repositories/transaction-queries.js';
import { round2 } from '../../utils/math.js';

export interface ObligationPaidFields {
  paidAmount: number;
  paidDate: string;
  paidFromAccount: string;
}

export interface ObligationPaidLink extends ObligationPaidFields {
  paidFromTxHash: string;
}

export class UnknownTransactionError extends Error {
  constructor(readonly hash: string) {
    super(`Unknown transaction hash: ${hash}`);
    this.name = 'UnknownTransactionError';
  }
}

export function resolvePaidFieldsFromTxHash(hash: string): ObligationPaidFields | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT date, amount, account FROM transactions WHERE hash = ?
  `).get(hash) as { date: string; amount: number; account: string } | undefined;
  if (row === undefined) return null;
  return {
    paidAmount: round2(Math.abs(row.amount)),
    paidDate: row.date,
    paidFromAccount: row.account,
  };
}

export function paidFieldsFromTransactionMatch(match: ExpenseTransactionMatch): ObligationPaidLink {
  return {
    paidAmount: round2(Math.abs(match.amount)),
    paidDate: match.date,
    paidFromAccount: match.account,
    paidFromTxHash: match.hash,
  };
}
