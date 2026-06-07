/**
 * Candidate bank transactions for linking when marking an obligation paid.
 *
 * Shared by GET /api/obligations/:id/payment-candidates and the MCP read
 * tool. Uses the same account + calendar-month filters as the dashboard
 * transaction drill-down (all non-transfer rows for the month), narrowed
 * to amounts within tolerance of the obligation's expected amount.
 */

import { OBLIGATIONS_DIR } from '../../db/connection.js';
import { getObligationById } from '../../db/repositories/obligations.js';
import { getTransactions } from '../../db/repositories/transactions.js';
import {
  amountWithinTolerance,
  DEFAULT_OBLIGATION_AMOUNT_TOLERANCE_RATIO,
} from './amount-tolerance.js';
import { buildObligationRegistry } from './registry.js';
import { obligationProjectsToRow, projectObligationToRow } from './obligation-projection.js';
import type { OutgoingObligation } from '../../../shared/api-contracts.js';

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
  toleranceRatio: number;
}

export function obligationPaymentExpectation(
  obligationId: string,
): ObligationPaymentExpectation | null {
  const registry = buildObligationRegistry(OBLIGATIONS_DIR);
  const declared = registry.all.find(c => c.id === obligationId);
  if (declared !== undefined && obligationProjectsToRow(declared)) {
    const projected = projectObligationToRow(declared, undefined);
    return {
      expectedAmount: projected.expectedAmount,
      toleranceRatio: amountToleranceForDeclared(declared),
    };
  }
  const row = getObligationById(obligationId);
  if (row === undefined) return null;
  return {
    expectedAmount: row.expected_amount,
    toleranceRatio: DEFAULT_OBLIGATION_AMOUNT_TOLERANCE_RATIO,
  };
}

function amountToleranceForDeclared(
  c: Extract<OutgoingObligation, { category: 'insurance' | 'subscription' | 'tax-manual' }>,
): number {
  if (c.category === 'insurance' && c.amountTolerance !== undefined) {
    return c.amountTolerance;
  }
  return DEFAULT_OBLIGATION_AMOUNT_TOLERANCE_RATIO;
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
      return amountWithinTolerance(
        Math.abs(row.amount),
        expectation.expectedAmount,
        expectation.toleranceRatio,
      );
    })
    .map(row => ({
      hash: row.hash,
      date: row.date,
      amount: row.amount,
      account: row.account,
      description: row.description,
    }));
}
