/**
 * CSV I/O for `autonize-it/transaction-category-overrides.csv` — the
 * per-transaction category override store (Roadmap 1.1 / Phase 8).
 *
 * Each row pins one transaction hash to a specific `CategoryName`,
 * overriding the description-based pattern lookup in
 * {@link categorizeTransaction}. The primary driver is inter-company
 * classification (see `INTER_COMPANY_CATEGORIES`) but the file is
 * general-purpose.
 *
 * Schema (header is part of the file):
 *
 *   hash,category,notes,classified_at
 *
 * - `hash`          : stable transaction hash (matches
 *                     `transactions.hash` column).
 * - `category`      : any `CategoryName`. Rejected at parse time
 *                     when unknown.
 * - `notes`         : optional free-text; empty string == `null`.
 * - `classified_at` : ISO date (`YYYY-MM-DD`) the row was written.
 *
 * Invariants:
 * - Writes are atomic via `atomicWriteCsv` — partial files never
 *   appear on disk, even across crashes.
 * - Reader returns `null` (not an empty array) when the file is
 *   absent, so callers can distinguish "never written" from "written
 *   then emptied". Reader returns `[]` when the file exists with only
 *   the header row.
 * - Duplicate hashes in a single file are parsed in-order; the caller
 *   (registry) is expected to last-write-wins them into a Map.
 */

import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import {
  TransactionCategoryOverrideRowSchema,
  type TransactionCategoryOverrideRow,
} from '../../../shared/api-contracts.js';
import { escapeCsvField, atomicWriteCsv } from '../../utils/csv-helpers.js';

export const OVERRIDES_CSV_FILENAME = 'transaction-category-overrides.csv';

export function getOverridesCsvPath(autonizeItDir: string): string {
  return path.join(autonizeItDir, OVERRIDES_CSV_FILENAME);
}

export const OVERRIDES_CSV_HEADERS = [
  'hash',
  'category',
  'notes',
  'classified_at',
] as const;

/**
 * Parse the CSV text. Returns rows in file order, with empty `notes`
 * cells rehydrated to `null`. Unknown categories or malformed rows
 * throw via Zod.
 */
export function parseOverridesCsv(text: string): TransactionCategoryOverrideRow[] {
  const records = parse(text, {
    columns: true,
    skip_empty_lines: true,
    trim: false,
  }) as Array<Record<string, string>>;

  return records.map((record, idx) => {
    const notes = (record.notes ?? '').length === 0 ? null : record.notes;
    const candidate = {
      hash: record.hash ?? '',
      category: record.category ?? '',
      notes,
      classified_at: record.classified_at ?? '',
    };
    const result = TransactionCategoryOverrideRowSchema.safeParse(candidate);
    if (!result.success) {
      const issue = result.error.issues[0];
      throw new Error(
        `Invalid row ${idx + 2} in ${OVERRIDES_CSV_FILENAME}: ${issue.path.join('.')} — ${issue.message}`,
      );
    }
    return result.data;
  });
}

/**
 * Read the override CSV. Returns `null` if the file doesn't exist
 * so the registry can treat "no file" distinctly from "empty file".
 */
export function readOverridesCsvFile(
  csvPath: string,
): TransactionCategoryOverrideRow[] | null {
  if (!fs.existsSync(csvPath)) return null;
  const text = fs.readFileSync(csvPath, 'utf8');
  return parseOverridesCsv(text);
}

/**
 * Serialize rows back to CSV text. Preserves the header and emits
 * empty strings for `null` notes so round-trip (parse → serialize →
 * parse) is byte-identical.
 */
export function serializeOverridesCsv(
  rows: readonly TransactionCategoryOverrideRow[],
): string {
  const header = OVERRIDES_CSV_HEADERS.join(',');
  const lines = rows.map(row => serializeRow(row));
  return `${header}\n${lines.join('\n')}${lines.length > 0 ? '\n' : ''}`;
}

function serializeRow(row: TransactionCategoryOverrideRow): string {
  const cells = [
    row.hash,
    row.category,
    row.notes ?? '',
    row.classified_at,
  ];
  return cells.map(escapeCsvField).join(',');
}

/**
 * Atomically write the override CSV. Creates the directory if
 * needed. Upstream invariant: `rows` should already be the full
 * desired state (last-write-wins semantics live in the registry,
 * not here).
 */
export function writeOverridesCsvFile(
  csvPath: string,
  rows: readonly TransactionCategoryOverrideRow[],
): void {
  atomicWriteCsv(csvPath, serializeOverridesCsv(rows));
}
