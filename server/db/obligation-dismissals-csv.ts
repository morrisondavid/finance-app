import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { escapeCsvField, atomicWriteCsv } from '../utils/csv-helpers.js';

/**
 * File-backed canonical source for obligation dismissals. Mirrors the manual
 * obligations CSV pattern (see {@link ./obligations-csv.ts}): the CSV is the
 * source of truth; SQLite is rebuilt from it at startup and re-synced on
 * every mutation so the on-disk file always reflects the latest state.
 */

export const OBLIGATION_DISMISSALS_CSV_FILENAME = 'obligation-dismissals.csv';

const HEADERS = ['obligation_id', 'reason', 'dismissed_at'] as const;

export interface ObligationDismissalCsvRow {
  obligationId: string;
  reason: string | null;
  dismissedAt: string;
}

export function getObligationDismissalsCsvPath(obligationsDir: string): string {
  return path.join(obligationsDir, OBLIGATION_DISMISSALS_CSV_FILENAME);
}

export function readObligationDismissalsFromCsvFile(csvPath: string): ObligationDismissalCsvRow[] {
  if (!fs.existsSync(csvPath)) return [];
  const content = fs.readFileSync(csvPath, 'utf8').trim();
  if (content === '') return [];

  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as Record<string, string>[];

  const rows: ObligationDismissalCsvRow[] = [];
  for (const row of records) {
    const obligationId = row.obligation_id;
    if (!obligationId) continue;

    rows.push({
      obligationId,
      reason: row.reason && row.reason !== '' ? row.reason : null,
      dismissedAt: row.dismissed_at || new Date().toISOString(),
    });
  }
  return rows;
}

export function writeObligationDismissalsToCsvFile(csvPath: string, rows: ObligationDismissalCsvRow[]): void {
  const sorted = [...rows].sort((a, b) => a.obligationId.localeCompare(b.obligationId));
  const lines = [HEADERS.join(',')];
  for (const r of sorted) {
    lines.push([
      escapeCsvField(r.obligationId),
      escapeCsvField(r.reason ?? ''),
      r.dismissedAt,
    ].join(','));
  }
  atomicWriteCsv(csvPath, `${lines.join('\n')}\n`);
}

export function ensureObligationDismissalsCsvWithHeader(csvPath: string): void {
  if (fs.existsSync(csvPath)) return;
  const dir = path.dirname(csvPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(csvPath, `${HEADERS.join(',')}\n`, 'utf8');
}
