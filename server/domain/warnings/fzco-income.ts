/**
 * FZCO (UAE) income aggregation helpers used by the Warnings
 * Engine. Single responsibility: sum trailing-12m AED income on
 * `autonize-it-fzco` accounts for the UAE VAT-threshold check.
 *
 * Kept DB-aware so `entity-foundation.ts` can remain a pure
 * function of its input data.
 */

import type Database from 'better-sqlite3';
import { getAccountsByEntity } from '../../types.js';
import { toIsoDate, shiftIsoDate } from '../../../shared/iso-date.js';

/**
 * Sum of `income` amounts on FZCO-linked accounts over the 365-day
 * window ending at `today` (inclusive). Returns 0 when the FZCO
 * entity has no registered accounts so callers can treat it as a
 * no-op on UK-only deployments.
 */
export function sumFzcoTrailing12mIncomeAed(
  db: Database.Database,
  today: Date,
): number {
  const uaeAccounts = getAccountsByEntity('autonize-it-fzco');
  if (uaeAccounts.length === 0) return 0;
  const placeholders = uaeAccounts.map(() => '?').join(', ');
  const endIso = toIsoDate(today);
  const startIso = shiftIsoDate(endIso, -365);
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM transactions
       WHERE type = 'income'
         AND account IN (${placeholders})
         AND date >= ? AND date <= ?`,
    )
    .get(...uaeAccounts, startIso, endIso) as { total: number };
  return row.total;
}
