/**
 * CSV I/O for obligations.
 *
 * The on-disk CSV is a single flat shape that covers every category in the
 * discriminated union; irrelevant columns are left empty for categories that
 * don't use them. `parseObligationRow` rehydrates the correct variant and
 * runs it through the Zod schema so invalid rows fail at the trust boundary
 * with a precise path.
 *
 * See docs/adr/0001-obligations.md §7.
 */

import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import {
  type Obligation,
  type IncomingObligation,
  type OutgoingObligation,
  IncomingObligationSchema,
  OutgoingObligationSchema,
  type IncomingObligationCategory,
  type OutgoingObligationCategory,
  type PersonId,
} from '../../../shared/api-contracts.js';

export const OBLIGATIONS_SEED_FILENAME = 'obligations-seed.csv';
export const OBLIGATIONS_USER_FILENAME = 'obligations.csv';

export const OBLIGATION_CSV_HEADERS = [
  'id',
  'category',
  'frequency',
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
  'tax_type',
] as const;

export function getObligationsSeedCsvPath(obligationsDir: string): string {
  return path.join(obligationsDir, OBLIGATIONS_SEED_FILENAME);
}

export function getObligationsUserCsvPath(obligationsDir: string): string {
  return path.join(obligationsDir, OBLIGATIONS_USER_FILENAME);
}

const INCOMING_CATEGORIES = new Set<IncomingObligationCategory>(['rental-income']);
const OUTGOING_CATEGORIES = new Set<OutgoingObligationCategory>([
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
    throw new Error(`Obligation ${rowId}: ${field} must be numeric, got '${raw}'`);
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
    throw new Error(`Obligation ${rowId}: amount is required`);
  }
  return {
    id: rowId,
    frequency: row.frequency,
    merchant: row.merchant,
    displayName: nonEmpty(row.display_name),
    account: nonEmpty(row.account),
    amount,
    currency: nonEmpty(row.currency) ?? 'GBP',
    notes: nonEmpty(row.notes),
  };
}

/**
 * Turn a flat CSV row into a validated `Obligation` (either variant
 * of the union). Throws a descriptive error if the `category` column is
 * unknown or the row violates the Zod schema.
 */
export function parseObligationRow(row: Record<string, string>): Obligation {
  const rowId = nonEmpty(row.id) ?? '<missing-id>';
  const category = nonEmpty(row.category);
  if (category === undefined) {
    throw new Error(`Obligation ${rowId}: category column is required`);
  }
  const common = buildCommonFields(row, rowId);

  if (INCOMING_CATEGORIES.has(category as IncomingObligationCategory)) {
    if (category === 'rental-income') {
      return IncomingObligationSchema.parse({
        ...common,
        category: 'rental-income',
        ownership: buildOwnership(row, rowId),
      });
    }
  }

  if (OUTGOING_CATEGORIES.has(category as OutgoingObligationCategory)) {
    switch (category) {
      case 'fixed-bill':
      case 'subscription':
        return OutgoingObligationSchema.parse({ ...common, category });
      case 'payroll':
        return OutgoingObligationSchema.parse({
          ...common,
          category,
          personId: nonEmpty(row.person_id),
          amountTolerance: parseNumber(row.amount_tolerance, 'amount_tolerance', rowId),
        });
      case 'insurance':
        return OutgoingObligationSchema.parse({
          ...common,
          category,
          dueDate: nonEmpty(row.due_date),
          amountTolerance: parseNumber(row.amount_tolerance, 'amount_tolerance', rowId),
        });
      case 'tax-manual':
        return OutgoingObligationSchema.parse({
          ...common,
          category,
          personId: nonEmpty(row.person_id),
          dueDate: nonEmpty(row.due_date),
          taxType: nonEmpty(row.tax_type),
        });
    }
  }

  throw new Error(`Obligation ${rowId}: unknown category '${category}'`);
}

export function readObligationsCsvFile(csvPath: string): Obligation[] {
  if (!fs.existsSync(csvPath)) return [];
  const content = fs.readFileSync(csvPath, 'utf8').trim();
  if (content === '') return [];

  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as Record<string, string>[];

  const rows: Obligation[] = [];
  for (const row of records) {
    if (!nonEmpty(row.id)) continue;
    rows.push(parseObligationRow(row));
  }
  return rows;
}

export function isIncomingObligation(c: Obligation): c is IncomingObligation {
  return INCOMING_CATEGORIES.has(c.category as IncomingObligationCategory);
}

export function isOutgoingObligation(c: Obligation): c is OutgoingObligation {
  return OUTGOING_CATEGORIES.has(c.category as OutgoingObligationCategory);
}
