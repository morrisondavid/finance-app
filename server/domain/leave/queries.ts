/**
 * Leave domain — public query + write surface.
 *
 * Read paths mirror the contracts domain's shape: thin wrappers over
 * registry indexes with a `reg?` parameter so tests can inject a
 * fixture registry without touching the file system.
 *
 * The write paths (`upsertLeaveRows`, `deleteLeaveRow`) are the sole
 * entry points for the POST/DELETE routes in §1.2.E. Each one:
 *   1. Re-reads the current CSV (cheap; the file is tiny).
 *   2. Merges the incoming change (insert-or-replace by id, or remove
 *      by id).
 *   3. Re-runs `buildLeaveRegistryFromData` with the merged list so
 *      FK validation runs against the live contracts registry.
 *   4. On success, atomically writes the updated CSV and invalidates
 *      the process-level registry cache.
 *
 * The registry cache invalidation is important: the income-accrual
 * endpoint reads leave via `getLeaveRegistry()`, so a POST /leave
 * that doesn't invalidate would leave the accrual endpoint reading
 * stale numbers until the next restart.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import type {
  ContractId,
  LeaveRow,
  LeaveId,
} from '../../../shared/api-contracts.js';
import {
  buildLeaveRegistryFromData,
  getLeaveRegistry,
  invalidateLeaveRegistry,
  type BuildLeaveRegistryInput,
  type LeaveRegistry,
} from './registry.js';
import {
  getLeaveCsvPath,
  readLeaveCsvFile,
  writeLeaveCsvFile,
} from './csv-io.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_WORKING_DAYS_DIR = path.join(__dirname, '../../../working-days');

/**
 * Tests override this to point the default working-days directory at a
 * temp folder. Production code never touches it — it defaults to the
 * committed `working-days/` folder. Kept small: one getter and one
 * setter, deliberately private to the module so no other call site
 * picks it up by accident.
 */
let activeWorkingDaysDir: string = DEFAULT_WORKING_DAYS_DIR;

export function setLeaveWorkingDaysDirForTests(dir: string | null): void {
  activeWorkingDaysDir = dir ?? DEFAULT_WORKING_DAYS_DIR;
}

/** Every leave row on file, in CSV order. */
export function allLeave(reg: LeaveRegistry = getLeaveRegistry()): readonly LeaveRow[] {
  return reg.all;
}

/** Primary-key lookup. Returns null for unknown ids. */
export function findLeaveById(
  id: LeaveId,
  reg: LeaveRegistry = getLeaveRegistry(),
): LeaveRow | null {
  return reg.indexes.byId.get(id) ?? null;
}

/** Every leave row for a contract, ordered by `date` ascending. */
export function leaveForContract(
  contractId: ContractId,
  reg: LeaveRegistry = getLeaveRegistry(),
): readonly LeaveRow[] {
  return reg.indexes.byContract.get(contractId) ?? [];
}

/**
 * Leave rows for a contract that overlap `[start, end]` inclusive.
 * The range is closed on both ends — typical accrual callers pass
 * `[period_start, period_end]`.
 */
export function leaveInWindow(
  contractId: ContractId,
  start: string,
  end: string,
  reg: LeaveRegistry = getLeaveRegistry(),
): readonly LeaveRow[] {
  const rows = leaveForContract(contractId, reg);
  const clipped: LeaveRow[] = [];
  for (const row of rows) {
    if (row.date < start) continue;
    if (row.date > end) continue;
    clipped.push(row);
  }
  return clipped;
}

export interface UpsertLeaveRowsInput {
  readonly rows: readonly LeaveRow[];
  readonly workingDaysDir?: string;
  readonly input?: BuildLeaveRegistryInput;
}

/**
 * Insert-or-replace one or more leave rows keyed on `id`. Callers
 * compose the id via {@link composeLeaveId} (usually
 * `{contract_id}-{date}`) so re-booking the same date replaces the
 * existing row rather than duplicating it.
 */
export function upsertLeaveRows(input: UpsertLeaveRowsInput): LeaveRegistry {
  const workingDaysDir = input.workingDaysDir ?? activeWorkingDaysDir;
  const csvPath = getLeaveCsvPath(workingDaysDir);
  const existing = readLeaveCsvFile(csvPath);

  const incoming = new Map<LeaveId, LeaveRow>();
  for (const row of input.rows) incoming.set(row.id, row);

  const merged: LeaveRow[] = [];
  for (const row of existing) {
    const replacement = incoming.get(row.id);
    if (replacement === undefined) {
      merged.push(row);
    } else {
      merged.push(replacement);
      incoming.delete(row.id);
    }
  }
  for (const row of incoming.values()) merged.push(row);

  const rebuilt = buildLeaveRegistryFromData(merged, input.input);
  writeLeaveCsvFile(csvPath, merged);
  invalidateLeaveRegistry();
  return rebuilt;
}

export interface DeleteLeaveRowInput {
  readonly id: LeaveId;
  readonly workingDaysDir?: string;
  readonly input?: BuildLeaveRegistryInput;
}

/**
 * Remove a leave row by id. Returns the rebuilt registry (which will
 * reflect the deletion). Silently no-ops if the id is absent — the
 * HTTP layer is responsible for 404-ing unknown ids before calling.
 */
export function deleteLeaveRow(input: DeleteLeaveRowInput): LeaveRegistry {
  const workingDaysDir = input.workingDaysDir ?? activeWorkingDaysDir;
  const csvPath = getLeaveCsvPath(workingDaysDir);
  const existing = readLeaveCsvFile(csvPath);

  const merged = existing.filter(row => row.id !== input.id);
  const rebuilt = buildLeaveRegistryFromData(merged, input.input);
  writeLeaveCsvFile(csvPath, merged);
  invalidateLeaveRegistry();
  return rebuilt;
}
