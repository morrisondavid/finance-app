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
 *
 * Rows carry a `source` column to distinguish user-authored overrides
 * ("I paid this, stop flagging it overdue") from auto-matcher writes
 * ("I found the renewal debit in transactions, flipped to paid"). The
 * distinction matters because the auto-matcher rebuilds its own rows on
 * every run while leaving user rows strictly alone — without the
 * provenance marker there is no way to implement "user always wins"
 * cleanly. Legacy files without the column default every row to `user`
 * so existing hand-edited entries are preserved.
 */

import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { escapeCsvField, atomicWriteCsv } from '../../utils/csv-helpers.js';

export const OBLIGATION_STATE_FILENAME = 'obligation-state.csv';

const STATE_HEADERS = [
  'id', 'status', 'paid_amount', 'paid_date', 'paid_from_account', 'source',
] as const;

/**
 * Provenance of a state row. `user` rows come from the Mark Paid UI or a
 * manual CSV edit; `auto` rows come from the obligation-state-matcher.
 * The auto-matcher wipes and rebuilds its own rows on every run and
 * never touches `user` rows, so user edits always win.
 */
export type ObligationStateSource = 'user' | 'auto';

const VALID_SOURCES: ReadonlySet<ObligationStateSource> = new Set(['user', 'auto']);

export interface ObligationStateRow {
  id: string;
  status: string;
  paidAmount: number | null;
  paidDate: string | null;
  paidFromAccount: string | null;
  /** Provenance of this row. See {@link ObligationStateSource}. */
  source: ObligationStateSource;
}

export function getObligationStateCsvPath(obligationsDir: string): string {
  return path.join(obligationsDir, OBLIGATION_STATE_FILENAME);
}

/**
 * Coerce the raw `source` cell into the typed union. Missing / blank /
 * unrecognised values fall back to `user` — the conservative choice
 * because legacy rows were hand-authored and the auto-matcher is the
 * only writer that ever emits `auto`.
 */
function parseSource(raw: string | undefined): ObligationStateSource {
  const trimmed = raw?.trim();
  if (trimmed && VALID_SOURCES.has(trimmed as ObligationStateSource)) {
    return trimmed as ObligationStateSource;
  }
  return 'user';
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
      source: parseSource(row.source),
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
      r.source,
    ].join(','));
  }
  atomicWriteCsv(csvPath, `${lines.join('\n')}\n`);
}

/**
 * Merge the supplied rows into the existing CSV by id (last write wins)
 * and persist with a single read + single write. Preferred over calling
 * {@link upsertObligationState} in a loop — that path rereads and
 * rewrites the whole file per row, which is O(n²) on the file size.
 */
export function upsertObligationStateMany(
  csvPath: string,
  rows: readonly ObligationStateRow[],
): void {
  if (rows.length === 0) return;
  const current = readObligationStateFromFile(csvPath);
  for (const row of rows) current.set(row.id, row);
  writeObligationStateToFile(csvPath, [...current.values()]);
}

export function upsertObligationState(
  csvPath: string,
  row: ObligationStateRow,
): void {
  upsertObligationStateMany(csvPath, [row]);
}

export function deleteObligationState(csvPath: string, id: string): void {
  const current = readObligationStateFromFile(csvPath);
  if (!current.has(id)) return;
  current.delete(id);
  writeObligationStateToFile(csvPath, [...current.values()]);
}
