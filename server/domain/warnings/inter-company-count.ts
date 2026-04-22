/**
 * Count of inter-company pairs that still need manual
 * classification (Roadmap 1.1 / Phase 8).
 *
 * A pair is considered "classified" when at least one side (expense
 * or income) has an override in `transaction-category-overrides.csv`
 * whose category is in {@link INTER_COMPANY_CATEGORIES}. Everything
 * else — including `Inter-company False Positive`, because that is a
 * inter-company category — suppresses the warning for that pair.
 *
 * The Warnings Engine emits a single aggregate warning keyed on this
 * count (see `entity-foundation.ts`). The Warnings tab renders each
 * pair individually so the user can classify them one by one via the
 * Phase 8 POST /classify endpoint.
 */

import type Database from 'better-sqlite3';
import { findInterCompanyPairs } from '../inter-company/pair-finder.js';
import { lookupOverride } from '../transaction-overrides/index.js';
import { isInterCompanyCategory } from '../../../shared/category-names.js';

/**
 * Return the number of inter-company candidate pairs whose category
 * is not yet in the inter-company set on either side. Pairs with at
 * least one classified side — including explicit `Inter-company False
 * Positive` — are excluded.
 */
export function countUnclassifiedInterCompanyPairs(db: Database.Database): number {
  const pairs = findInterCompanyPairs(db);
  if (pairs.length === 0) return 0;

  let unclassified = 0;
  for (const pair of pairs) {
    const expenseOverride = lookupOverride(pair.expense.hash);
    const incomeOverride = lookupOverride(pair.income.hash);
    const classified =
      (expenseOverride !== null && isInterCompanyCategory(expenseOverride)) ||
      (incomeOverride !== null && isInterCompanyCategory(incomeOverride));
    if (!classified) unclassified++;
  }
  return unclassified;
}
