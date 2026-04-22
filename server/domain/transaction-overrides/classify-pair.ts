/**
 * Apply a inter-company pair classification to
 * `transaction-category-overrides.csv` (Roadmap 1.1 / Phase 8).
 *
 * The service layer behind POST
 * `/api/warnings/inter-company-movements/classify`. Responsible for:
 *
 *   1. Verifying both transaction hashes exist in the DB.
 *   2. Verifying the two hashes form a valid inter-company pair (the
 *      same pair finder the warning uses).
 *   3. Upserting both sides of the pair in the override CSV under
 *      the same category + notes + timestamp.
 *   4. Clearing the pair (removing both hashes) when `category` is
 *      `null`.
 *   5. Invalidating the registry cache so subsequent reads see the
 *      new state.
 *
 * Route-level Zod validation handles the basic shape (strings,
 * category within the inter-company enum, notes length cap). Business
 * invariants live here so they remain unit-testable without an HTTP
 * round-trip.
 */

import type Database from 'better-sqlite3';
import type { CategoryName } from '../../../shared/category-names.js';
import { isInterCompanyCategory } from '../../../shared/category-names.js';
import {
  getOverridesCsvPath,
  readOverridesCsvFile,
  writeOverridesCsvFile,
} from './csv-io.js';
import {
  getOverridesDir,
  invalidateOverrideRegistry,
} from './registry.js';
import { findInterCompanyPairs } from '../inter-company/pair-finder.js';
import { toIsoDate } from '../../../shared/iso-date.js';
import type { TransactionCategoryOverrideRow } from '../../../shared/api-contracts.js';

export type ClassifyPairResult =
  | { ok: true }
  | { ok: false; status: 400 | 404; error: string };

export interface ClassifyPairInput {
  readonly expenseHash: string;
  readonly incomeHash: string;
  /** `null` clears the classification (removes both rows). */
  readonly category: CategoryName | null;
  readonly notes: string | null;
  /** Injected for deterministic `classified_at` in tests. */
  readonly today?: Date;
}

export function classifyInterCompanyPair(
  db: Database.Database,
  input: ClassifyPairInput,
): ClassifyPairResult {
  if (input.expenseHash === input.incomeHash) {
    return { ok: false, status: 400, error: 'expenseHash and incomeHash must refer to different transactions' };
  }

  if (input.category !== null && !isInterCompanyCategory(input.category)) {
    return {
      ok: false,
      status: 400,
      error: `category "${input.category}" is not a inter-company category`,
    };
  }

  const existsStmt = db.prepare(
    `SELECT hash FROM transactions WHERE hash = ? LIMIT 1`,
  );
  if (existsStmt.get(input.expenseHash) === undefined) {
    return { ok: false, status: 404, error: `expenseHash ${input.expenseHash} not found in transactions` };
  }
  if (existsStmt.get(input.incomeHash) === undefined) {
    return { ok: false, status: 404, error: `incomeHash ${input.incomeHash} not found in transactions` };
  }

  // Must actually be a detected pair. Rejecting unrelated hashes
  // here prevents the UI from smuggling arbitrary categories into
  // transactions that aren't part of a inter-company movement — if
  // they need recategorising, that belongs to a different endpoint.
  const pairs = findInterCompanyPairs(db);
  const match = pairs.find(
    p => p.expense.hash === input.expenseHash && p.income.hash === input.incomeHash,
  );
  if (match === undefined) {
    return {
      ok: false,
      status: 400,
      error: 'the supplied hashes do not form a detected inter-company pair',
    };
  }

  const dir = getOverridesDir();
  const csvPath = getOverridesCsvPath(dir);
  const existing = readOverridesCsvFile(csvPath) ?? [];

  // Strip any prior rows for either hash so the new category (or
  // clear) fully supersedes them — no stale last-write-wins drift.
  const filtered = existing.filter(
    row => row.hash !== input.expenseHash && row.hash !== input.incomeHash,
  );

  const next: TransactionCategoryOverrideRow[] = filtered;
  if (input.category !== null) {
    const classifiedAt = toIsoDate(input.today ?? new Date());
    next.push({
      hash: input.expenseHash,
      category: input.category,
      notes: input.notes,
      classified_at: classifiedAt,
    });
    next.push({
      hash: input.incomeHash,
      category: input.category,
      notes: input.notes,
      classified_at: classifiedAt,
    });
  }

  writeOverridesCsvFile(csvPath, next);
  invalidateOverrideRegistry();

  return { ok: true };
}
