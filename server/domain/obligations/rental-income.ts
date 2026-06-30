/**
 * Rental-income helpers backed by the obligations registry.
 *
 * Replaces the old `server/utils/rental-properties.ts` constant + helpers.
 * Every function in this file reads from the registry so there is one —
 * and only one — place that declares rental properties.
 */

import type { PersonId, RecurringExpense } from '../../../shared/api-contracts.js';
import type { PipelineResult } from '../../utils/recurring-pipeline.js';
import {
  getObligationRegistry,
  type ObligationRegistry,
} from './registry.js';
import { categorizeTransaction } from '../../utils/categorizer.js';
import { SPECIAL_CATEGORY } from '../../utils/category-constants.js';

/** Tolerance for floating-point sum drift when validating ownership splits. */
const OWNERSHIP_SUM_EPSILON = 0.0001;

/**
 * Minimal shape of the DB used by {@link sumRentalIncomeForPerson}. Typed
 * locally so this module doesn't depend on better-sqlite3 and stays
 * testable with an in-memory double.
 */
interface PreparableDb {
  prepare(sql: string): {
    get(...params: unknown[]): unknown;
  };
}

/**
 * Fail at boot if any rental-income obligation has an ownership split that
 * doesn't sum to ~1. Mirrors the legacy `assertOwnershipIntegrity` check
 * but reads from the registry.
 */
export function assertRentalOwnershipIntegrity(
  registry: ObligationRegistry = getObligationRegistry(),
): void {
  const rentals = registry.listByCategory('rental-income');
  for (const property of rentals) {
    const sum = Object.values(property.ownership).reduce<number>(
      (acc, share) => acc + (share ?? 0),
      0,
    );
    if (Math.abs(sum - 1) > OWNERSHIP_SUM_EPSILON) {
      throw new Error(
        `Rental obligation ${property.id} ownership must sum to 1, got ${sum.toFixed(4)}`,
      );
    }
  }
}

/**
 * Fail at boot if any rental-income obligation's merchant does not
 * classify to {@link SPECIAL_CATEGORY.property} via the string-heuristic
 * categorizer. The recurring pipeline now lets the registry drive the
 * category (inverted lookup), but other surfaces — dashboard charts,
 * budgeting, ad-hoc expense classification — still call
 * {@link categorizeTransaction} directly. This invariant guarantees the
 * two sources agree on every declared rental, so a mis-configured
 * merchants registry entry surfaces loudly at boot rather than silently
 * bucketing rental income under `Other` on those surfaces.
 */
export function assertRentalMerchantsClassify(
  registry: ObligationRegistry = getObligationRegistry(),
): void {
  for (const property of registry.listByCategory('rental-income')) {
    const category = categorizeTransaction(property.merchant);
    if (category !== SPECIAL_CATEGORY.property) {
      throw new Error(
        `Rental obligation ${property.id} merchant "${property.merchant}" classifies as "${category}", expected "${SPECIAL_CATEGORY.property}". Add a matching entry to server/domain/merchants/data.ts.`,
      );
    }
  }
}

/**
 * Sum rental income attributable to a single person over a date range
 * (inclusive). Iterates every `rental-income` obligation and applies its
 * ownership share to matched inbound transactions on the configured
 * account + payee.
 */
/**
 * Declared rental rows from the recurring pipeline — the subset of
 * `monthlyIncomeRecurring` backed by active `rental-income` obligations.
 */
export function selectDeclaredRentalIncomeRows(
  pipeline: PipelineResult,
  registry: ObligationRegistry = getObligationRegistry(),
): RecurringExpense[] {
  const rentalIds = new Set(
    registry.listByCategory('rental-income').map(o => o.id),
  );
  return pipeline.monthlyIncomeRecurring.filter(
    row => row.declaredObligationId !== undefined
      && rentalIds.has(row.declaredObligationId),
  );
}

export function sumRentalIncomeForPerson(
  db: PreparableDb,
  personId: PersonId,
  startDate: string,
  endDate: string,
  registry: ObligationRegistry = getObligationRegistry(),
): number {
  let total = 0;
  for (const property of registry.listByCategory('rental-income')) {
    const share = property.ownership[personId] ?? 0;
    if (share === 0) continue;
    if (property.account === undefined) continue;

    const row = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM transactions
      WHERE type = 'income'
        AND account = ?
        AND description LIKE ?
        AND date >= ? AND date <= ?
    `).get(
      property.account,
      `%${property.merchant}%`,
      startDate,
      endDate,
    ) as { total: number };

    total += row.total * share;
  }
  return total;
}
