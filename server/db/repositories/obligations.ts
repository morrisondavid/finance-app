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
      (id, source, type, name, entity, recurrence, expected_amount, due_date, status, notes, created_at, updated_at)
    VALUES (?, 'manual', ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `);

  for (const r of rows) {
    insert.run(r.id, r.type, r.name, r.entity, r.recurrence, r.expectedAmount, r.dueDate, r.status, r.notes);
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
}): void {
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO financial_obligations
      (id, source, type, name, entity, recurrence, expected_amount, due_date, status,
       paid_amount, paid_date, paid_from_account, notes, created_at, updated_at)
    VALUES (?, 'auto', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run(
    obligation.id, obligation.type, obligation.name, obligation.entity,
    obligation.recurrence, obligation.expectedAmount, obligation.dueDate,
    obligation.status, obligation.paidAmount, obligation.paidDate,
    obligation.paidFromAccount, obligation.notes,
  );
}

export function getAllObligations(filters?: {
  status?: string;
  type?: string;
  source?: string;
}): ObligationRow[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: string[] = [];

  if (filters?.status) { conditions.push('status = ?'); params.push(filters.status); }
  if (filters?.type) { conditions.push('type = ?'); params.push(filters.type); }
  if (filters?.source) { conditions.push('source = ?'); params.push(filters.source); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  return db.prepare(`SELECT * FROM financial_obligations ${where} ORDER BY due_date ASC`).all(...params) as ObligationRow[];
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
    AND status NOT IN ('paid', 'confirmed')
    ORDER BY due_date ASC
  `).all(todayStr, futureStr) as ObligationRow[];
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
}): ObligationRow {
  const db = getDb();
  const id = `manual-${crypto.randomUUID()}`;
  db.prepare(`
    INSERT INTO financial_obligations
      (id, source, type, name, entity, recurrence, expected_amount, due_date, status, notes, created_at, updated_at)
    VALUES (?, 'manual', ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run(id, data.type, data.name, data.entity, data.recurrence,
    data.expectedAmount ?? null, data.dueDate ?? null, data.status ?? 'pending', data.notes ?? null);
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
    expectedAmount: 'expected_amount', dueDate: 'due_date', status: 'status', notes: 'notes',
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
