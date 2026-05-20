/**
 * Portable source of truth for `warning_user_state` (snooze / ack by fingerprint).
 */

import fs from 'fs';
import path from 'path';
import type Database from 'better-sqlite3';
import { REPO_ROOT } from '../repo-root.js';
import { escapeCsvField } from '../utils/csv-helpers.js';
import { createCsvDecoders, readCsvRecords } from '../utils/csv-decoders.js';

const decoders = createCsvDecoders('WarningUserStateCsv');
const { requireNonEmpty } = decoders;

export const WARNING_USER_STATE_CSV_RELATIVE = 'data/warning-user-state.csv' as const;

export function getWarningUserStateCsvPath(): string {
  return path.join(REPO_ROOT, 'data', 'warning-user-state.csv');
}

const HEADERS = ['fingerprint', 'snoozed_until', 'acknowledged_at', 'surface'] as const;

interface CsvRow {
  readonly fingerprint: string;
  readonly snoozedUntil: string | null;
  readonly acknowledgedAt: string | null;
  readonly surface: string | null;
}

function csvCell(raw: Record<string, unknown>, key: string): string | undefined {
  const v = raw[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return undefined;
}

function parseSurface(raw: string | undefined): string | null {
  if (raw === undefined || raw.trim() === '') return null;
  const t = raw.trim();
  if (t === 'dashboard' || t === 'agent' || t === 'both') return t;
  return null;
}

function parseRow(raw: Record<string, string>): CsvRow {
  const fp = csvCell(raw as Record<string, unknown>, 'fingerprint');
  const fingerprint = String(requireNonEmpty(fp, 'fingerprint', '?'));

  const su = csvCell(raw as Record<string, unknown>, 'snoozed_until');
  const snoozedUntil = su !== undefined && su.trim() !== '' ? su.trim() : null;

  const aa = csvCell(raw as Record<string, unknown>, 'acknowledged_at');
  const acknowledgedAt = aa !== undefined && aa.trim() !== '' ? aa.trim() : null;

  const surface = parseSurface(csvCell(raw as Record<string, unknown>, 'surface'));

  return { fingerprint, snoozedUntil, acknowledgedAt, surface };
}

/**
 * Replace SQLite warning_user_state from CSV (when file exists).
 * Call early in `initDatabase` so prod matches S3 after host sync.
 */
export function loadWarningUserStateFromCsvIntoDb(db: Database.Database): void {
  const csvPath = getWarningUserStateCsvPath();
  if (!fs.existsSync(csvPath)) {
    return;
  }
  const rawRows = readCsvRecords(csvPath);
  const rows = rawRows.map(parseRow);

  db.prepare(`DELETE FROM warning_user_state`).run();
  const ins = db.prepare(`
    INSERT INTO warning_user_state (fingerprint, snoozed_until, acknowledged_at, surface, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `);
  for (const r of rows) {
    ins.run(r.fingerprint, r.snoozedUntil, r.acknowledgedAt, r.surface);
  }

  console.log(`[Database] Loaded ${String(rows.length)} warning user-state row(s) from CSV`);
}

export function exportWarningUserStateFromDbToCsv(db: Database.Database): void {
  const rows = db
    .prepare(
      `SELECT fingerprint, snoozed_until AS snoozedUntil, acknowledged_at AS acknowledgedAt, surface
       FROM warning_user_state ORDER BY fingerprint`,
    )
    .all() as Array<{
      fingerprint: string;
      snoozedUntil: string | null;
      acknowledgedAt: string | null;
      surface: string | null;
    }>;

  const csvPath = getWarningUserStateCsvPath();
  const dir = path.dirname(csvPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const lines: string[] = [[...HEADERS].join(',')];
  for (const r of rows) {
    lines.push(
      [
        escapeCsvField(r.fingerprint),
        escapeCsvField(r.snoozedUntil ?? ''),
        escapeCsvField(r.acknowledgedAt ?? ''),
        escapeCsvField(r.surface ?? ''),
      ].join(','),
    );
  }
  const tmp = `${csvPath}.tmp`;
  fs.writeFileSync(tmp, `${lines.join('\n')}\n`, 'utf-8');
  fs.renameSync(tmp, csvPath);
}
