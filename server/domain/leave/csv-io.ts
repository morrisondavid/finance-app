/**
 * CSV I/O for `working-days/leave.csv` — the leave ledger.
 *
 * One row per `(contract_id, date)` pair. Natural id is
 * `{contract_id}-{date}` and is computed at upsert time by callers;
 * the parser preserves whatever id is on disk, since any in-place edit
 * to the CSV outside the app shouldn't lose identity.
 *
 * FK validation (that `contract_id` points at a known contract row) is
 * enforced at registry-build time (see `registry.ts`), not here —
 * parsing stays syntactic so a stand-alone CSV round-trip test doesn't
 * have to spin up the whole cross-registry join.
 */

import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import {
  type LeaveRow,
  LeaveRowSchema,
} from '../../../shared/api-contracts.js';
import { escapeCsvField, atomicWriteCsv } from '../../utils/csv-helpers.js';

export const LEAVE_CSV_FILENAME = 'leave.csv';

export const LEAVE_CSV_HEADERS = [
  'id',
  'contract_id',
  'date',
  'type',
  'notes',
  'external_logged',
  'created_at',
  'updated_at',
] as const;

export function getLeaveCsvPath(workingDaysDir: string): string {
  return path.join(workingDaysDir, LEAVE_CSV_FILENAME);
}

/** Compose the natural id used by the registry's primary key. */
export function composeLeaveId(contractId: string, isoDate: string): string {
  return `${contractId}-${isoDate}`;
}

function nullIfEmpty(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function requireNonEmpty(value: string | undefined, field: string, rowId: string): string {
  const v = nullIfEmpty(value);
  if (v === null) {
    throw new Error(`Leave ${rowId}: ${field} is required`);
  }
  return v;
}

function requireIsoDate(value: string | undefined, field: string, rowId: string): string {
  const raw = requireNonEmpty(value, field, rowId);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new Error(`Leave ${rowId}: ${field} must be yyyy-mm-dd, got '${raw}'`);
  }
  return raw;
}

function decodeStrictBoolean(value: string | undefined, field: string, rowId: string): boolean {
  const raw = requireNonEmpty(value, field, rowId);
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error(`Leave ${rowId}: ${field} must be 'true' | 'false', got '${raw}'`);
}

export function parseLeaveRow(row: Record<string, string>): LeaveRow {
  const rowId = nullIfEmpty(row.id) ?? '<missing-id>';

  return LeaveRowSchema.parse({
    id: requireNonEmpty(row.id, 'id', rowId),
    contract_id: requireNonEmpty(row.contract_id, 'contract_id', rowId),
    date: requireIsoDate(row.date, 'date', rowId),
    type: requireNonEmpty(row.type, 'type', rowId),
    notes: nullIfEmpty(row.notes),
    external_logged: decodeStrictBoolean(row.external_logged, 'external_logged', rowId),
    created_at: requireIsoDate(row.created_at, 'created_at', rowId),
    updated_at: requireIsoDate(row.updated_at, 'updated_at', rowId),
  });
}

export function readLeaveCsvFile(csvPath: string): LeaveRow[] {
  if (!fs.existsSync(csvPath)) return [];
  const content = fs.readFileSync(csvPath, 'utf8').trim();
  if (content === '') return [];

  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as Record<string, string>[];

  const rows: LeaveRow[] = [];
  for (const row of records) {
    if (!nullIfEmpty(row.id)) continue;
    rows.push(parseLeaveRow(row));
  }
  return rows;
}

function encodeOptional(value: string | null): string {
  return value ?? '';
}

function encodeBool(value: boolean): string {
  return value ? 'true' : 'false';
}

export function serializeLeaveRow(row: LeaveRow): string {
  const cells: string[] = LEAVE_CSV_HEADERS.map(header => {
    switch (header) {
      case 'id':
        return row.id;
      case 'contract_id':
        return row.contract_id;
      case 'date':
        return row.date;
      case 'type':
        return row.type;
      case 'notes':
        return encodeOptional(row.notes);
      case 'external_logged':
        return encodeBool(row.external_logged);
      case 'created_at':
        return row.created_at;
      case 'updated_at':
        return row.updated_at;
    }
  });
  return cells.map(escapeCsvField).join(',');
}

export function serializeLeaveCsv(rows: readonly LeaveRow[]): string {
  const header = LEAVE_CSV_HEADERS.join(',');
  const body = rows.map(serializeLeaveRow).join('\n');
  return body === '' ? `${header}\n` : `${header}\n${body}\n`;
}

export function writeLeaveCsvFile(csvPath: string, rows: readonly LeaveRow[]): void {
  atomicWriteCsv(csvPath, serializeLeaveCsv(rows));
}
