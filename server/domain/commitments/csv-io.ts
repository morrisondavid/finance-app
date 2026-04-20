/**
 * CSV I/O for declared commitments.
 *
 * The on-disk CSV is a single flat shape that covers every category in the
 * discriminated union; irrelevant columns are left empty for categories that
 * don't use them. `parseCommitmentRow` rehydrates the correct variant and
 * runs it through the Zod schema so invalid rows fail at the trust boundary
 * with a precise path.
 *
 * See docs/adr/0001-declared-commitments.md §7.
 */

import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import {
  type DeclaredCommitment,
  type DeclaredIncoming,
  type DeclaredOutgoing,
  DeclaredIncomingSchema,
  DeclaredOutgoingSchema,
  type DeclaredIncomingCategory,
  type DeclaredOutgoingCategory,
  type PersonId,
} from '../../../shared/api-contracts.js';

export const COMMITMENTS_SEED_FILENAME = 'seed.csv';
export const COMMITMENTS_USER_FILENAME = 'commitments.csv';

export const COMMITMENT_CSV_HEADERS = [
  'id',
  'category',
  'cadence',
  'merchant',
  'display_name',
  'account',
  'amount',
  'currency',
  'notes',
  'ownership_david',
  'ownership_heena',
  'person_id',
  'amount_tolerance',
  'due_date',
] as const;

export function getCommitmentsSeedCsvPath(commitmentsDir: string): string {
  return path.join(commitmentsDir, COMMITMENTS_SEED_FILENAME);
}

export function getCommitmentsUserCsvPath(commitmentsDir: string): string {
  return path.join(commitmentsDir, COMMITMENTS_USER_FILENAME);
}

const INCOMING_CATEGORIES = new Set<DeclaredIncomingCategory>(['rental-income']);
const OUTGOING_CATEGORIES = new Set<DeclaredOutgoingCategory>([
  'fixed-bill',
  'subscription',
  'payroll',
  'insurance',
  'tax-manual',
]);

function nonEmpty(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function parseNumber(value: string | undefined, field: string, rowId: string): number | undefined {
  const raw = nonEmpty(value);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`Commitment ${rowId}: ${field} must be numeric, got '${raw}'`);
  }
  return n;
}

function buildOwnership(row: Record<string, string>, rowId: string): Partial<Record<PersonId, number>> {
  const ownership: Partial<Record<PersonId, number>> = {};
  const david = parseNumber(row.ownership_david, 'ownership_david', rowId);
  const heena = parseNumber(row.ownership_heena, 'ownership_heena', rowId);
  if (david !== undefined) ownership.david = david;
  if (heena !== undefined) ownership.heena = heena;
  return ownership;
}

function buildCommonFields(row: Record<string, string>, rowId: string) {
  const amount = parseNumber(row.amount, 'amount', rowId);
  if (amount === undefined) {
    throw new Error(`Commitment ${rowId}: amount is required`);
  }
  return {
    id: rowId,
    cadence: row.cadence,
    merchant: row.merchant,
    displayName: nonEmpty(row.display_name),
    account: nonEmpty(row.account),
    amount,
    currency: nonEmpty(row.currency) ?? 'GBP',
    notes: nonEmpty(row.notes),
  };
}

/**
 * Turn a flat CSV row into a validated `DeclaredCommitment` (either variant
 * of the union). Throws a descriptive error if the `category` column is
 * unknown or the row violates the Zod schema.
 */
export function parseCommitmentRow(row: Record<string, string>): DeclaredCommitment {
  const rowId = nonEmpty(row.id) ?? '<missing-id>';
  const category = nonEmpty(row.category);
  if (category === undefined) {
    throw new Error(`Commitment ${rowId}: category column is required`);
  }
  const common = buildCommonFields(row, rowId);

  if (INCOMING_CATEGORIES.has(category as DeclaredIncomingCategory)) {
    if (category === 'rental-income') {
      return DeclaredIncomingSchema.parse({
        ...common,
        category: 'rental-income',
        ownership: buildOwnership(row, rowId),
      });
    }
  }

  if (OUTGOING_CATEGORIES.has(category as DeclaredOutgoingCategory)) {
    switch (category) {
      case 'fixed-bill':
      case 'subscription':
        return DeclaredOutgoingSchema.parse({ ...common, category });
      case 'payroll':
        return DeclaredOutgoingSchema.parse({
          ...common,
          category,
          personId: nonEmpty(row.person_id),
          amountTolerance: parseNumber(row.amount_tolerance, 'amount_tolerance', rowId),
        });
      case 'insurance':
        return DeclaredOutgoingSchema.parse({
          ...common,
          category,
          dueDate: nonEmpty(row.due_date),
        });
      case 'tax-manual':
        return DeclaredOutgoingSchema.parse({
          ...common,
          category,
          personId: nonEmpty(row.person_id),
          dueDate: nonEmpty(row.due_date),
        });
    }
  }

  throw new Error(`Commitment ${rowId}: unknown category '${category}'`);
}

export function readCommitmentsCsvFile(csvPath: string): DeclaredCommitment[] {
  if (!fs.existsSync(csvPath)) return [];
  const content = fs.readFileSync(csvPath, 'utf8').trim();
  if (content === '') return [];

  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as Record<string, string>[];

  const rows: DeclaredCommitment[] = [];
  for (const row of records) {
    if (!nonEmpty(row.id)) continue;
    rows.push(parseCommitmentRow(row));
  }
  return rows;
}

export function isDeclaredIncoming(c: DeclaredCommitment): c is DeclaredIncoming {
  return INCOMING_CATEGORIES.has(c.category as DeclaredIncomingCategory);
}

export function isDeclaredOutgoing(c: DeclaredCommitment): c is DeclaredOutgoing {
  return OUTGOING_CATEGORIES.has(c.category as DeclaredOutgoingCategory);
}
