/**
 * CSV I/O for `reserves/reserves.csv` — the obligation→reserve
 * mapping (§1.8). Tiny: one CSV, one row parser, one file reader. No
 * write path — reserves are edited by hand for now.
 */

import path from 'path';
import { ReserveSchema, type Reserve } from './schema.js';
import {
  createCsvDecoders,
  nullIfEmpty,
  readCsvRecords,
} from '../../utils/csv-decoders.js';

const decoders = createCsvDecoders('Reserve');
const { requireNonEmpty, decodeIsoDate } = decoders;

export const RESERVES_CSV_FILENAME = 'reserves.csv';

export const RESERVE_CSV_HEADERS = [
  'obligation_type',
  'entity_id',
  'reserve_account',
  'notes',
  'updated_at',
] as const;

export function getReservesCsvPath(reservesDir: string): string {
  return path.join(reservesDir, RESERVES_CSV_FILENAME);
}

export function parseReserveRow(row: Record<string, string>): Reserve {
  const rowId = `${nullIfEmpty(row.obligation_type) ?? '?'}::${nullIfEmpty(row.entity_id) ?? '?'}`;
  return ReserveSchema.parse({
    obligation_type: requireNonEmpty(row.obligation_type, 'obligation_type', rowId),
    entity_id: requireNonEmpty(row.entity_id, 'entity_id', rowId),
    reserve_account: requireNonEmpty(row.reserve_account, 'reserve_account', rowId),
    notes: nullIfEmpty(row.notes),
    updated_at: decodeIsoDate(row.updated_at, 'updated_at', rowId),
  });
}

export function readReservesCsvFile(csvPath: string): Reserve[] {
  const rows: Reserve[] = [];
  for (const row of readCsvRecords(csvPath)) {
    if (!nullIfEmpty(row.obligation_type)) continue;
    rows.push(parseReserveRow(row));
  }
  return rows;
}
