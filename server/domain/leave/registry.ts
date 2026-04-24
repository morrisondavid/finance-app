/**
 * Leave registry — single source of truth for leave days booked
 * against individual contracts. §1.2.E's minimum-viable leave writer.
 *
 * This is a *derived* view: it combines the raw leave rows from
 * `working-days/leave.csv` with the contracts registry to validate
 * the `contract_id` FK at build time. A dangling `contract_id` fails
 * loudly during registry build rather than much later at a specific
 * query call site.
 *
 * Indexes:
 *   - `byId` — primary-key lookup (id = `{contract_id}-{date}`).
 *   - `byContract` — every leave row for a given contract, ordered by
 *     `date` ascending. The per-contract leave log in the Contracts
 *     tab's detail drawer reads this.
 *   - `byDate` — every leave row for a given ISO date, across all
 *     contracts. Useful for "what was I doing on this day?" type
 *     cross-contract queries; reserved for 1.4's monthly calendar UI.
 *   - `futureByContract` — leave rows whose `date >= today` at
 *     registry-build time, grouped by contract. The income-accrual
 *     pure function doesn't use this (it filters by period range),
 *     but the Contracts tab's inline remove action does — only
 *     future-dated rows are deletable.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import type {
  ContractId,
  LeaveId,
  LeaveRow,
} from '../../../shared/api-contracts.js';
import { createRegistry } from '../_shared/create-registry.js';
import { filterToIndex, groupBy, indexBy } from '../_shared/index-builders.js';
import {
  getContractRegistry,
  type ContractRegistry,
} from '../contracts/registry.js';
import { todayIsoLocal } from '../../../shared/iso-date.js';
import { getLeaveCsvPath, readLeaveCsvFile } from './csv-io.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_WORKING_DAYS_DIR = path.join(__dirname, '../../../working-days');

/**
 * Tests override this to route the memoised registry default at a
 * temp folder. Kept module-local and paired with
 * `setLeaveWorkingDaysDirForTests` in `queries.ts` so the two read
 * and write sides stay in lockstep.
 */
let activeWorkingDaysDir: string = DEFAULT_WORKING_DAYS_DIR;

export function setLeaveRegistryWorkingDaysDirForTests(dir: string | null): void {
  activeWorkingDaysDir = dir ?? DEFAULT_WORKING_DAYS_DIR;
}

export interface LeaveRegistry {
  readonly all: readonly LeaveRow[];
  readonly indexes: {
    readonly byId: ReadonlyMap<LeaveId, LeaveRow>;
    readonly byContract: ReadonlyMap<ContractId, readonly LeaveRow[]>;
    readonly byDate: ReadonlyMap<string, readonly LeaveRow[]>;
    readonly futureByContract: ReadonlyMap<ContractId, readonly LeaveRow[]>;
  };
}

export interface BuildLeaveRegistryInput {
  readonly contracts?: ContractRegistry;
  /**
   * Override the "today" date used to partition `futureByContract`.
   * Tests pin this so the index is deterministic regardless of the
   * wall clock.
   */
  readonly today?: string;
}

export function buildLeaveRegistryFromData(
  all: readonly LeaveRow[],
  input: BuildLeaveRegistryInput = {},
): LeaveRegistry {
  const contracts = input.contracts ?? getContractRegistry();
  const today = input.today ?? todayIsoLocal();

  for (const row of all) {
    if (!contracts.indexes.byId.has(row.contract_id)) {
      throw new Error(
        `Leave ${row.id}: unknown contract_id '${row.contract_id}' (not in contracts registry)`,
      );
    }
  }

  const byId = indexBy(all, r => r.id, { indexName: 'leave.byId' });

  const sortedByDate = (xs: readonly LeaveRow[]): readonly LeaveRow[] =>
    [...xs].sort((a, b) => a.date.localeCompare(b.date));

  const byContractRaw = groupBy(all, r => r.contract_id);
  const byContract = new Map<ContractId, readonly LeaveRow[]>();
  for (const [k, v] of byContractRaw) byContract.set(k, sortedByDate(v));

  const byDateRaw = groupBy(all, r => r.date);
  const byDate = new Map<string, readonly LeaveRow[]>();
  for (const [k, v] of byDateRaw) byDate.set(k, v);

  const futureRows = filterToIndex(all, r => r.date >= today);
  const futureByContractRaw = groupBy(futureRows, r => r.contract_id);
  const futureByContract = new Map<ContractId, readonly LeaveRow[]>();
  for (const [k, v] of futureByContractRaw) futureByContract.set(k, sortedByDate(v));

  return {
    all,
    indexes: { byId, byContract, byDate, futureByContract },
  };
}

export function buildLeaveRegistry(
  workingDaysDir: string = DEFAULT_WORKING_DAYS_DIR,
  input: BuildLeaveRegistryInput = {},
): LeaveRegistry {
  const rows = readLeaveCsvFile(getLeaveCsvPath(workingDaysDir));
  return buildLeaveRegistryFromData(rows, input);
}

const handle = createRegistry<LeaveRegistry>({
  name: 'leave',
  build: () => buildLeaveRegistry(activeWorkingDaysDir),
});

export const getLeaveRegistry = handle.get;
export const invalidateLeaveRegistry = handle.invalidate;
export const __resetLeaveRegistryForTests = handle.__resetForTests;

export { DEFAULT_WORKING_DAYS_DIR };
