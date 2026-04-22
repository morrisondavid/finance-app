/**
 * Shared test helpers for the company-domain test files.
 *
 * The seeded UK / UAE rows below mirror the production
 * `autonize-it/company.csv` closely enough that gate/invariant tests
 * can exercise both jurisdictions without depending on the real
 * committed file.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Company } from './schema.js';
import {
  writeCompaniesCsvFile,
  parseCompanyRow,
  getCompanyCsvPath,
  COMPANY_CSV_HEADERS,
} from './csv-io.js';

export function mkTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'company-registry-'));
}

export function rowFromHeaders(
  values: Partial<Record<(typeof COMPANY_CSV_HEADERS)[number], string>>,
): Record<string, string> {
  const row: Record<string, string> = {};
  for (const h of COMPANY_CSV_HEADERS) {
    row[h] = values[h] ?? '';
  }
  return row;
}

export const ukRow = rowFromHeaders({
  id: 'autonize-it-ltd',
  legal_name: 'Autonize IT Limited',
  trading_name: 'Autonize IT Ltd',
  kind: 'ltd',
  jurisdiction: 'UK',
  regulator: 'Companies House',
  company_number: '08842112',
  vat_number: '292 1465 96',
  formation_date: 'TBC',
  address: '53 Heath Park Road, Romford, RM2 5UL',
  currency: 'GBP',
  bank_sort_code: '20-25-19',
  bank_account_number: '63648923',
  email: 'dmorrison@autonize-it.com',
  logo_path: 'autonize-it/logo.svg',
  accountant_name: 'TBC',
  accountant_email: 'TBC',
  ct_registered: 'true',
  vat_registered: 'true',
  active: 'true',
  updated_at: '2026-04-22',
});

export const uaeRow = rowFromHeaders({
  id: 'autonize-it-fzco',
  legal_name: 'Autonize IT Software Development – FZCO',
  trading_name: 'Autonize IT FZCO',
  kind: 'fzco',
  jurisdiction: 'UAE',
  regulator: 'IFZA (International Free Zone Authority)',
  license_number: '73348',
  registration_number: '71347',
  formation_date: '2025-11-04',
  address: 'DSO-IFZA, IFZA Properties, Dubai Silicon Oasis, Dubai, UAE',
  currency: 'AED',
  iban: 'TBC',
  swift_bic: 'TBC',
  email: 'dmorrison@autonize-it.com',
  logo_path: 'autonize-it/logo.svg',
  accountant_name: 'TBC',
  accountant_email: 'TBC',
  ct_registered: 'TBC',
  qfzp_elected: 'TBC',
  vat_registered: 'false',
  active: 'true',
  updated_at: '2026-04-22',
});

export const uaeInactiveRow = rowFromHeaders({
  id: 'autonize-it-fzco',
  legal_name: 'Autonize IT Software Development – FZCO',
  trading_name: 'Autonize IT FZCO',
  kind: 'fzco',
  jurisdiction: 'UAE',
  regulator: 'IFZA',
  license_number: '00000',
  registration_number: '00000',
  formation_date: '2025-11-04',
  address: 'Somewhere, Dubai',
  currency: 'AED',
  iban: 'TBC',
  swift_bic: 'TBC',
  email: 'x@example.com',
  logo_path: 'autonize-it/logo.svg',
  accountant_name: 'TBC',
  accountant_email: 'TBC',
  ct_registered: 'TBC',
  qfzp_elected: 'TBC',
  vat_registered: 'false',
  active: 'false',
  updated_at: '2026-04-22',
});

export function seedCsv(tmpDir: string, rows: readonly Record<string, string>[]): void {
  const companies: Company[] = rows.map(parseCompanyRow);
  writeCompaniesCsvFile(getCompanyCsvPath(tmpDir), companies);
}
