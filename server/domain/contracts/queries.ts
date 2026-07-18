/**
 * Contracts domain — public query surface.
 *
 * `findContractForTransaction` is the key hook the payment matcher
 * (§1.2 Phase C) will call with `(clientId, issuingEntityId, date)`
 * to identify the engagement a transaction belongs to. In Phase A we
 * surface it with its date-only semantics; Phase C will extend it
 * (narrative-aware tie-breaking, invoice-level matching, etc.).
 *
 * `upsertContract` is the sole write path: it re-reads the current
 * CSV, merges the incoming row (insert-or-replace by id), re-runs the
 * registry build for FK validation, writes the CSV atomically, and
 * invalidates the registry cache. All callers (API route handlers,
 * CLI, integration tests) go through this.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { isContractCurrent } from '../../../shared/contract-display.js';
import { shiftIsoDate } from '../../../shared/iso-date.js';
import type {
  Contract,
  ContractId,
  ClientId,
  EntityId,
} from './schema.js';
import {
  clientEntityKey,
  getContractRegistry,
  buildContractRegistryFromData,
  invalidateContractRegistry,
  type ContractRegistry,
  type BuildContractRegistryInput,
} from './registry.js';
import {
  getContractsCsvPath,
  readContractsCsvFile,
  writeContractsCsvFile,
} from './csv-io.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_CLIENTS_DIR = path.join(__dirname, '../../../clients');

/** Every configured contract, in CSV order. */
export function allContracts(
  reg: ContractRegistry = getContractRegistry(),
): readonly Contract[] {
  return reg.all;
}

/** Primary-key lookup. Returns null for unknown ids. */
export function findContractById(
  id: ContractId,
  reg: ContractRegistry = getContractRegistry(),
): Contract | null {
  return reg.indexes.byId.get(id) ?? null;
}

/** Every contract for a client, ordered by `start_date` ascending. */
export function listContractsByClient(
  clientId: ClientId,
  reg: ContractRegistry = getContractRegistry(),
): readonly Contract[] {
  return reg.indexes.byClient.get(clientId) ?? [];
}

/** Every contract in effect on `today` (`start_date <= today <= end_date`), in CSV order. */
export function listCurrentContracts(
  today: string,
  reg: ContractRegistry = getContractRegistry(),
): readonly Contract[] {
  return reg.all.filter(c => isContractCurrent(c, today));
}

/** @deprecated Use {@link listCurrentContracts} with an explicit `today`. */
export function listActiveContracts(
  reg: ContractRegistry = getContractRegistry(),
): readonly Contract[] {
  const today = new Date().toISOString().slice(0, 10);
  return listCurrentContracts(today, reg);
}

/**
 * Slack added beyond a contract's payment terms before we stop expecting
 * trailing receipts — covers a payment that lands a little late.
 */
export const FORECAST_TRAILING_BUFFER_DAYS = 7;

/**
 * The latest date a contract's final invoice could realistically be paid:
 * `end_date` plus payment terms (weekly self-bill lags an extra ~7 days, the
 * same offset {@link collectAccrualEvents} uses), plus a small buffer. After
 * this date the engagement is fully settled and no longer relevant to the
 * forecast.
 */
export function lastExpectedPaymentDate(contract: Contract): string {
  const cadenceLag = contract.invoice_cadence === 'weekly' ? 7 : 0;
  return shiftIsoDate(
    contract.end_date,
    contract.payment_terms_days + cadenceLag + FORECAST_TRAILING_BUFFER_DAYS,
  );
}

/**
 * Contracts relevant to forecasting on `today`: every current contract plus
 * recently-ended ones whose final payment could still be outstanding (work was
 * performed but the cash hasn't landed yet). Distinct from
 * {@link listCurrentContracts} — warnings, deadlines and leave want only
 * strictly-current rows, whereas the forecast must keep an ended engagement
 * until its trailing receivable arrives.
 */
export function listContractsForForecast(
  today: string,
  reg: ContractRegistry = getContractRegistry(),
): readonly Contract[] {
  return reg.all.filter(
    c =>
      isContractCurrent(c, today) ||
      (c.end_date < today && today <= lastExpectedPaymentDate(c)),
  );
}

export interface FindContractForTransactionQuery {
  readonly clientId: ClientId;
  readonly issuingEntityId: EntityId;
  /** ISO date yyyy-mm-dd. The contract returned is the one in effect on this date. */
  readonly date: string;
}

/**
 * Find the contract in effect for `(clientId, issuingEntityId)` on a
 * given ISO date. A contract is "in effect" when
 * `start_date ≤ date ≤ end_date`. Returns the contract
 * with the latest `start_date` that still satisfies the range — so
 * overlapping follow-on rows (where a new contract's `start_date`
 * equals the prior contract's `end_date`) resolve to the newer row.
 *
 * Returns `null` if no contract is in effect on that date.
 */
export function findContractForTransaction(
  query: FindContractForTransactionQuery,
  reg: ContractRegistry = getContractRegistry(),
): Contract | null {
  const series = reg.indexes.byClientAndEntity.get(
    clientEntityKey(query.clientId, query.issuingEntityId),
  );
  if (series === undefined) return null;

  let best: Contract | null = null;
  for (const c of series) {
    if (c.start_date > query.date) continue;
    if (query.date > c.end_date) continue;
    if (best === null || c.start_date > best.start_date) best = c;
  }
  return best;
}

/**
 * Like {@link findContractForTransaction}, but also treats a deposit as
 * in-contract when it lands in the trailing receivable window after
 * `end_date` — `end_date` plus payment terms (and weekly cadence lag)
 * plus {@link FORECAST_TRAILING_BUFFER_DAYS}. Matches how forecast keeps
 * ended engagements until the final invoice could realistically be paid.
 */
export function findContractForPaymentReceipt(
  query: FindContractForTransactionQuery,
  reg: ContractRegistry = getContractRegistry(),
): Contract | null {
  const inWindow = findContractForTransaction(query, reg);
  if (inWindow !== null) return inWindow;

  const series = reg.indexes.byClientAndEntity.get(
    clientEntityKey(query.clientId, query.issuingEntityId),
  );
  if (series === undefined) return null;

  let best: Contract | null = null;
  for (const c of series) {
    if (query.date <= c.end_date) continue;
    if (query.date > lastExpectedPaymentDate(c)) continue;
    if (best === null || c.end_date > best.end_date) best = c;
  }
  return best;
}

export interface UpsertContractInput {
  readonly contract: Contract;
  /**
   * Optional override for the `clients/` directory (used by tests).
   * Production callers omit this and hit the committed CSV.
   */
  readonly clientsDir?: string;
  /**
   * Optional upstream registry injections. Used by integration tests
   * that want to avoid reading the real clients/company/masters files.
   */
  readonly input?: BuildContractRegistryInput;
}

/**
 * Insert-or-replace a contract by `id`. The full flow:
 *
 *   1. Re-read the current contracts CSV.
 *   2. Replace the row with matching `id`, or append if not present.
 *   3. Re-run `buildContractRegistryFromData` with the merged list so
 *      FK validation runs against the live upstream registries.
 *   4. On success, atomically write the updated CSV and invalidate the
 *      process-level registry cache.
 *
 * Returns the new in-memory registry (same shape as `getContractRegistry`).
 *
 * IMPORTANT — this function does NOT run the contract-renewal deadline
 * seeder. Callers that want derived state refreshed should invoke
 * `syncContractRenewalDeadlines()` after this returns. Keeping the
 * seeder out of the write path means `upsertContract` is callable from
 * contexts that don't have a SQLite DB initialised (standalone scripts,
 * unit tests).
 */
export function upsertContract(input: UpsertContractInput): ContractRegistry {
  const clientsDir = input.clientsDir ?? DEFAULT_CLIENTS_DIR;
  const csvPath = getContractsCsvPath(clientsDir);
  const existing = readContractsCsvFile(csvPath);

  const merged: Contract[] = [];
  let replaced = false;
  for (const row of existing) {
    if (row.id === input.contract.id) {
      merged.push(input.contract);
      replaced = true;
    } else {
      merged.push(row);
    }
  }
  if (!replaced) merged.push(input.contract);

  const rebuilt = buildContractRegistryFromData(merged, input.input);
  writeContractsCsvFile(csvPath, merged);
  invalidateContractRegistry();
  return rebuilt;
}
