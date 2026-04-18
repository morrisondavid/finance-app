/**
 * Obligation dismissals repository.
 *
 * Lets the user hide a specific auto-seeded obligation row (SA or VAT) by
 * its stable id. The auto-seeders consult {@link isDismissed} before
 * inserting, so dismissed slots simply never appear in
 * `financial_obligations`. Dismissals survive the seeders' DELETE-and-rebuild
 * cycle because they live in their own table.
 *
 * File-backed: every mutation syncs to {@link OBLIGATION_DISMISSALS_CSV_FILENAME}
 * so the canonical source is the CSV on disk. SQLite is rebuilt from the CSV
 * at startup via {@link loadDismissalsFromCsv}.
 */

import { getDb, OBLIGATIONS_DIR } from '../connection.js';
import {
  readObligationDismissalsFromCsvFile,
  writeObligationDismissalsToCsvFile,
  getObligationDismissalsCsvPath,
  ensureObligationDismissalsCsvWithHeader,
  type ObligationDismissalCsvRow,
} from '../obligation-dismissals-csv.js';

export interface DismissalRow {
  obligationId: string;
  reason: string | null;
  dismissedAt: string;
}

interface DismissalDbRow {
  obligation_id: string;
  reason: string | null;
  dismissed_at: string;
}

/**
 * Only auto-seeded rows have stable ids that the seeder will re-derive on
 * every run. Dismissing a manual row makes no sense (the user can just
 * delete it), so we reject non-auto ids at the repo boundary.
 */
const AUTO_ID_PREFIX = 'auto-';

export function isAutoObligationId(id: string): boolean {
  return id.startsWith(AUTO_ID_PREFIX);
}

function csvPath(): string {
  return getObligationDismissalsCsvPath(OBLIGATIONS_DIR);
}

function rowToApi(row: DismissalDbRow): DismissalRow {
  return {
    obligationId: row.obligation_id,
    reason: row.reason,
    dismissedAt: row.dismissed_at,
  };
}

export function loadDismissalsFromCsv(): void {
  const db = getDb();
  const fp = csvPath();
  ensureObligationDismissalsCsvWithHeader(fp);
  const rows = readObligationDismissalsFromCsvFile(fp);

  const insert = db.prepare(`
    INSERT OR REPLACE INTO obligation_dismissals (obligation_id, reason, dismissed_at)
    VALUES (?, ?, ?)
  `);
  for (const r of rows) {
    insert.run(r.obligationId, r.reason, r.dismissedAt);
  }
  if (rows.length > 0) {
    console.log(`[Database] Loaded ${rows.length} obligation dismissal(s) from CSV`);
  }
}

function syncToCsv(): void {
  const db = getDb();
  const rows = db.prepare(
    `SELECT obligation_id, reason, dismissed_at FROM obligation_dismissals ORDER BY obligation_id`
  ).all() as DismissalDbRow[];

  const csvRows: ObligationDismissalCsvRow[] = rows.map(r => ({
    obligationId: r.obligation_id,
    reason: r.reason,
    dismissedAt: r.dismissed_at,
  }));
  writeObligationDismissalsToCsvFile(csvPath(), csvRows);
}

export function isDismissed(obligationId: string): boolean {
  const db = getDb();
  const row = db.prepare(
    `SELECT 1 AS hit FROM obligation_dismissals WHERE obligation_id = ? LIMIT 1`
  ).get(obligationId) as { hit: number } | undefined;
  return row !== undefined;
}

export function listDismissals(): DismissalRow[] {
  const db = getDb();
  const rows = db.prepare(
    `SELECT obligation_id, reason, dismissed_at FROM obligation_dismissals ORDER BY dismissed_at DESC`
  ).all() as DismissalDbRow[];
  return rows.map(rowToApi);
}

export function getDismissal(obligationId: string): DismissalRow | null {
  const db = getDb();
  const row = db.prepare(
    `SELECT obligation_id, reason, dismissed_at FROM obligation_dismissals WHERE obligation_id = ?`
  ).get(obligationId) as DismissalDbRow | undefined;
  return row ? rowToApi(row) : null;
}

/**
 * Error thrown when a caller tries to dismiss a non-auto obligation id.
 * Routes translate this to a 400, keeping the guard logic centralised in
 * the repository rather than spread across every HTTP handler.
 */
export class NonAutoDismissalError extends Error {
  constructor(id: string) {
    super(`Cannot dismiss non-auto obligation id: ${id}`);
    this.name = 'NonAutoDismissalError';
  }
}

export function addDismissal(data: { obligationId: string; reason?: string | null }): DismissalRow {
  if (!isAutoObligationId(data.obligationId)) {
    throw new NonAutoDismissalError(data.obligationId);
  }
  const db = getDb();
  const reason = data.reason ?? null;
  db.prepare(`
    INSERT INTO obligation_dismissals (obligation_id, reason, dismissed_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(obligation_id) DO UPDATE SET
      reason = excluded.reason,
      dismissed_at = CURRENT_TIMESTAMP
  `).run(data.obligationId, reason);
  syncToCsv();
  const saved = getDismissal(data.obligationId);
  if (!saved) {
    throw new Error(`Failed to persist dismissal for ${data.obligationId}`);
  }
  return saved;
}

export function removeDismissal(obligationId: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM obligation_dismissals WHERE obligation_id = ?').run(obligationId);
  if (result.changes === 0) return false;
  syncToCsv();
  return true;
}
