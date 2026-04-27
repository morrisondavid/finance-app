/**
 * CSV I/O for `debt-strategy/movements.csv` (§1.9).
 *
 * Sibling of `plans.csv`. Read AND write (mutated by API
 * acknowledge/dismiss/add). Atomically rewritten on every mutation.
 */

import path from 'path';
import { MovementSchema, type Movement } from './movements-schema.js';
import {
  createCsvDecoders,
  nullIfEmpty,
  readCsvRecords,
} from '../../utils/csv-decoders.js';
import { atomicWriteCsv, escapeCsvField } from '../../utils/csv-helpers.js';

const decoders = createCsvDecoders('Movement');
const {
  requireNonEmpty,
  decodeNumber,
  decodeNonNegativeInt,
  decodeIsoDate,
  decodeNullableIsoDate,
} = decoders;

export const MOVEMENTS_CSV_FILENAME = 'movements.csv';

export const MOVEMENT_CSV_HEADERS = [
  'id',
  'plan_id',
  'from_account',
  'to_account',
  'amount',
  'day_of_month',
  'expected_start_date',
  'expected_end_date',
  'acknowledged_at',
  'dismissed_missed_until',
  'updated_at',
] as const;

export function getMovementsCsvPath(debtStrategyDir: string): string {
  return path.join(debtStrategyDir, MOVEMENTS_CSV_FILENAME);
}

export function parseMovementRow(row: Record<string, string>): Movement {
  const rowId = nullIfEmpty(row.id) ?? '<missing-id>';
  return MovementSchema.parse({
    id: requireNonEmpty(row.id, 'id', rowId),
    plan_id: requireNonEmpty(row.plan_id, 'plan_id', rowId),
    from_account: requireNonEmpty(row.from_account, 'from_account', rowId),
    to_account: requireNonEmpty(row.to_account, 'to_account', rowId),
    amount: decodeNumber(row.amount, 'amount', rowId),
    day_of_month: decodeNonNegativeInt(row.day_of_month, 'day_of_month', rowId),
    expected_start_date: decodeIsoDate(row.expected_start_date, 'expected_start_date', rowId),
    expected_end_date: decodeNullableIsoDate(row.expected_end_date, 'expected_end_date', rowId),
    acknowledged_at: decodeNullableIsoDate(row.acknowledged_at, 'acknowledged_at', rowId),
    dismissed_missed_until: decodeNullableIsoDate(row.dismissed_missed_until, 'dismissed_missed_until', rowId),
    updated_at: decodeIsoDate(row.updated_at, 'updated_at', rowId),
  });
}

export function readMovementsCsvFile(csvPath: string): Movement[] {
  const rows: Movement[] = [];
  for (const row of readCsvRecords(csvPath)) {
    if (!nullIfEmpty(row.id)) continue;
    rows.push(parseMovementRow(row));
  }
  return rows;
}

function movementToCsvRow(m: Movement): string {
  return [
    m.id,
    m.plan_id,
    m.from_account,
    m.to_account,
    String(m.amount),
    String(m.day_of_month),
    m.expected_start_date,
    m.expected_end_date ?? '',
    m.acknowledged_at ?? '',
    m.dismissed_missed_until ?? '',
    m.updated_at,
  ].map(c => (c.includes(',') || c.includes('"') ? escapeCsvField(c) : c)).join(',');
}

export function writeMovementsCsvFile(csvPath: string, movements: readonly Movement[]): void {
  const sorted = [...movements].sort((a, b) =>
    a.plan_id.localeCompare(b.plan_id) || a.id.localeCompare(b.id),
  );
  const lines = [MOVEMENT_CSV_HEADERS.join(',')];
  for (const m of sorted) lines.push(movementToCsvRow(m));
  atomicWriteCsv(csvPath, `${lines.join('\n')}\n`);
}
