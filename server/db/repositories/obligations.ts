import crypto from 'crypto';
import { getDb, OBLIGATIONS_DIR } from '../connection.js';
import { buildFyWhereClauseForColumn } from '../utils/financial-year.js';
import {
  buildObligationRegistry,
  __resetObligationRegistryForTests,
} from '../../domain/obligations/registry.js';
import { buildObligationsWriter } from '../../domain/obligations/csv-writer.js';
import {
  getObligationStateCsvPath,
  readObligationStateFromFile,
  upsertObligationState,
  deleteObligationState,
  type ObligationStateRow,
} from '../../domain/obligations/obligation-state.js';
import {
  obligationProjectsToRow,
  projectObligationToRow,
} from '../../domain/obligations/obligation-projection.js';
import {
  UnknownTransactionError,
  paidFieldsFromTransactionMatch,
  resolvePaidFieldsFromTxHash,
} from '../../domain/obligations/paid-fields.js';
import {
  assertPaymentMatchesObligation,
  PaymentAmountMismatchError,
} from '../../domain/obligations/amount-tolerance.js';
import { obligationPaymentExpectation } from '../../domain/obligations/payment-candidates.js';
import type { ExpenseTransactionMatch } from './transaction-queries.js';
import {
  OutgoingObligationSchema,
  ObligationSourceSchema,
  ObligationTypeSchema,
  ObligationFrequencySchema,
  ObligationStatusSchema,
  PersonIdSchema,
  type OutgoingObligation,
  type CreateObligationBody,
  type UpdateObligationBody,
  type ObligationRow,
} from '../../../shared/api-contracts.js';

/**
 * Statuses that indicate an obligation has been resolved and doesn't need further action.
 * Used consistently across overdue, upcoming, and "hide completed" queries so behaviour
 * never drifts between endpoints.
 */
export const COMPLETED_STATUSES = ['paid', 'confirmed'] as const;

const COMPLETED_PLACEHOLDERS = COMPLETED_STATUSES.map(() => '?').join(',');

/**
 * Raw SQLite row shape (snake_case) for the `financial_obligations` table.
 * Converted to the camelCase {@link ObligationRow} API shape via
 * {@link toApiObligation} before it leaves this module.
 */
interface ObligationDbRow {
  id: string;
  source: string;
  type: string;
  name: string;
  entity: string;
  frequency: string;
  expected_amount: number | null;
  naive_amount: number | null;
  adjustment_basis: string | null;
  adjustment_source: string | null;
  due_date: string | null;
  status: string;
  paid_amount: number | null;
  paid_date: string | null;
  paid_from_account: string | null;
  paid_from_tx_hash: string | null;
  notes: string | null;
  person_id: string | null;
  created_at: string | null;
  updated_at: string | null;
}

function obligationStateCsvPath(): string {
  return getObligationStateCsvPath(OBLIGATIONS_DIR);
}

function obligationsWriter() {
  return buildObligationsWriter(OBLIGATIONS_DIR);
}

function freshRegistry() {
  // Always build a fresh registry on the mutation path: we want the write we
  // just made to be visible to downstream reads (projector + seeders) in the
  // same request.
  __resetObligationRegistryForTests();
  return buildObligationRegistry(OBLIGATIONS_DIR);
}

/**
 * Rebuild the `financial_obligations` read-model rows from the obligations
 * registry and per-occurrence state. Runs at boot and after every mutation
 * so the DB table is always a pure projection — never a source of truth.
 *
 * Exported under its legacy name for one caller (sa-estimator tests) plus
 * the alias `rebuildObligationsTable` that the repository uses internally.
 */
export function loadManualObligationsFromCsv(): void {
  const db = getDb();
  const registry = freshRegistry();
  const state = readObligationStateFromFile(obligationStateCsvPath());

  const projected = registry.outgoing
    .filter(obligationProjectsToRow)
    .map(c => projectObligationToRow(c, state.get(c.id)));

  const insert = db.prepare(`
    INSERT OR REPLACE INTO financial_obligations
      (id, source, type, name, entity, frequency, expected_amount, naive_amount, adjustment_basis, adjustment_source,
       due_date, status,
       paid_amount, paid_date, paid_from_account, paid_from_tx_hash, notes, person_id, created_at, updated_at)
    VALUES (?, 'manual', ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `);

  for (const r of projected) {
    insert.run(
      r.id, r.type, r.name, r.entity, r.frequency,
      r.expectedAmount, r.dueDate, r.status,
      r.paidAmount, r.paidDate, r.paidFromAccount, r.paidFromTxHash, r.notes, r.personId,
    );
  }

  if (projected.length > 0) {
    console.log(`[Database] Loaded ${projected.length} manual obligation(s) from obligations registry`);
  }
}

/** Canonical alias used by all internal mutation paths in this module. */
const rebuildObligationsTable = loadManualObligationsFromCsv;

export function insertAutoObligation(obligation: {
  id: string;
  type: string;
  name: string;
  entity: string;
  frequency: string;
  expectedAmount: number | null;
  naiveAmount?: number | null;
  adjustmentBasis?: string | null;
  adjustmentSource?: string | null;
  dueDate: string | null;
  status: string;
  paidAmount: number | null;
  paidDate: string | null;
  paidFromAccount: string | null;
  paidFromTxHash?: string | null;
  notes: string | null;
  personId?: string | null;
}): void {
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO financial_obligations
      (id, source, type, name, entity, frequency, expected_amount, naive_amount, adjustment_basis, adjustment_source,
       due_date, status,
       paid_amount, paid_date, paid_from_account, paid_from_tx_hash, notes, person_id, created_at, updated_at)
    VALUES (?, 'auto', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run(
    obligation.id, obligation.type, obligation.name, obligation.entity,
    obligation.frequency, obligation.expectedAmount,
    obligation.naiveAmount ?? null,
    obligation.adjustmentBasis ?? null,
    obligation.adjustmentSource ?? null,
    obligation.dueDate,
    obligation.status, obligation.paidAmount, obligation.paidDate,
    obligation.paidFromAccount, obligation.paidFromTxHash ?? null,
    obligation.notes, obligation.personId ?? null,
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

export function getAllObligations(filters?: ObligationFilters): ObligationDbRow[] {
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

  return db.prepare(`SELECT * FROM financial_obligations ${where} ORDER BY due_date ASC`).all(...params) as ObligationDbRow[];
}

export interface OverdueObligationsFilters {
  /** Inclusive lower bound on `due_date`. Used to drop settled-history rows from the overdue hero. */
  minDueDate?: string;
}

export function getOverdueObligations(filters?: OverdueObligationsFilters): ObligationDbRow[] {
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
  `).all(...params) as ObligationDbRow[];
}

export function getUpcomingObligations(days: number): ObligationDbRow[] {
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
  `).all(todayStr, futureStr, ...COMPLETED_STATUSES) as ObligationDbRow[];
}

/**
 * Obligations for tax-reserve warnings: upcoming within `maxLookaheadDays`
 * plus overdue unpaid rows (reserve shortfall persists after the due date).
 */
export function obligationsForTaxReserveWarnings(maxLookaheadDays: number): ObligationDbRow[] {
  const upcoming = getUpcomingObligations(maxLookaheadDays);
  const overdueUnpaid = getOverdueObligations().filter(row => row.status === 'unpaid');
  const seen = new Set<string>();
  const merged: ObligationDbRow[] = [];
  for (const row of [...overdueUnpaid, ...upcoming]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    merged.push(row);
  }
  return merged;
}

export function getObligationById(id: string): ObligationDbRow | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM financial_obligations WHERE id = ?').get(id) as ObligationDbRow | undefined;
}

type TaxObligationType = 'vat' | 'corporation-tax' | 'self-assessment' | 'hmrc-ttp';
type ManualApiType = CreateObligationBody['type'];

function isTaxObligationType(type: ManualApiType): type is TaxObligationType {
  return type === 'vat' || type === 'corporation-tax'
    || type === 'self-assessment' || type === 'hmrc-ttp';
}

/**
 * Parse a CRUD API body into a validated {@link OutgoingObligation}.
 *
 * The legacy API `type` enum exposes four tax subtypes (vat,
 * corporation-tax, self-assessment, hmrc-ttp) that all fold into the single
 * `tax-manual` obligation category — the specific subtype is preserved on
 * `taxType` so round-trips stay lossless. `insurance` and `subscription`
 * map 1:1. `loan` / `other` are not yet supported; add a category to
 * {@link OutgoingObligationSchema} before wiring them up.
 *
 * The Zod `.parse()` at the bottom is the sole validation boundary — no
 * manual type guards needed because every field that flows in has already
 * been narrowed by the Zod-parsed request body schema.
 */
function obligationFromApiBody(
  id: string,
  body: Pick<CreateObligationBody,
    'type' | 'name' | 'entity' | 'frequency' |
    'expectedAmount' | 'dueDate' | 'notes' | 'personId'>,
): OutgoingObligation {
  const base = {
    id,
    frequency: body.frequency,
    merchant: body.entity,
    displayName: body.name,
    amount: body.expectedAmount ?? 0,
    currency: 'GBP' as const,
    notes: body.notes ?? undefined,
  };
  switch (body.type) {
    case 'insurance':
      return OutgoingObligationSchema.parse({
        ...base, category: 'insurance', dueDate: body.dueDate ?? undefined,
      });
    case 'subscription':
      return OutgoingObligationSchema.parse({ ...base, category: 'subscription' });
    case 'vat':
    case 'corporation-tax':
    case 'self-assessment':
    case 'hmrc-ttp':
      return OutgoingObligationSchema.parse({
        ...base,
        category: 'tax-manual',
        personId: body.personId ?? undefined,
        dueDate: body.dueDate ?? undefined,
        taxType: isTaxObligationType(body.type) ? body.type : undefined,
      });
    case 'loan':
    case 'other':
      throw new Error(
        `Manual obligations of type '${body.type}' are not supported yet. ` +
        `Add a category to OutgoingObligationSchema first.`,
      );
  }
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
    paidFromTxHash: null,
    source: 'user',
  };
  upsertObligationState(obligationStateCsvPath(), row);
}

export function createManualObligation(data: CreateObligationBody): ObligationDbRow {
  const id = `manual-${crypto.randomUUID()}`;
  obligationsWriter().upsert(obligationFromApiBody(id, data));
  if (data.status && data.status !== 'pending') {
    writeStateFromInput(id, { status: data.status });
  }
  rebuildObligationsTable();
  const row = getObligationById(id);
  if (!row) {
    throw new Error(`createManualObligation: row ${id} missing after reload — check obligations/obligations.csv is writable`);
  }
  return row;
}

/**
 * Recover an API-body-shaped payload from an existing obligation so the
 * update path can merge a partial patch against known-good fields. The
 * obligation is the source of truth; we project it through the legacy
 * `type` enum via {@link OutgoingToManualApiType} so the merged result
 * round-trips cleanly back through {@link obligationFromApiBody}.
 */
function apiBodyFromObligation(
  o: Extract<OutgoingObligation, { category: 'insurance' | 'subscription' | 'tax-manual' }>,
): Pick<CreateObligationBody,
  'type' | 'name' | 'entity' | 'frequency' |
  'expectedAmount' | 'dueDate' | 'notes' | 'personId'> {
  const type: CreateObligationBody['type'] =
    o.category === 'insurance' ? 'insurance' :
    o.category === 'subscription' ? 'subscription' :
    // tax-manual carries the specific subtype; fall back to self-assessment
    // for pre-existing rows written before `taxType` was introduced.
    (o.taxType ?? 'self-assessment');
  return {
    type,
    name: o.displayName ?? o.merchant,
    entity: o.merchant,
    frequency: o.frequency,
    expectedAmount: o.amount,
    dueDate: o.category === 'insurance' || o.category === 'tax-manual' ? o.dueDate ?? null : null,
    notes: o.notes ?? null,
    personId: o.category === 'tax-manual' ? o.personId ?? null : null,
  };
}

export function updateManualObligation(id: string, patch: UpdateObligationBody): ObligationDbRow | null {
  const existing = getObligationById(id);
  if (!existing || existing.source !== 'manual') return null;

  const registry = freshRegistry();
  const existingObligation = registry.all.find(c => c.id === id);
  if (!existingObligation || !obligationProjectsToRow(existingObligation)) return null;

  // Declaration fields go to obligations.csv; state fields (status + paidX)
  // go to obligation-state.csv. Splitting the two writes at the field level
  // keeps declarations pristine and mutation history isolated.
  const touchDeclaration =
    patch.type !== undefined || patch.name !== undefined || patch.entity !== undefined ||
    patch.frequency !== undefined || patch.expectedAmount !== undefined ||
    patch.dueDate !== undefined || patch.notes !== undefined || patch.personId !== undefined;

  // NOTE: paidAmount/paidDate/paidFromAccount are not part of
  // UpdateObligationBodySchema today; if that changes, extend `touchState`
  // to match.
  const touchState = patch.status !== undefined;

  if (touchDeclaration) {
    const base = apiBodyFromObligation(existingObligation);
    obligationsWriter().upsert(obligationFromApiBody(id, {
      type: patch.type ?? base.type,
      name: patch.name ?? base.name,
      entity: patch.entity ?? base.entity,
      frequency: patch.frequency ?? base.frequency,
      expectedAmount: patch.expectedAmount !== undefined ? patch.expectedAmount : base.expectedAmount,
      dueDate: patch.dueDate !== undefined ? patch.dueDate : base.dueDate,
      notes: patch.notes !== undefined ? patch.notes : base.notes,
      personId: patch.personId !== undefined ? patch.personId : base.personId,
    }));
  }

  if (touchState) {
    const currentState = readObligationStateFromFile(obligationStateCsvPath()).get(id);
    const next: ObligationStateRow = {
      id,
      status: patch.status ?? currentState?.status ?? existing.status,
      paidAmount: currentState?.paidAmount ?? existing.paid_amount,
      paidDate: currentState?.paidDate ?? existing.paid_date,
      paidFromAccount: currentState?.paidFromAccount ?? existing.paid_from_account,
      paidFromTxHash: currentState?.paidFromTxHash ?? existing.paid_from_tx_hash,
      source: 'user',
    };
    upsertObligationState(obligationStateCsvPath(), next);
  }

  rebuildObligationsTable();
  return getObligationById(id) ?? null;
}

/**
 * Upsert a `source=user` state row for a manual obligation and rebuild
 * the projected `financial_obligations` table so the override is
 * immediately visible to `/api/obligations` and `/overdue`.
 *
 * Rejects auto-seeder ids (prefix `auto-`) — those are wholly managed by
 * the HMRC seeders and would be clobbered on the next seed cycle.
 * Returns `null` if the id does not exist in the registry (404).
 */
export function upsertManualObligationState(id: string, patch: {
  status: string;
  paidAmount?: number | null;
  paidDate?: string | null;
  paidFromAccount?: string | null;
  paidFromTxHash?: string | null;
}): ObligationDbRow | null {
  if (id.startsWith('auto-')) {
    throw new NonManualStateError(
      `Cannot set state on auto-seeded obligation '${id}'. Auto rows are managed by the HMRC seeders.`,
    );
  }
  const registry = freshRegistry();
  const exists = registry.all.some(c => c.id === id);
  if (!exists) return null;

  let paidAmount = patch.paidAmount ?? null;
  let paidDate = patch.paidDate ?? null;
  let paidFromAccount = patch.paidFromAccount ?? null;
  let paidFromTxHash: string | null = patch.paidFromTxHash ?? null;

  if (patch.paidFromTxHash !== undefined && patch.paidFromTxHash !== null) {
    const resolved = resolvePaidFieldsFromTxHash(patch.paidFromTxHash);
    if (resolved === null) {
      throw new UnknownTransactionError(patch.paidFromTxHash);
    }
    const expectation = obligationPaymentExpectation(id);
    assertPaymentMatchesObligation({
      hash: patch.paidFromTxHash,
      paidAmount: resolved.paidAmount,
      expectedAmount: expectation?.expectedAmount ?? null,
      toleranceRatio: expectation?.toleranceRatio,
    });
    paidAmount = resolved.paidAmount;
    paidDate = resolved.paidDate;
    paidFromAccount = resolved.paidFromAccount;
    paidFromTxHash = patch.paidFromTxHash;
  }

  const row: ObligationStateRow = {
    id,
    status: patch.status,
    paidAmount,
    paidDate,
    paidFromAccount,
    paidFromTxHash,
    source: 'user',
  };
  upsertObligationState(obligationStateCsvPath(), row);
  rebuildObligationsTable();
  return getObligationById(id) ?? null;
}

/**
 * Write a `source=auto` paid state row when an auto-matcher attributes a
 * transaction to a manual registry obligation (e.g. SA manual supersede).
 * Skips when the user has already marked the obligation paid (`source=user`).
 */
export function upsertAutoObligationStateFromMatch(
  id: string,
  match: ExpenseTransactionMatch,
): void {
  if (id.startsWith('auto-')) return;
  const existing = readObligationStateFromFile(obligationStateCsvPath()).get(id);
  if (existing?.source === 'user') return;

  const link = paidFieldsFromTransactionMatch(match);
  const row: ObligationStateRow = {
    id,
    status: 'paid',
    paidAmount: link.paidAmount,
    paidDate: link.paidDate,
    paidFromAccount: link.paidFromAccount,
    paidFromTxHash: link.paidFromTxHash,
    source: 'auto',
  };
  upsertObligationState(obligationStateCsvPath(), row);
  rebuildObligationsTable();
}

export { UnknownTransactionError, PaymentAmountMismatchError };

/**
 * Remove any state override (user OR auto) for a manual obligation,
 * reverting it to the default projection (status=pending for annual
 * rows, etc). Rebuilds the projection so the change is visible
 * immediately. Returns `false` if no state row existed.
 */
export function resetManualObligationState(id: string): boolean {
  if (id.startsWith('auto-')) {
    throw new NonManualStateError(
      `Cannot reset state on auto-seeded obligation '${id}'. Auto rows are managed by the HMRC seeders.`,
    );
  }
  const stateBefore = readObligationStateFromFile(obligationStateCsvPath());
  if (!stateBefore.has(id)) return false;
  deleteObligationState(obligationStateCsvPath(), id);
  rebuildObligationsTable();
  return true;
}

/**
 * Thrown when the user targets an auto-seeded id with a manual-only
 * endpoint (e.g. the Mark Paid routes). Caught by the route handler and
 * turned into a 400.
 */
export class NonManualStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonManualStateError';
  }
}

export function deleteManualObligation(id: string): boolean {
  const existing = getObligationById(id);
  if (!existing || existing.source !== 'manual') return false;
  const db = getDb();
  const removed = obligationsWriter().remove(id);
  deleteObligationState(obligationStateCsvPath(), id);
  db.prepare('DELETE FROM financial_obligations WHERE id = ? AND source = ?').run(id, 'manual');
  return removed;
}

/**
 * Map a raw DB row (snake_case) to the shared camelCase API shape. Return
 * type is explicit so route handlers never need a downstream cast — the
 * compiler verifies every field on {@link ObligationRow} is produced here.
 */
export function toApiObligation(row: ObligationDbRow): ObligationRow {
  const source = ObligationSourceSchema.parse(row.source);
  const type = ObligationTypeSchema.parse(row.type);
  const frequency = ObligationFrequencySchema.parse(row.frequency);
  const status = ObligationStatusSchema.parse(row.status);
  const personId = row.person_id === null ? null : PersonIdSchema.parse(row.person_id);
  return {
    id: row.id,
    source,
    type,
    name: row.name,
    entity: row.entity,
    frequency,
    expectedAmount: row.expected_amount,
    naiveAmount: row.naive_amount ?? null,
    adjustmentBasis: row.adjustment_basis ?? null,
    adjustmentSource: row.adjustment_source ?? null,
    dueDate: row.due_date,
    status,
    paidAmount: row.paid_amount,
    paidDate: row.paid_date,
    paidFromAccount: row.paid_from_account,
    paidFromTxHash: row.paid_from_tx_hash ?? null,
    notes: row.notes,
    personId,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
