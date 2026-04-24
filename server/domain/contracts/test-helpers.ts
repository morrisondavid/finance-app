/**
 * Shared test helpers for the contracts-domain tests.
 *
 * Because the contracts registry joins three upstream registries at
 * build time (clients, company, master-agreements), test helpers have
 * to stand those up too. The stub builders below produce fixture
 * registries that satisfy the FK checks without touching disk.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import type {
  Client,
  Company,
  Contract,
  MasterAgreement,
} from '../../../shared/api-contracts.js';
import {
  buildClientRegistryFromData,
  type ClientRegistry,
} from '../clients/registry.js';
import {
  buildCompanyRegistryFromData,
  type CompanyRegistry,
} from '../company/registry.js';
import { parseClientRow } from '../clients/csv-io.js';
import { directRow, agencyRow } from '../clients/test-helpers.js';
import { parseCompanyRow } from '../company/csv-io.js';
import { ukRow as ukCompanyRow, uaeRow as uaeCompanyRow } from '../company/test-helpers.js';
import { parseMasterAgreementRow } from '../master-agreements/csv-io.js';
import { dcMasterRow } from '../master-agreements/test-helpers.js';
import {
  CONTRACT_CSV_HEADERS,
  getContractsCsvPath,
  parseContractRow,
  writeContractsCsvFile,
} from './csv-io.js';

export function mkTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'contracts-registry-'));
}

export function makeStubClients(): ClientRegistry {
  const clients: Client[] = [parseClientRow(directRow), parseClientRow(agencyRow)];
  return buildClientRegistryFromData(clients);
}

export function makeStubCompanies(): CompanyRegistry {
  const companies: Company[] = [parseCompanyRow(ukCompanyRow), parseCompanyRow(uaeCompanyRow)];
  return buildCompanyRegistryFromData(companies);
}

export function makeStubMasters(): readonly MasterAgreement[] {
  return [parseMasterAgreementRow(dcMasterRow)];
}

export function rowFromHeaders(
  values: Partial<Record<(typeof CONTRACT_CSV_HEADERS)[number], string>>,
): Record<string, string> {
  const row: Record<string, string> = {};
  for (const h of CONTRACT_CSV_HEADERS) {
    row[h] = values[h] ?? '';
  }
  return row;
}

/** Delta Capita SOW for 2026, under `dc-master-2025`, issued by UK Ltd. */
export const dcSowRow = rowFromHeaders({
  id: 'dc-sow-2026',
  client_id: 'delta-capita',
  issuing_entity_id: 'autonize-it-ltd',
  master_id: 'dc-master-2025',
  reference: 'DMORRISON02',
  start_date: '2026-03-02',
  end_date: '2027-03-01',
  works_monday: 'true',
  works_tuesday: 'true',
  works_wednesday: 'true',
  works_thursday: 'true',
  works_friday: 'true',
  works_saturday: 'false',
  works_sunday: 'false',
  day_rate: '550',
  day_rate_currency: 'GBP',
  invoice_currency: 'GBP',
  invoice_cadence: 'monthly',
  invoice_mechanism: 'supplier-issued',
  payment_terms_days: '30',
  company_notice_weeks: '1',
  supplier_notice_weeks: '1',
  renewal_warning_days: '60',
  job_title: 'Senior Engineer',
  work_location: 'Remote / London',
  conduct_regs: 'opted-out',
  engagement_tax_status: 'outside-ir35',
  jurisdiction: 'England',
  signed_at: '2026-01-15',
  active: 'true',
  updated_at: '2026-04-21',
});

/** La Fosse agency engagement ending 2026-03-31. */
export const lfContractRow = rowFromHeaders({
  id: 'lf-2026-mar',
  client_id: 'la-fosse',
  issuing_entity_id: 'autonize-it-ltd',
  master_id: '',
  reference: 'LAF-TEG-001',
  start_date: '2026-01-06',
  end_date: '2026-03-31',
  works_monday: 'true',
  works_tuesday: 'true',
  works_wednesday: 'true',
  works_thursday: 'true',
  works_friday: 'true',
  works_saturday: 'false',
  works_sunday: 'false',
  day_rate: '500',
  day_rate_currency: 'GBP',
  invoice_currency: 'GBP',
  invoice_cadence: 'weekly',
  invoice_mechanism: 'self-bill',
  payment_terms_days: '14',
  company_notice_weeks: '1',
  supplier_notice_weeks: '1',
  renewal_warning_days: '60',
  job_title: 'Senior Engineer',
  work_location: 'Remote',
  conduct_regs: 'opted-out',
  engagement_tax_status: 'outside-ir35',
  jurisdiction: 'England',
  signed_at: '2025-12-20',
  active: 'true',
  updated_at: '2026-04-21',
});

/**
 * Follow-on to the La Fosse engagement — starts the day after
 * `lf-2026-mar` ends. There is no `type` column distinguishing this
 * from its predecessor: "it's the next one" is positional, answered by
 * the `byClientAndEntity` index ordering by `start_date`.
 */
export const lfExtensionRow = rowFromHeaders({
  ...lfContractRow,
  id: 'lf-extension-1',
  reference: 'LAF-TEG-001-EXT1',
  start_date: '2026-04-01',
  end_date: '2026-06-30',
  signed_at: '2026-03-15',
});

/**
 * La Fosse engagement paid through the FZCO — same client as
 * {@link lfContractRow} but `issuing_entity_id` flips to UAE, which
 * means the (client_id, issuing_entity_id) pair is a fresh series in
 * `byClientAndEntity`, not a positional renewal of the UK Ltd row.
 *
 * UK-only fields (`conduct_regs`, `engagement_tax_status`) are empty
 * because the registry's UK-only-field gate rejects them on a non-UK
 * issuer.
 */
export const lfFzcoContractRow = rowFromHeaders({
  id: 'lf-2026-apr',
  client_id: 'la-fosse',
  issuing_entity_id: 'autonize-it-fzco',
  master_id: '',
  reference: 'LAF-TEG-002',
  start_date: '2026-03-02',
  end_date: '2026-04-30',
  works_monday: 'true',
  works_tuesday: 'true',
  works_wednesday: 'true',
  works_thursday: 'true',
  works_friday: 'true',
  works_saturday: 'false',
  works_sunday: 'false',
  day_rate: '500',
  day_rate_currency: 'GBP',
  invoice_currency: 'GBP',
  invoice_cadence: 'weekly',
  invoice_mechanism: 'self-bill',
  payment_terms_days: '30',
  company_notice_weeks: '2',
  supplier_notice_weeks: '2',
  renewal_warning_days: '30',
  job_title: 'Full Stack Engineer',
  work_location: 'Remote with occasional office visits',
  jurisdiction: 'England',
  signed_at: '2026-04-02',
  active: 'true',
  updated_at: '2026-04-24',
});

export const dcSowInactiveRow = rowFromHeaders({
  ...dcSowRow,
  id: 'dc-sow-2025-prior',
  start_date: '2025-03-02',
  end_date: '2026-03-01',
  signed_at: '2025-01-15',
  active: 'false',
});

export function seedCsv(tmpDir: string, rows: readonly Record<string, string>[]): void {
  const contracts: Contract[] = rows.map(parseContractRow);
  writeContractsCsvFile(getContractsCsvPath(tmpDir), contracts);
}
