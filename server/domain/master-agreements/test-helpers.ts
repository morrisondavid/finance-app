/**
 * Shared test helpers for the master-agreements domain tests.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import type { MasterAgreement } from './schema.js';
import {
  getMasterAgreementsCsvPath,
  parseMasterAgreementRow,
  writeMasterAgreementsCsvFile,
  MASTER_AGREEMENT_CSV_HEADERS,
} from './csv-io.js';

export function mkTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'master-agreements-'));
}

export function rowFromHeaders(
  values: Partial<Record<(typeof MASTER_AGREEMENT_CSV_HEADERS)[number], string>>,
): Record<string, string> {
  const row: Record<string, string> = {};
  for (const h of MASTER_AGREEMENT_CSV_HEADERS) {
    row[h] = values[h] ?? '';
  }
  return row;
}

export const dcMasterRow = rowFromHeaders({
  id: 'dc-master-2025',
  client_id: 'delta-capita',
  reference: 'CONTRACTOR-FRAMEWORK-2025',
  start_date: '2025-11-03',
  end_date: '',
  company_notice_weeks: '1',
  supplier_notice_weeks: '1',
  jurisdiction: 'England',
  signed_at: '2025-11-03',
  docusign_envelope: '',
  active: 'true',
  updated_at: '2026-04-21',
});

export function seedCsv(tmpDir: string, rows: readonly Record<string, string>[]): void {
  const masters: MasterAgreement[] = rows.map(parseMasterAgreementRow);
  writeMasterAgreementsCsvFile(getMasterAgreementsCsvPath(tmpDir), masters);
}
