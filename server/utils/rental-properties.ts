import type { AccountName } from '../types.js';
import {
  type AllocationByPerson,
  type PersonId,
  PEOPLE,
} from '../config/people.js';

/**
 * A rental property with its ownership split for UK Self Assessment
 * attribution. Per-property `ownership` values must sum to 1 — enforced at
 * import time by {@link assertOwnershipIntegrity} so config errors fail
 * startup rather than silently skewing tax estimates.
 */
export interface RentalProperty {
  /** Stable id used in logs and cross-config references. */
  readonly id: string;
  /** Display name for UI. */
  readonly name: string;
  /** Value from `normalizeMerchant(description)` that books rent payments to this property. */
  readonly merchant: string;
  /** Gross monthly rent figure (before agent fees / deductions). */
  readonly grossRent: number;
  /** Account the rent lands in. Must be a known account id — typos fail at compile time. */
  readonly account: AccountName;
  /** Ownership share per person (values must sum to 1). Drives SA rental-income attribution. */
  readonly ownership: AllocationByPerson;
}

export const RENTAL_PROPERTIES: readonly RentalProperty[] = [
  {
    id: 'hunters-square-78',
    name: '78 Hunters Square',
    merchant: 'Stoneshaw Estates',
    grossRent: 1292.72,
    account: 'monzo-joint',
    ownership: { david: 0.5, heena: 0.5 },
  },
  {
    id: 'thorney-house-56',
    name: '56 Thorney House',
    merchant: 'Prospect Holdings',
    grossRent: 979.2,
    account: 'monzo-joint',
    ownership: { david: 0.5, heena: 0.5 },
  },
] as const;

/** Tolerance for floating-point sum drift when validating ownership splits. */
const OWNERSHIP_SUM_EPSILON = 0.0001;

/**
 * Sanity-check every rental property's ownership split sums to ~1. Runs once
 * at module load so misconfigured splits fail the server at startup rather
 * than produce silently wrong SA estimates. Exported for tests.
 */
export function assertOwnershipIntegrity(
  properties: readonly RentalProperty[] = RENTAL_PROPERTIES,
): void {
  for (const property of properties) {
    const sum = Object.values(property.ownership).reduce<number>(
      (acc, share) => acc + (share ?? 0),
      0,
    );
    if (Math.abs(sum - 1) > OWNERSHIP_SUM_EPSILON) {
      throw new Error(
        `Rental property ${property.id} ownership must sum to 1, got ${sum.toFixed(4)}`,
      );
    }
    for (const key of Object.keys(property.ownership)) {
      if (!PEOPLE.some(p => p.id === key)) {
        throw new Error(
          `Rental property ${property.id} references unknown person '${key}'`,
        );
      }
    }
  }
}

assertOwnershipIntegrity();

export function matchRentalProperty(
  merchant: string,
  account: string,
  amount: number,
): RentalProperty | null {
  const candidates = RENTAL_PROPERTIES.filter(
    p => p.merchant === merchant && p.account === account,
  );
  if (candidates.length === 0) return null;
  let best = candidates[0];
  let bestDiff = Math.abs(amount - best.grossRent);
  for (let i = 1; i < candidates.length; i++) {
    const diff = Math.abs(amount - candidates[i].grossRent);
    if (diff < bestDiff) {
      best = candidates[i];
      bestDiff = diff;
    }
  }
  return best;
}

/**
 * Minimal shape of the DB used by {@link sumRentalIncomeForPerson}. Typed
 * locally so this module does not need to depend on the better-sqlite3
 * import (keeps the function testable with an in-memory double).
 */
interface PreparableDb {
  prepare(sql: string): {
    get(...params: unknown[]): unknown;
  };
}

/**
 * Sum rental income attributable to a single person over a date range.
 * Iterates the configured properties, sums inbound transactions that match
 * each property's merchant + account, and applies the per-property
 * ownership split.
 *
 * Date range is inclusive on both ends.
 */
export function sumRentalIncomeForPerson(
  db: PreparableDb,
  personId: PersonId,
  startDate: string,
  endDate: string,
): number {
  let total = 0;
  for (const property of RENTAL_PROPERTIES) {
    const share = property.ownership[personId] ?? 0;
    if (share === 0) continue;

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
