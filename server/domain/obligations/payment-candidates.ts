/**
 * Candidate bank transactions for linking when marking an obligation paid.
 *
 * Shared by GET /api/obligations/:id/payment-candidates and the MCP read
 * tool. Uses the same account + calendar-month filters as the dashboard
 * transaction drill-down (all non-transfer rows for the month), narrowed
 * to transactions whose amount covers the obligation expected amount.
 */

import { OBLIGATIONS_DIR } from '../../db/connection.js';
import { getObligationById } from '../../db/repositories/obligations.js';
import { getTransactions } from '../../db/repositories/transactions.js';
import { paymentCoversObligation } from './amount-tolerance.js';
import { buildObligationRegistry } from './registry.js';
import { obligationProjectsToRow, projectObligationToRow } from './obligation-projection.js';

export interface ObligationPaymentCandidate {
  hash: string;
  date: string;
  amount: number;
  account: string;
  description: string;
}

export interface ObligationPaymentCandidateFilters {
  account: string;
  year: number;
  month: number;
}

export interface ObligationPaymentExpectation {
  expectedAmount: number | null;
}

export function obligationPaymentExpectation(
  obligationId: string,
): ObligationPaymentExpectation | null {
  const registry = buildObligationRegistry(OBLIGATIONS_DIR);
  const declared = registry.all.find(c => c.id === obligationId);
  if (declared !== undefined && obligationProjectsToRow(declared)) {
    const projected = projectObligationToRow(declared, undefined);
    return { expectedAmount: projected.expectedAmount };
  }
  const row = getObligationById(obligationId);
  if (row === undefined) return null;
  return { expectedAmount: row.expected_amount };
}

/**
 * Return ledger rows for linking when marking an obligation paid.
 * Returns `null` when the obligation id is unknown.
 */
export function findObligationPaymentCandidates(
  obligationId: string,
  filters: ObligationPaymentCandidateFilters,
): ObligationPaymentCandidate[] | null {
  const expectation = obligationPaymentExpectation(obligationId);
  if (expectation === null) return null;

  const rows = getTransactions({
    account: filters.account,
    year: String(filters.year),
    month: String(filters.month).padStart(2, '0'),
  });

  return rows
    .filter(row => {
      if (expectation.expectedAmount === null || expectation.expectedAmount <= 0) {
        return true;
      }
      return paymentCoversObligation(Math.abs(row.amount), expectation.expectedAmount);
    })
    .map(row => ({
      hash: row.hash,
      date: row.date,
      amount: row.amount,
      account: row.account,
      description: row.description,
    }));
}
