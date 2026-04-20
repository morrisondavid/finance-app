/**
 * Rental-income helpers backed by the declared commitments registry.
 *
 * Replaces the old `server/utils/rental-properties.ts` constant + helpers.
 * Every function in this file reads from the registry so there is one —
 * and only one — place that declares rental properties.
 */

import type { PersonId } from '../../../shared/api-contracts.js';
import {
  getDeclaredCommitmentRegistry,
  type DeclaredCommitmentRegistry,
} from './registry.js';

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
 * Fail at boot if any rental-income commitment has an ownership split that
 * doesn't sum to ~1. Mirrors the legacy `assertOwnershipIntegrity` check
 * but reads from the registry.
 */
export function assertRentalOwnershipIntegrity(
  registry: DeclaredCommitmentRegistry = getDeclaredCommitmentRegistry(),
): void {
  const rentals = registry.listByCategory('rental-income');
  for (const property of rentals) {
    const sum = Object.values(property.ownership).reduce<number>(
      (acc, share) => acc + (share ?? 0),
      0,
    );
    if (Math.abs(sum - 1) > OWNERSHIP_SUM_EPSILON) {
      throw new Error(
        `Rental commitment ${property.id} ownership must sum to 1, got ${sum.toFixed(4)}`,
      );
    }
  }
}

/**
 * Sum rental income attributable to a single person over a date range
 * (inclusive). Iterates every `rental-income` commitment and applies its
 * ownership share to matched inbound transactions on the configured
 * account + payee.
 */
export function sumRentalIncomeForPerson(
  db: PreparableDb,
  personId: PersonId,
  startDate: string,
  endDate: string,
  registry: DeclaredCommitmentRegistry = getDeclaredCommitmentRegistry(),
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
