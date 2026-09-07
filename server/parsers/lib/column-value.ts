import type { CSVRow } from '../../types.js';

/**
 * Look up a CSV cell by header name. Exact match first, then
 * case-insensitive. Extra names are aliases tried in order.
 */
export function getColumnValue(row: CSVRow, ...columnNames: string[]): string {
  for (const columnName of columnNames) {
    if (columnName in row) return row[columnName];
    const lowerCol = columnName.toLowerCase();
    const key = Object.keys(row).find(k => k.toLowerCase() === lowerCol);
    if (key) return row[key];
  }
  return '';
}

/** Barclaycard portal exports used `Amount`; newer ones use `Transaction Amount`. */
export const AMOUNT_HEADER_ALIASES = ['Amount', 'Transaction Amount'] as const;
