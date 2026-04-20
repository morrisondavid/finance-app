/**
 * Per-obligation mutable state store.
 *
 * Declarations live in `obligations/obligations.csv` (pure config).
 * The obligation *instance* state — whether it's been paid, the payment
 * amount/date/account — lives here, keyed by obligation id. Splitting the
 * two concerns keeps the declaration file readable and git-trackable while
 * giving the Obligations API a durable place to record payments.
 *
 * File: `obligations/obligation-state.csv`. Absent on fresh checkouts —
 * the loader treats a missing file as "no overrides".
 */

import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { escapeCsvField, atomicWriteCsv } from '../../utils/csv-helpers.js';

export const OBLIGATION_STATE_FILENAME = 'obligation-state.csv';

const STATE_HEADERS = [
  'id', 'status', 'paid_amount', 'paid_date', 'paid_from_account',
] as const;

export interface ObligationStateRow {
  id: string;
  status: string;
  paidAmount: number | null;
  paidDate: string | null;
  paidFromAccount: string | null;
}

export function getObligationStateCsvPath(obligationsDir: string): string {
  return path.join(obligationsDir, OBLIGATION_STATE_FILENAME);
}

export function readObligationStateFromFile(csvPath: string): Map<string, ObligationStateRow> {
  const map = new Map<string, ObligationStateRow>();
  if (!fs.existsSync(csvPath)) return map;
  const content = fs.readFileSync(csvPath, 'utf8').trim();
  if (content === '') return map;

  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as Record<string, string>[];

  for (const row of records) {
    const id = row.id?.trim();
    if (!id) continue;
    const paidAmountRaw = row.paid_amount?.trim();
    const paidAmount = paidAmountRaw && paidAmountRaw !== '' ? Number(paidAmountRaw) : null;
    if (paidAmount !== null && !Number.isFinite(paidAmount)) continue;
    map.set(id, {
      id,
      status: row.status?.trim() || 'pending',
      paidAmount,
      paidDate: row.paid_date?.trim() || null,
      paidFromAccount: row.paid_from_account?.trim() || null,
    });
  }
  return map;
}

export function writeObligationStateToFile(
  csvPath: string,
  rows: readonly ObligationStateRow[],
): void {
  const sorted = [...rows].sort((a, b) => a.id.localeCompare(b.id));
  const lines = [STATE_HEADERS.join(',')];
  for (const r of sorted) {
    lines.push([
      escapeCsvField(r.id),
      escapeCsvField(r.status),
      r.paidAmount !== null ? String(r.paidAmount) : '',
      r.paidDate ?? '',
      escapeCsvField(r.paidFromAccount ?? ''),
    ].join(','));
  }
  atomicWriteCsv(csvPath, `${lines.join('\n')}\n`);
}

export function upsertObligationState(
  csvPath: string,
  row: ObligationStateRow,
): void {
  const current = readObligationStateFromFile(csvPath);
  current.set(row.id, row);
  writeObligationStateToFile(csvPath, [...current.values()]);
}

export function deleteObligationState(csvPath: string, id: string): void {
  const current = readObligationStateFromFile(csvPath);
  if (!current.has(id)) return;
  current.delete(id);
  writeObligationStateToFile(csvPath, [...current.values()]);
}
