/**
 * CSV I/O for `properties/properties.csv` — single source of truth for
 * physical properties (§1.7).
 *
 * Tiny: one CSV, one row parser, one file reader. No write path —
 * properties are edited by hand for now (low churn).
 */

import path from 'path';
import { PropertySchema, type Property } from './schema.js';
import {
  createCsvDecoders,
  nullIfEmpty,
  readCsvRecords,
} from '../../utils/csv-decoders.js';

const decoders = createCsvDecoders('Property');
const { requireNonEmpty, decodeNumber, decodeIsoDate } = decoders;

export const PROPERTIES_CSV_FILENAME = 'properties.csv';

export const PROPERTY_CSV_HEADERS = [
  'id',
  'address',
  'ownership_david',
  'ownership_heena',
  'notes',
  'updated_at',
] as const;

export function getPropertiesCsvPath(propertiesDir: string): string {
  return path.join(propertiesDir, PROPERTIES_CSV_FILENAME);
}

export function parsePropertyRow(row: Record<string, string>): Property {
  const rowId = nullIfEmpty(row.id) ?? '<missing-id>';
  return PropertySchema.parse({
    id: requireNonEmpty(row.id, 'id', rowId),
    address: requireNonEmpty(row.address, 'address', rowId),
    ownership_david: decodeNumber(row.ownership_david, 'ownership_david', rowId),
    ownership_heena: decodeNumber(row.ownership_heena, 'ownership_heena', rowId),
    notes: nullIfEmpty(row.notes),
    updated_at: decodeIsoDate(row.updated_at, 'updated_at', rowId),
  });
}

export function readPropertiesCsvFile(csvPath: string): Property[] {
  const rows: Property[] = [];
  for (const row of readCsvRecords(csvPath)) {
    if (!nullIfEmpty(row.id)) continue;
    rows.push(parsePropertyRow(row));
  }
  return rows;
}
