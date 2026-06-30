/**
 * CSV I/O for `properties/properties.csv` — single source of truth for
 * physical properties (§1.7).
 *
 * Tiny: one CSV, one row parser, one file reader. No write path —
 * properties are edited by hand for now (low churn).
 */

import path from 'path';
import { PropertySchema, PropertyStatusSchema, type Property } from './schema.js';
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
  'status',
  'sold_at',
  'acquisition_date',
  'acquisition_cost',
  'april_2015_value',
  'estimated_market_value',
  'enhancement_costs',
  'selling_costs',
  'updated_at',
] as const;

export function getPropertiesCsvPath(propertiesDir: string): string {
  return path.join(propertiesDir, PROPERTIES_CSV_FILENAME);
}

export function parsePropertyRow(row: Record<string, string>): Property {
  const rowId = nullIfEmpty(row.id) ?? '<missing-id>';
  const statusRaw = nullIfEmpty(row.status);
  const soldAtRaw = nullIfEmpty(row.sold_at);
  const acquisitionDateRaw = nullIfEmpty(row.acquisition_date);
  const acquisitionCostRaw = nullIfEmpty(row.acquisition_cost);
  const april2015Raw = nullIfEmpty(row.april_2015_value);
  const marketValueRaw = nullIfEmpty(row.estimated_market_value);
  const enhancementRaw = nullIfEmpty(row.enhancement_costs);
  const sellingCostsRaw = nullIfEmpty(row.selling_costs);
  return PropertySchema.parse({
    id: requireNonEmpty(row.id, 'id', rowId),
    address: requireNonEmpty(row.address, 'address', rowId),
    ownership_david: decodeNumber(row.ownership_david, 'ownership_david', rowId),
    ownership_heena: decodeNumber(row.ownership_heena, 'ownership_heena', rowId),
    notes: nullIfEmpty(row.notes),
    status: statusRaw === null ? 'owned' : PropertyStatusSchema.parse(statusRaw),
    sold_at: soldAtRaw === null ? null : decodeIsoDate(row.sold_at, 'sold_at', rowId),
    acquisition_date:
      acquisitionDateRaw === null ? null : decodeIsoDate(row.acquisition_date, 'acquisition_date', rowId),
    acquisition_cost:
      acquisitionCostRaw === null ? null : decodeNumber(row.acquisition_cost, 'acquisition_cost', rowId),
    april_2015_value:
      april2015Raw === null ? null : decodeNumber(row.april_2015_value, 'april_2015_value', rowId),
    estimated_market_value:
      marketValueRaw === null ? null : decodeNumber(row.estimated_market_value, 'estimated_market_value', rowId),
    enhancement_costs:
      enhancementRaw === null ? 0 : decodeNumber(row.enhancement_costs, 'enhancement_costs', rowId),
    selling_costs:
      sellingCostsRaw === null ? 0 : decodeNumber(row.selling_costs, 'selling_costs', rowId),
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
