import crypto from 'crypto';
import { getDb, OBLIGATIONS_DIR, COMMITMENTS_DIR } from '../connection.js';
import { buildFyWhereClauseForColumn } from '../utils/financial-year.js';
import {
  buildDeclaredCommitmentRegistry,
  __resetDeclaredCommitmentRegistryForTests,
} from '../../domain/commitments/registry.js';
import { buildCommitmentsWriter } from '../../domain/commitments/csv-writer.js';
import {
  getObligationStateCsvPath,
  readObligationStateFromFile,
  upsertObligationState,
  deleteObligationState,
  type ObligationStateRow,
} from '../../domain/commitments/obligation-state.js';
import {
  commitmentProjectsToObligation,
  projectCommitmentToObligationRow,
} from '../../domain/commitments/obligation-projection.js';
import {
  DeclaredOutgoingSchema,
  type DeclaredOutgoing,
  type Cadence,
  type CreateObligationBody,
  type UpdateObligationBody,
} from '../../../shared/api-contracts.js';

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

function obligationStateCsvPath(): string {
  return getObligationStateCsvPath(OBLIGATIONS_DIR);
}

function commitmentsWriter() {
  return buildCommitmentsWriter(COMMITMENTS_DIR);
}

function freshRegistry() {
  // Always build a fresh registry on the mutation path: we want the write we
  // just made to be visible to downstream reads (projector + seeders) in the
  // same request.
  __resetDeclaredCommitmentRegistryForTests();
  return buildDeclaredCommitmentRegistry(COMMITMENTS_DIR);
}

/**
 * Load every manual obligation from the declared-commitments registry and
 * upsert it into `financial_obligations`. Runs at boot in place of the old
 * `manual-obligations.csv` reader.
 */
export function loadManualObligationsFromCsv(): void {
  const db = getDb();
  const registry = freshRegistry();
  const state = readObligationStateFromFile(obligationStateCsvPath());

  const projected = registry.outgoing
    .filter(commitmentProjectsToObligation)
    .map(c => projectCommitmentToObligationRow(c, state.get(c.id)));

  const insert = db.prepare(`
    INSERT OR REPLACE INTO financial_obligations
      (id, source, type, name, entity, recurrence, expected_amount, due_date, status,
       paid_amount, paid_date, paid_from_account, notes, person_id, created_at, updated_at)
    VALUES (?, 'manual', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `);

  for (const r of projected) {
    insert.run(
      r.id, r.type, r.name, r.entity, r.recurrence,
      r.expectedAmount, r.dueDate, r.status,
      r.paidAmount, r.paidDate, r.paidFromAccount, r.notes, r.personId,
    );
  }

  if (projected.length > 0) {
    console.log(`[Database] Loaded ${projected.length} manual obligation(s) from commitments registry`);
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
  /** Inclusive lower bound on `due_date`. Takes precedence over `financialYear` when both are supplied. */
  minDueDate?: string;
  /** Inclusive upper bound on `due_date`. Takes precedence over `financialYear` when both are supplied. */
  maxDueDate?: string;
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

  const hasExplicitRange = filters?.minDueDate !== undefined || filters?.maxDueDate !== undefined;
  if (hasExplicitRange) {
    if (filters?.minDueDate !== undefined) {
      conditions.push('due_date >= ?');
      params.push(filters.minDueDate);
    }
    if (filters?.maxDueDate !== undefined) {
      conditions.push('due_date <= ?');
      params.push(filters.maxDueDate);
    }
  }

  let where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  if (!hasExplicitRange && filters?.financialYear) {
    const fy = buildFyWhereClauseForColumn(filters.financialYear, 'due_date');
    if (fy.clause) {
      where = where ? `${where}${fy.clause}` : `WHERE 1=1${fy.clause}`;
      params.push(...fy.params);
    }
  }

  return db.prepare(`SELECT * FROM financial_obligations ${where} ORDER BY due_date ASC`).all(...params) as ObligationRow[];
}

export interface OverdueObligationsFilters {
  /** Inclusive lower bound on `due_date`. Used to drop settled-history rows from the overdue hero. */
  minDueDate?: string;
}

export function getOverdueObligations(filters?: OverdueObligationsFilters): ObligationRow[] {
  const db = getDb();
  const todayStr = new Date().toISOString().slice(0, 10);
  const conditions: string[] = ['due_date IS NOT NULL', 'due_date < ?'];
  const params: unknown[] = [todayStr];
  if (filters?.minDueDate !== undefined) {
    conditions.push('due_date >= ?');
    params.push(filters.minDueDate);
  }
  conditions.push(`status NOT IN (${COMPLETED_PLACEHOLDERS})`);
  params.push(...COMPLETED_STATUSES);
  return db.prepare(`
    SELECT * FROM financial_obligations
    WHERE ${conditions.join(' AND ')}
    ORDER BY due_date ASC
  `).all(...params) as ObligationRow[];
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

type TaxObligationType = 'vat' | 'corporation-tax' | 'self-assessment' | 'hmrc-ttp';

/**
 * Translate the obligations API `type` enum into a declared commitment
 * category. The API currently exposes four historical tax subtypes
 * (vat, corporation-tax, self-assessment, hmrc-ttp) that all map to the
 * single `tax-manual` category — the specific subtype is preserved on the
 * commitment's `taxType` field so round-trips stay lossless. `loan` and
 * `other` don't map yet; future categories should be added to
 * DeclaredOutgoingSchema first.
 */
function obligationTypeToCategory(type: string): DeclaredOutgoing['category'] {
  switch (type) {
    case 'insurance': return 'insurance';
    case 'subscription': return 'subscription';
    case 'vat':
    case 'corporation-tax':
    case 'self-assessment':
    case 'hmrc-ttp':
      return 'tax-manual';
    default:
      throw new Error(
        `Manual obligations of type '${type}' are not supported by the declared-commitments registry. ` +
        `Add a category to DeclaredOutgoingSchema first.`,
      );
  }
}

function isTaxObligationType(type: string): type is TaxObligationType {
  return type === 'vat' || type === 'corporation-tax'
    || type === 'self-assessment' || type === 'hmrc-ttp';
}

const VALID_CADENCES: readonly Cadence[] = ['monthly', 'quarterly', 'annual', 'one-off'];
function isCadence(r: string): r is Cadence {
  return (VALID_CADENCES as readonly string[]).includes(r);
}

/**
 * Fields shared by Create + Update payloads. We require `id` because this
 * helper is the single writer for both paths; the route layer generates
 * an id for creates and passes the existing id for updates.
 */
interface ObligationInputWithId {
  id: string;
  type: CreateObligationBody['type'];
  name: string;
  entity: string;
  recurrence: CreateObligationBody['recurrence'];
  expectedAmount?: number | null;
  dueDate?: string | null;
  notes?: string | null;
  personId?: CreateObligationBody['personId'];
}

function buildCommitmentFromObligationInput(input: ObligationInputWithId): DeclaredOutgoing {
  const category = obligationTypeToCategory(input.type);
  if (!isCadence(input.recurrence)) {
    throw new Error(`Invalid recurrence '${input.recurrence}' for manual obligation`);
  }
  const base = {
    id: input.id,
    cadence: input.recurrence,
    merchant: input.entity,
    displayName: input.name,
    amount: input.expectedAmount ?? 0,
    currency: 'GBP' as const,
    notes: input.notes ?? undefined,
  };
  const extra = category === 'insurance'
    ? { category, dueDate: input.dueDate ?? undefined }
    : category === 'tax-manual'
      ? {
        category,
        personId: input.personId ?? undefined,
        dueDate: input.dueDate ?? undefined,
        // Preserve which tax subtype the user picked. The API `type` is
        // guaranteed to be one of the four tax values here because that's
        // how `obligationTypeToCategory` routed us into this branch.
        taxType: isTaxObligationType(input.type) ? input.type : undefined,
      }
      : { category };
  return DeclaredOutgoingSchema.parse({ ...base, ...extra });
}

function writeStateFromInput(id: string, data: {
  status?: string | null;
  paidAmount?: number | null;
  paidDate?: string | null;
  paidFromAccount?: string | null;
}): void {
  const row: ObligationStateRow = {
    id,
    status: data.status ?? 'pending',
    paidAmount: data.paidAmount ?? null,
    paidDate: data.paidDate ?? null,
    paidFromAccount: data.paidFromAccount ?? null,
  };
  upsertObligationState(obligationStateCsvPath(), row);
}

export function createManualObligation(data: CreateObligationBody): ObligationRow {
  const id = `manual-${crypto.randomUUID()}`;
  const commitment = buildCommitmentFromObligationInput({ ...data, id });
  commitmentsWriter().upsert(commitment);
  if (data.status && data.status !== 'pending') {
    writeStateFromInput(id, { status: data.status });
  }
  // Rebuild + reload so the DB reflects the write.
  loadManualObligationsFromCsv();
  const row = getObligationById(id);
  if (!row) {
    throw new Error(`createManualObligation: row ${id} missing after reload — check commitments/commitments.csv is writable`);
  }
  return row;
}

/**
 * Reconstruct the obligation-shaped input from an existing commitment so the
 * update path can start from known-good, schema-narrowed fields rather than
 * the DB row (whose `type`/`recurrence` columns are bare strings).
 */
function inputFromCommitment(
  c: Extract<DeclaredOutgoing, { category: 'insurance' | 'subscription' | 'tax-manual' }>,
): ObligationInputWithId {
  const obligationType: CreateObligationBody['type'] =
    c.category === 'insurance' ? 'insurance' :
    c.category === 'subscription' ? 'subscription' :
    // tax-manual carries the specific subtype; fall back to self-assessment
    // for pre-existing rows that never had the field set.
    (c.taxType ?? 'self-assessment');
  return {
    id: c.id,
    type: obligationType,
    name: c.displayName ?? c.merchant,
    entity: c.merchant,
    recurrence: c.cadence,
    expectedAmount: c.amount,
    dueDate: c.category === 'insurance' || c.category === 'tax-manual' ? c.dueDate ?? null : null,
    notes: c.notes ?? null,
    personId: c.category === 'tax-manual' ? c.personId ?? null : null,
  };
}

export function updateManualObligation(id: string, patch: UpdateObligationBody): ObligationRow | null {
  const existing = getObligationById(id);
  if (!existing || existing.source !== 'manual') return null;

  const registry = freshRegistry();
  const existingCommitment = registry.all.find(c => c.id === id);
  if (!existingCommitment || !commitmentProjectsToObligation(existingCommitment)) return null;

  // Declaration fields go to commitments.csv; state fields (status + paidX)
  // go to obligation-state.csv. Splitting the two writes at the field level
  // keeps declarations pristine and mutation history isolated.
  const touchDeclaration =
    patch.type !== undefined || patch.name !== undefined || patch.entity !== undefined ||
    patch.recurrence !== undefined || patch.expectedAmount !== undefined ||
    patch.dueDate !== undefined || patch.notes !== undefined || patch.personId !== undefined;

  // NOTE: paidAmount/paidDate/paidFromAccount are not part of
  // UpdateObligationBodySchema today; if that changes, extend `touchState`
  // to match.
  const touchState = patch.status !== undefined;

  if (touchDeclaration) {
    const base = inputFromCommitment(existingCommitment);
    const merged: ObligationInputWithId = {
      ...base,
      type: patch.type ?? base.type,
      name: patch.name ?? base.name,
      entity: patch.entity ?? base.entity,
      recurrence: patch.recurrence ?? base.recurrence,
      expectedAmount: patch.expectedAmount !== undefined ? patch.expectedAmount : base.expectedAmount,
      dueDate: patch.dueDate !== undefined ? patch.dueDate : base.dueDate,
      notes: patch.notes !== undefined ? patch.notes : base.notes,
      personId: patch.personId !== undefined ? patch.personId : base.personId,
    };
    commitmentsWriter().upsert(buildCommitmentFromObligationInput(merged));
  }

  if (touchState) {
    const currentState = readObligationStateFromFile(obligationStateCsvPath()).get(id);
    const next: ObligationStateRow = {
      id,
      status: patch.status ?? currentState?.status ?? existing.status,
      paidAmount: currentState?.paidAmount ?? existing.paid_amount,
      paidDate: currentState?.paidDate ?? existing.paid_date,
      paidFromAccount: currentState?.paidFromAccount ?? existing.paid_from_account,
    };
    upsertObligationState(obligationStateCsvPath(), next);
  }

  loadManualObligationsFromCsv();
  return getObligationById(id) ?? null;
}

export function deleteManualObligation(id: string): boolean {
  const existing = getObligationById(id);
  if (!existing || existing.source !== 'manual') return false;
  const db = getDb();
  const removed = commitmentsWriter().remove(id);
  deleteObligationState(obligationStateCsvPath(), id);
  db.prepare('DELETE FROM financial_obligations WHERE id = ? AND source = ?').run(id, 'manual');
  return removed;
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
