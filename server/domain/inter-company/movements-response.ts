/**
 * Build the API-shape response for the Phase 8 Warnings tab
 * inter-company movements list. Joins the DB-facing pair finder with
 * the override registry, collapses to a single canonical
 * `classification` per pair, and computes the classified /
 * unclassified / total counters.
 *
 * Kept separate from the route so the same projection is reusable
 * from the POST /classify endpoint (which returns the refreshed
 * payload after writing).
 */

import type Database from 'better-sqlite3';
import { findInterCompanyPairs } from './pair-finder.js';
import { getOverrideRegistry } from '../transaction-overrides/registry.js';
import {
  isInterCompanyCategory,
  type CategoryName,
} from '../../../shared/category-names.js';
import type { InterCompanyMovementsResponse } from '../../../shared/api-contracts.js';

/**
 * Resolve the canonical classification for a pair. Expense side
 * wins when both sides have a inter-company override; a non-cross-
 * entity override on either side is ignored. Returns `null` when
 * neither side has a inter-company classification.
 */
function resolvePairClassification(
  expenseHash: string,
  incomeHash: string,
): CategoryName | null {
  const overrides = getOverrideRegistry();
  const expenseOverride = overrides.get(expenseHash);
  if (expenseOverride !== null && isInterCompanyCategory(expenseOverride)) {
    return expenseOverride;
  }
  const incomeOverride = overrides.get(incomeHash);
  if (incomeOverride !== null && isInterCompanyCategory(incomeOverride)) {
    return incomeOverride;
  }
  return null;
}

export function buildInterCompanyMovementsResponse(
  db: Database.Database,
): InterCompanyMovementsResponse {
  const pairs = findInterCompanyPairs(db);
  let classified = 0;

  const payloadPairs = pairs.map(pair => {
    const classification = resolvePairClassification(
      pair.expense.hash,
      pair.income.hash,
    );
    if (classification !== null) classified++;

    return {
      expense: {
        hash: pair.expense.hash,
        date: pair.expense.date,
        account: pair.expense.account,
        amount: pair.expense.amount,
        description: pair.expense.description,
        entityId: pair.expense.entityId,
      },
      income: {
        hash: pair.income.hash,
        date: pair.income.date,
        account: pair.income.account,
        amount: pair.income.amount,
        description: pair.income.description,
        entityId: pair.income.entityId,
      },
      classification,
    };
  });

  return {
    pairs: payloadPairs,
    classified,
    unclassified: payloadPairs.length - classified,
    total: payloadPairs.length,
  };
}
