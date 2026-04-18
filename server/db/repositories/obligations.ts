import crypto from 'crypto';
import { getDb } from '../connection.js';
import {
  readManualObligationsFromCsvFile,
  writeManualObligationsToCsvFile,
  getObligationsCsvPath,
  ensureObligationsCsvWithHeader,
  type ManualObligationCsvRow,
} from '../obligations-csv.js';
import { OBLIGATIONS_DIR } from '../connection.js';
import { buildFyWhereClauseForColumn } from '../utils/financial-year.js';

/**
 * Statuses that indicate an obligation has been resolved and doesn't need further action.
 * Used consistently across overdue, upcoming, and "hide completed" queries so behaviour
 * never drifts between endpoints.
 */
export const COMPLETED_STATUSES = ['paid', 'confirmed'] as const;

const COMPLETED_PLACEHOLDERS = COMPLETED_STATUSES.map(() => '?').join(',');

interface ObligationRow {
  id: string;
  source: string;
  type: string;
  name: string;
  entity: string;
  recurrence: string;
  expected_amount: number | null;
  due_date: string | null;
  status: string;
  paid_amount: number | null;
  paid_date: string | null;
  paid_from_account: string | null;
  notes: string | null;
  person_id: string | null;
  created_at: string | null;
  updated_at: string | null;
}

function csvPath(): string {
  return getObligationsCsvPath(OBLIGATIONS_DIR);
}

export function loadManualObligationsFromCsv(): void {
  const db = getDb();
  const fp = csvPath();
  ensureObligationsCsvWithHeader(fp);
  const rows = readManualObligationsFromCsvFile(fp);

  const insert = db.prepare(`
    INSERT OR REPLACE INTO financial_obligations
      (id, source, type, name, entity, recurrence, expected_amount, due_date, status, notes, person_id, created_at, updated_at)
    VALUES (?, 'manual', ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `);

  for (const r of rows) {
    insert.run(r.id, r.type, r.name, r.entity, r.recurrence, r.expectedAmount, r.dueDate, r.status, r.notes, r.personId);
  }
  if (rows.length > 0) {
    console.log(`[Database] Loaded ${rows.length} manual obligation(s) from CSV`);
  }
}

export function insertAutoObligation(obligation: {
  id: string;
  type: string;
  name: string;
  entity: string;
  recurrence: string;
  expectedAmount: number | null;
  dueDate: string | null;
  status: string;
  paidAmount: number | null;
  paidDate: string | null;
  paidFromAccount: string | null;
  notes: string | null;
  personId?: string | null;
}): void {
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO financial_obligations
      (id, source, type, name, entity, recurrence, expected_amount, due_date, status,
       paid_amount, paid_date, paid_from_account, notes, person_id, created_at, updated_at)
    VALUES (?, 'auto', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run(
    obligation.id, obligation.type, obligation.name, obligation.entity,
    obligation.recurrence, obligation.expectedAmount, obligation.dueDate,
    obligation.status, obligation.paidAmount, obligation.paidDate,
    obligation.paidFromAccount, obligation.notes, obligation.personId ?? null,
  );
}

export interface ObligationFilters {
  status?: string;
  type?: string;
  source?: string;
  hideCompleted?: boolean;
  financialYear?: string;
}

export function getAllObligations(filters?: ObligationFilters): ObligationRow[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters?.status) { conditions.push('status = ?'); params.push(filters.status); }
  if (filters?.type) { conditions.push('type = ?'); params.push(filters.type); }
  if (filters?.source) { conditions.push('source = ?'); params.push(filters.source); }
  if (filters?.hideCompleted) {
    conditions.push(`status NOT IN (${COMPLETED_PLACEHOLDERS})`);
    params.push(...COMPLETED_STATUSES);
  }

  let where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  if (filters?.financialYear) {
    const fy = buildFyWhereClauseForColumn(filters.financialYear, 'due_date');
    if (fy.clause) {
      where = where ? `${where}${fy.clause}` : `WHERE 1=1${fy.clause}`;
      params.push(...fy.params);
    }
  }

  return db.prepare(`SELECT * FROM financial_obligations ${where} ORDER BY due_date ASC`).all(...params) as ObligationRow[];
}

export function getOverdueObligations(): ObligationRow[] {
  const db = getDb();
  const todayStr = new Date().toISOString().slice(0, 10);
  return db.prepare(`
    SELECT * FROM financial_obligations
    WHERE due_date IS NOT NULL
      AND due_date < ?
      AND status NOT IN (${COMPLETED_PLACEHOLDERS})
    ORDER BY due_date ASC
  `).all(todayStr, ...COMPLETED_STATUSES) as ObligationRow[];
}

export function getUpcomingObligations(days: number): ObligationRow[] {
  const db = getDb();
  const today = new Date();
  const future = new Date(today);
  future.setDate(future.getDate() + days);
  const todayStr = today.toISOString().slice(0, 10);
  const futureStr = future.toISOString().slice(0, 10);

  return db.prepare(`
    SELECT * FROM financial_obligations
    WHERE due_date IS NOT NULL
      AND due_date >= ? AND due_date <= ?
      AND status NOT IN (${COMPLETED_PLACEHOLDERS})
    ORDER BY due_date ASC
  `).all(todayStr, futureStr, ...COMPLETED_STATUSES) as ObligationRow[];
}

export function getObligationById(id: string): ObligationRow | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM financial_obligations WHERE id = ?').get(id) as ObligationRow | undefined;
}

function syncManualToCsv(): void {
  const db = getDb();
  const manualRows = db.prepare(
    `SELECT * FROM financial_obligations WHERE source = 'manual' ORDER BY id`
  ).all() as ObligationRow[];

  const csvRows: ManualObligationCsvRow[] = manualRows.map(r => ({
    id: r.id,
    type: r.type,
    name: r.name,
    entity: r.entity,
    recurrence: r.recurrence,
    expectedAmount: r.expected_amount,
    dueDate: r.due_date,
    status: r.status,
    notes: r.notes,
    personId: r.person_id,
  }));
  writeManualObligationsToCsvFile(csvPath(), csvRows);
}

export function createManualObligation(data: {
  type: string;
  name: string;
  entity: string;
  recurrence: string;
  expectedAmount?: number | null;
  dueDate?: string | null;
  status?: string;
  notes?: string | null;
  personId?: string | null;
}): ObligationRow {
  const db = getDb();
  const id = `manual-${crypto.randomUUID()}`;
  db.prepare(`
    INSERT INTO financial_obligations
      (id, source, type, name, entity, recurrence, expected_amount, due_date, status, notes, person_id, created_at, updated_at)
    VALUES (?, 'manual', ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run(id, data.type, data.name, data.entity, data.recurrence,
    data.expectedAmount ?? null, data.dueDate ?? null, data.status ?? 'pending',
    data.notes ?? null, data.personId ?? null);
  syncManualToCsv();
  return getObligationById(id)!;
}

export function updateManualObligation(id: string, data: Record<string, unknown>): ObligationRow | null {
  const existing = getObligationById(id);
  if (!existing || existing.source !== 'manual') return null;

  const fields: string[] = [];
  const params: unknown[] = [];

  const allowed: Record<string, string> = {
    type: 'type', name: 'name', entity: 'entity', recurrence: 'recurrence',
    expectedAmount: 'expected_amount', dueDate: 'due_date', status: 'status',
    notes: 'notes', personId: 'person_id',
  };
  for (const [jsKey, dbCol] of Object.entries(allowed)) {
    if (jsKey in data) {
      fields.push(`${dbCol} = ?`);
      params.push(data[jsKey] ?? null);
    }
  }
  if (fields.length === 0) return existing;

  fields.push('updated_at = CURRENT_TIMESTAMP');
  params.push(id);

  const db = getDb();
  db.prepare(`UPDATE financial_obligations SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  syncManualToCsv();
  return getObligationById(id) ?? null;
}

export function deleteManualObligation(id: string): boolean {
  const existing = getObligationById(id);
  if (!existing || existing.source !== 'manual') return false;
  const db = getDb();
  db.prepare('DELETE FROM financial_obligations WHERE id = ? AND source = ?').run(id, 'manual');
  syncManualToCsv();
  return true;
}

export function toApiObligation(row: ObligationRow) {
  return {
    id: row.id,
    source: row.source,
    type: row.type,
    name: row.name,
    entity: row.entity,
    recurrence: row.recurrence,
    expectedAmount: row.expected_amount,
    dueDate: row.due_date,
    status: row.status,
    paidAmount: row.paid_amount,
    paidDate: row.paid_date,
    paidFromAccount: row.paid_from_account,
    notes: row.notes,
    personId: row.person_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
