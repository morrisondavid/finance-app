import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { escapeCsvField, atomicWriteCsv } from '../utils/csv-helpers.js';

export const OBLIGATIONS_CSV_FILENAME = 'manual-obligations.csv';

const HEADERS = ['id', 'type', 'name', 'entity', 'recurrence', 'expected_amount', 'due_date', 'status', 'notes', 'person_id'] as const;

export interface ManualObligationCsvRow {
  id: string;
  type: string;
  name: string;
  entity: string;
  recurrence: string;
  expectedAmount: number | null;
  dueDate: string | null;
  status: string;
  notes: string | null;
  /** Person this obligation relates to (Self Assessment rows). Null for entity-level obligations. */
  personId: string | null;
}

export function getObligationsCsvPath(obligationsDir: string): string {
  return path.join(obligationsDir, OBLIGATIONS_CSV_FILENAME);
}

export function readManualObligationsFromCsvFile(csvPath: string): ManualObligationCsvRow[] {
  if (!fs.existsSync(csvPath)) return [];
  const content = fs.readFileSync(csvPath, 'utf8').trim();
  if (content === '') return [];

  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as Record<string, string>[];

  const rows: ManualObligationCsvRow[] = [];
  for (const row of records) {
    const id = row.id;
    const type = row.type;
    const name = row.name;
    const entity = row.entity;
    const recurrence = row.recurrence;
    if (!id || !type || !name || !entity || !recurrence) continue;

    const amtRaw = row.expected_amount;
    const expectedAmount = amtRaw && amtRaw !== '' ? Number(amtRaw) : null;
    if (expectedAmount !== null && !Number.isFinite(expectedAmount)) continue;

    rows.push({
      id,
      type,
      name,
      entity,
      recurrence,
      expectedAmount,
      dueDate: row.due_date || null,
      status: row.status || 'pending',
      notes: row.notes || null,
      personId: row.person_id || null,
    });
  }
  return rows;
}

export function writeManualObligationsToCsvFile(csvPath: string, rows: ManualObligationCsvRow[]): void {
  const sorted = [...rows].sort((a, b) => a.id.localeCompare(b.id));
  const lines = [HEADERS.join(',')];
  for (const r of sorted) {
    lines.push([
      escapeCsvField(r.id),
      escapeCsvField(r.type),
      escapeCsvField(r.name),
      escapeCsvField(r.entity),
      escapeCsvField(r.recurrence),
      r.expectedAmount !== null ? String(r.expectedAmount) : '',
      r.dueDate ?? '',
      r.status,
      escapeCsvField(r.notes ?? ''),
      r.personId ?? '',
    ].join(','));
  }
  atomicWriteCsv(csvPath, `${lines.join('\n')}\n`);
}

export function ensureObligationsCsvWithHeader(csvPath: string): void {
  if (fs.existsSync(csvPath)) return;
  const dir = path.dirname(csvPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(csvPath, `${HEADERS.join(',')}\n`, 'utf8');
}
