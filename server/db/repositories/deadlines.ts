/**
 * Deadlines repository: non-financial reminders with due dates.
 *
 * Canonical source of truth lives in `deadlines/deadlines.csv`; the
 * SQLite `deadlines` table is a read-projection rebuilt on startup by
 * {@link loadDeadlinesFromCsv} and re-exported to CSV on every
 * mutation. Mirrors the shape of the debts repository — anyone who
 * knows one should recognise the other immediately.
 *
 * Complete semantics are deliberately simpler than
 * obligation-state.csv: a single nullable `completedDate` column with
 * a tiny pair of routes (`POST /complete`, `DELETE /complete`). Auto
 * seeders (currently: contract-renewal) write via {@link upsertDeadline},
 * which never clobbers a user-set `completedDate`, so we still don't
 * need the `source=user`/`source=auto` split that
 * `obligation-state.csv` uses.
 */

import crypto from 'crypto';
import { getDb, DEADLINES_DIR } from '../connection.js';
import type {
  Deadline,
  DeadlineType,
  DeadlineRecurrence,
} from '../../../shared/api-contracts.js';
import {
  readDeadlinesFromCsvFile,
  writeDeadlinesToCsvFile,
  getDeadlinesCsvPath,
} from '../../domain/deadlines/deadlines-csv.js';
import { todayIsoLocal } from '../../../shared/iso-date.js';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

export interface DeadlineCreateInput {
  id?: string;
  type: DeadlineType;
  title: string;
  dueDate: string;
  recurrence: DeadlineRecurrence;
  notes?: string | null;
  url?: string | null;
  completedDate?: string | null;
}

export interface DeadlineUpdateInput {
  type?: DeadlineType;
  title?: string;
  dueDate?: string;
  recurrence?: DeadlineRecurrence;
  notes?: string | null;
  url?: string | null;
  completedDate?: string | null;
}

interface DeadlineRowShape {
  id: string;
  type: string;
  title: string;
  due_date: string;
  recurrence: string;
  notes: string | null;
  url: string | null;
  completed_date: string | null;
  updated_at: string;
}

const DEADLINE_COLUMNS =
  'id, type, title, due_date, recurrence, notes, url, completed_date, updated_at';

const DEADLINE_INSERT_PLACEHOLDERS = `?, ?, ?, ?, ?, ?, ?, ?, ?`;

function csvPath(): string {
  return getDeadlinesCsvPath(DEADLINES_DIR);
}

function rowToDeadline(row: DeadlineRowShape): Deadline {
  return {
    id: row.id,
    type: row.type as DeadlineType,
    title: row.title,
    dueDate: row.due_date,
    recurrence: row.recurrence as DeadlineRecurrence,
    notes: row.notes,
    url: row.url,
    completedDate: row.completed_date,
    updatedAt: row.updated_at,
  };
}

function assertValidDeadlineInput(
  input: DeadlineCreateInput | (DeadlineUpdateInput & { id?: string }),
): void {
  if ('id' in input && input.id !== undefined) {
    if (typeof input.id !== 'string' || input.id.trim() === '') {
      throw new Error('Deadline id must be a non-empty string');
    }
    if (!ID_SLUG_RE.test(input.id)) {
      throw new Error('Deadline id must be a lowercase slug (a-z, 0-9, hyphens)');
    }
  }
  if (input.title !== undefined && input.title.trim() === '') {
    throw new Error('Deadline title must be non-empty');
  }
  if (input.dueDate !== undefined && !ISO_DATE_RE.test(input.dueDate)) {
    throw new Error('Deadline dueDate must be YYYY-MM-DD');
  }
  if (
    input.completedDate !== undefined &&
    input.completedDate !== null &&
    !ISO_DATE_RE.test(input.completedDate)
  ) {
    throw new Error('Deadline completedDate must be YYYY-MM-DD or null');
  }
}

/**
 * Rebuild the `deadlines` SQLite table from the CSV on disk. Intended
 * for startup + after bulk imports. The CSV is the source of truth;
 * the DB is a fast-query projection.
 */
export function loadDeadlinesFromCsv(): void {
  const db = getDb();
  const rows = readDeadlinesFromCsvFile(csvPath());

  db.prepare('DELETE FROM deadlines').run();
  const insert = db.prepare(
    `INSERT INTO deadlines (${DEADLINE_COLUMNS}) VALUES (${DEADLINE_INSERT_PLACEHOLDERS})`,
  );
  const run = db.transaction((list: readonly Deadline[]) => {
    for (const r of list) {
      insert.run(
        r.id,
        r.type,
        r.title,
        r.dueDate,
        r.recurrence,
        r.notes,
        r.url,
        r.completedDate,
        r.updatedAt,
      );
    }
  });
  run(rows);

  console.log(`[Database] Loaded ${rows.length} deadline row(s) from CSV`);
}

/** Snapshot the current DB projection back to CSV (atomic rewrite). */
export function exportDeadlinesFromDbToFile(): void {
  const db = getDb();
  const rows = db
    .prepare(`SELECT ${DEADLINE_COLUMNS} FROM deadlines ORDER BY id`)
    .all() as DeadlineRowShape[];
  writeDeadlinesToCsvFile(csvPath(), rows.map(rowToDeadline));
}

export function getAllDeadlines(): Deadline[] {
  const db = getDb();
  const rows = db
    .prepare(`SELECT ${DEADLINE_COLUMNS} FROM deadlines ORDER BY due_date ASC, id ASC`)
    .all() as DeadlineRowShape[];
  return rows.map(rowToDeadline);
}

export function getDeadline(id: string): Deadline | null {
  const db = getDb();
  const row = db
    .prepare(`SELECT ${DEADLINE_COLUMNS} FROM deadlines WHERE id = ?`)
    .get(id) as DeadlineRowShape | undefined;
  return row ? rowToDeadline(row) : null;
}

/**
 * Generate a new deadline id. Format: `dl-<8 hex chars>` — short enough
 * to be readable in URLs, stable across runs (caller can pass an
 * explicit id when seeding to avoid randomness in tests).
 */
function generateDeadlineId(): string {
  return `dl-${crypto.randomBytes(4).toString('hex')}`;
}

export function createDeadline(input: DeadlineCreateInput): Deadline {
  assertValidDeadlineInput(input);
  const db = getDb();

  const id = input.id ?? generateDeadlineId();
  const existing = db.prepare('SELECT 1 FROM deadlines WHERE id = ?').get(id);
  if (existing) {
    throw new Error(`Deadline with id "${id}" already exists`);
  }

  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO deadlines (${DEADLINE_COLUMNS}) VALUES (${DEADLINE_INSERT_PLACEHOLDERS})`,
  ).run(
    id,
    input.type,
    input.title.trim(),
    input.dueDate,
    input.recurrence,
    input.notes ?? null,
    input.url ?? null,
    input.completedDate ?? null,
    now,
  );

  const row = getDeadline(id);
  if (!row) throw new Error('Failed to create deadline');
  exportDeadlinesFromDbToFile();
  return row;
}

/**
 * Insert-or-update a deadline by explicit id. Intended for auto-seeders
 * that can be rerun idempotently (e.g. the contract-renewal seeder) —
 * the caller owns the id and computes every row from the upstream
 * source of truth each time.
 *
 * Completion state is user-owned: if the caller-computed row has been
 * marked done (`completedDate !== null` in storage) we DO NOT overwrite
 * it on subsequent seeds. The seeder's job is to make sure a deadline
 * exists with the current due date; the user's job is to mark it done
 * once they've actioned it. Subsequent seeds of the same id after
 * completion are no-ops.
 */
export function upsertDeadline(
  input: DeadlineCreateInput & { id: string },
): Deadline {
  assertValidDeadlineInput(input);
  const existing = getDeadline(input.id);
  if (existing === null) {
    return createDeadline(input);
  }
  if (existing.completedDate !== null) return existing;

  return updateDeadline(input.id, {
    type: input.type,
    title: input.title,
    dueDate: input.dueDate,
    recurrence: input.recurrence,
    notes: input.notes !== undefined ? input.notes : existing.notes,
    url: input.url !== undefined ? input.url : existing.url,
  });
}

export function updateDeadline(id: string, patch: DeadlineUpdateInput): Deadline {
  const existing = getDeadline(id);
  if (!existing) {
    throw new Error(`Deadline with id "${id}" not found`);
  }
  assertValidDeadlineInput(patch);

  const next: Deadline = {
    ...existing,
    type: patch.type ?? existing.type,
    title: patch.title !== undefined ? patch.title.trim() : existing.title,
    dueDate: patch.dueDate ?? existing.dueDate,
    recurrence: patch.recurrence ?? existing.recurrence,
    notes: patch.notes !== undefined ? patch.notes : existing.notes,
    url: patch.url !== undefined ? patch.url : existing.url,
    completedDate: patch.completedDate !== undefined ? patch.completedDate : existing.completedDate,
    updatedAt: new Date().toISOString(),
  };

  const db = getDb();
  db.prepare(
    `UPDATE deadlines SET
      type = ?, title = ?, due_date = ?, recurrence = ?,
      notes = ?, url = ?, completed_date = ?, updated_at = ?
    WHERE id = ?`,
  ).run(
    next.type,
    next.title,
    next.dueDate,
    next.recurrence,
    next.notes,
    next.url,
    next.completedDate,
    next.updatedAt,
    id,
  );

  const row = getDeadline(id);
  if (!row) throw new Error('Failed to update deadline');
  exportDeadlinesFromDbToFile();
  return row;
}

export function deleteDeadline(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM deadlines WHERE id = ?').run(id);
  if (result.changes === 0) return false;
  exportDeadlinesFromDbToFile();
  return true;
}

/**
 * Mark a deadline done. `completedDate` defaults to today's local
 * calendar day so the common case (click the Done button, accept the
 * default) round-trips correctly. Returns the updated deadline, or
 * `null` when the id doesn't exist.
 */
export function markDeadlineDone(id: string, completedDate?: string): Deadline | null {
  const existing = getDeadline(id);
  if (!existing) return null;
  const date = completedDate ?? todayIsoLocal();
  return updateDeadline(id, { completedDate: date });
}

/** Clear the `completedDate` on a deadline, flipping it back to open. */
export function unmarkDeadlineDone(id: string): Deadline | null {
  const existing = getDeadline(id);
  if (!existing) return null;
  if (existing.completedDate === null) return existing;
  return updateDeadline(id, { completedDate: null });
}
