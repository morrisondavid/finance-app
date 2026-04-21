/**
 * CSV I/O for deadlines.
 *
 * Canonical source of truth for non-financial reminders. The SQLite
 * `deadlines` table is a read-projection rebuilt from this CSV on
 * startup; mutating APIs always rewrite this file atomically (temp
 * file + rename). Mirrors the debts-csv module in shape, so a reader
 * familiar with one will recognise the other immediately.
 *
 * Schema is a single flat CSV that matches {@link Deadline} one-for-one.
 * Nullable fields are serialised as empty columns, which round-trips
 * back to `null` via `nonEmpty()`.
 */

import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import type { Deadline, DeadlineType, DeadlineRecurrence } from '../../../shared/api-contracts.js';
import { DeadlineSchema } from '../../../shared/api-contracts.js';
import { atomicWriteCsv, escapeCsvField } from '../../utils/csv-helpers.js';

export const DEADLINES_CSV_FILENAME = 'deadlines.csv';

export const DEADLINE_CSV_HEADERS = [
  'id',
  'type',
  'title',
  'due_date',
  'recurrence',
  'notes',
  'url',
  'completed_date',
  'updated_at',
] as const;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const VALID_TYPES = new Set<DeadlineType>([
  'companies-house',
  'mot',
  'passport',
  'driving-license',
  'insurance-cert',
  'tax-filing',
  'other',
]);

const VALID_RECURRENCES = new Set<DeadlineRecurrence>([
  'one-off',
  'annual',
  'every-5-years',
  'every-10-years',
]);

export function getDeadlinesCsvPath(deadlinesDir: string): string {
  return path.join(deadlinesDir, DEADLINES_CSV_FILENAME);
}

function nonEmpty(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Read and parse the deadlines CSV. Missing file returns `[]`. Invalid
 * rows are skipped (with a console warning) rather than aborting the
 * load — matches the behaviour of `readDebtsFromCsvFile` so one bad
 * row doesn't take the entire projection offline.
 *
 * Duplicate ids: last row wins (matches budgets-csv + debts-csv).
 */
export function readDeadlinesFromCsvFile(csvPath: string): Deadline[] {
  if (!fs.existsSync(csvPath)) return [];
  const content = fs.readFileSync(csvPath, 'utf8').trim();
  if (content === '') return [];

  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as Record<string, string>[];

  const merged = new Map<string, Deadline>();

  for (const row of records) {
    const id = (row.id ?? '').trim();
    const typeRaw = (row.type ?? '').trim();
    const title = (row.title ?? '').trim();
    const dueDate = (row.due_date ?? '').trim();
    const recurrenceRaw = (row.recurrence ?? '').trim();
    const notes = nonEmpty(row.notes);
    const url = nonEmpty(row.url);
    const completedDateRaw = nonEmpty(row.completed_date);
    const updatedAtRaw = nonEmpty(row.updated_at);

    if (!id) {
      console.warn(`[deadlines-csv] Dropping row with missing id: ${JSON.stringify(row)}`);
      continue;
    }
    if (!title) {
      console.warn(`[deadlines-csv] Dropping row ${id} with missing title`);
      continue;
    }
    if (!ISO_DATE_RE.test(dueDate)) {
      console.warn(`[deadlines-csv] Dropping row ${id} with invalid due_date: "${dueDate}"`);
      continue;
    }
    if (!VALID_TYPES.has(typeRaw as DeadlineType)) {
      console.warn(`[deadlines-csv] Dropping row ${id} with invalid type: "${typeRaw}"`);
      continue;
    }
    if (!VALID_RECURRENCES.has(recurrenceRaw as DeadlineRecurrence)) {
      console.warn(`[deadlines-csv] Dropping row ${id} with invalid recurrence: "${recurrenceRaw}"`);
      continue;
    }

    let completedDate: string | null = null;
    if (completedDateRaw !== null) {
      if (!ISO_DATE_RE.test(completedDateRaw)) {
        console.warn(`[deadlines-csv] Row ${id} had invalid completed_date "${completedDateRaw}"; storing as null`);
      } else {
        completedDate = completedDateRaw;
      }
    }

    const updatedAt = updatedAtRaw ?? new Date().toISOString();

    const candidate: Deadline = {
      id,
      type: typeRaw as DeadlineType,
      title,
      dueDate,
      recurrence: recurrenceRaw as DeadlineRecurrence,
      notes,
      url,
      completedDate,
      updatedAt,
    };

    // Run through Zod as the final trust gate — any field that slipped
    // past the per-column checks (e.g. invalid id slug shape) fails
    // here with a precise path.
    const parsed = DeadlineSchema.safeParse(candidate);
    if (!parsed.success) {
      console.warn(`[deadlines-csv] Dropping row ${id}: ${parsed.error.message}`);
      continue;
    }

    merged.set(id, parsed.data);
  }

  return Array.from(merged.values());
}

/**
 * Write deadlines to CSV atomically (temp file + rename). Rows are
 * sorted by id for stable, review-friendly diffs.
 */
export function writeDeadlinesToCsvFile(csvPath: string, rows: readonly Deadline[]): void {
  const sorted = [...rows].sort((a, b) => a.id.localeCompare(b.id));

  const lines = [DEADLINE_CSV_HEADERS.join(',')];
  for (const r of sorted) {
    lines.push(
      [
        escapeCsvField(r.id),
        escapeCsvField(r.type),
        escapeCsvField(r.title),
        r.dueDate,
        r.recurrence,
        escapeCsvField(r.notes ?? ''),
        escapeCsvField(r.url ?? ''),
        r.completedDate ?? '',
        escapeCsvField(r.updatedAt),
      ].join(','),
    );
  }
  const body = `${lines.join('\n')}\n`;
  atomicWriteCsv(csvPath, body);
}
