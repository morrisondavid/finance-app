/**
 * Shared test helpers for the leave-domain tests.
 *
 * Because the leave registry joins the contracts registry at build
 * time, test helpers stand up a stub contracts registry containing
 * the DC + La Fosse fixtures from `server/domain/contracts/test-helpers.ts`
 * so leave rows referencing `dc-sow-2026` / `lf-2026-mar` pass FK
 * validation without touching disk.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import type { ContractRegistry } from '../contracts/registry.js';
import { buildContractRegistryFromData } from '../contracts/registry.js';
import { parseContractRow } from '../contracts/csv-io.js';
import {
  dcSowRow,
  lfContractRow,
  makeStubClients,
  makeStubCompanies,
  makeStubMasters,
} from '../contracts/test-helpers.js';
import type { LeaveRow } from '../../../shared/api-contracts.js';
import {
  LEAVE_CSV_HEADERS,
  composeLeaveId,
  getLeaveCsvPath,
  parseLeaveRow,
  writeLeaveCsvFile,
} from './csv-io.js';

export function mkTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'leave-registry-'));
}

/**
 * Stub contracts registry containing both DC + La Fosse fixture
 * contracts. Every leave row in the fixtures below references one of
 * these two ids.
 */
export function makeStubContracts(): ContractRegistry {
  return buildContractRegistryFromData(
    [parseContractRow(dcSowRow), parseContractRow(lfContractRow)],
    {
      clients: makeStubClients(),
      companies: makeStubCompanies(),
      masters: makeStubMasters(),
    },
  );
}

export function rowFromHeaders(
  values: Partial<Record<(typeof LEAVE_CSV_HEADERS)[number], string>>,
): Record<string, string> {
  const row: Record<string, string> = {};
  for (const h of LEAVE_CSV_HEADERS) {
    row[h] = values[h] ?? '';
  }
  return row;
}

const DC_CONTRACT = 'dc-sow-2026';
const LF_CONTRACT = 'lf-2026-mar';

/** Holiday against DC on 2026-05-04. */
export const dcHolidayRow = rowFromHeaders({
  id: composeLeaveId(DC_CONTRACT, '2026-05-04'),
  contract_id: DC_CONTRACT,
  date: '2026-05-04',
  type: 'holiday',
  notes: '',
  external_logged: 'false',
  created_at: '2026-04-20',
  updated_at: '2026-04-20',
});

/** Sick day against DC on 2026-03-10 (past-dated relative to plan `today`). */
export const dcPastSickRow = rowFromHeaders({
  id: composeLeaveId(DC_CONTRACT, '2026-03-10'),
  contract_id: DC_CONTRACT,
  date: '2026-03-10',
  type: 'sick',
  notes: 'migraine',
  external_logged: 'true',
  created_at: '2026-03-10',
  updated_at: '2026-03-10',
});

/** Holiday against La Fosse on 2026-03-20. */
export const lfHolidayRow = rowFromHeaders({
  id: composeLeaveId(LF_CONTRACT, '2026-03-20'),
  contract_id: LF_CONTRACT,
  date: '2026-03-20',
  type: 'holiday',
  notes: '',
  external_logged: 'false',
  created_at: '2026-02-15',
  updated_at: '2026-02-15',
});

export function parseRow(row: Record<string, string>): LeaveRow {
  return parseLeaveRow(row);
}

export function seedCsv(tmpDir: string, rows: readonly Record<string, string>[]): void {
  const parsed: LeaveRow[] = rows.map(parseLeaveRow);
  writeLeaveCsvFile(getLeaveCsvPath(tmpDir), parsed);
}
