/**
 * Shared test helpers for the clients-domain test files.
 *
 * The seeded direct / agency rows below mirror the production
 * `clients/clients.csv` closely enough that gate/invariant tests can
 * exercise both `kind` branches without depending on the real
 * committed file.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Client } from './schema.js';
import {
  writeClientsCsvFile,
  parseClientRow,
  getClientsCsvPath,
  CLIENT_CSV_HEADERS,
} from './csv-io.js';

export function mkTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'clients-registry-'));
}

export function rowFromHeaders(
  values: Partial<Record<(typeof CLIENT_CSV_HEADERS)[number], string>>,
): Record<string, string> {
  const row: Record<string, string> = {};
  for (const h of CLIENT_CSV_HEADERS) {
    row[h] = values[h] ?? '';
  }
  return row;
}

export const directRow = rowFromHeaders({
  id: 'delta-capita',
  legal_name: 'Delta Capita Ltd',
  trading_name: 'Delta Capita',
  kind: 'direct',
  vat_number: 'TBC',
  billing_address: '2nd Floor, 40 Bank Street, Canary Wharf, London, E14 5NR',
  primary_contact_name: 'Lily Lovegrove-Saville',
  primary_contact_email: 'lily.lovegrove@deltacapita.com',
  secondary_contact_name: 'Philip Coleman',
  secondary_contact_email: 'philip.coleman@deltacapita.com',
  hr_contact_name: 'William Swift',
  hr_contact_email: 'william.swift@deltacapita.com',
  cc_emails: 'hrandrecruitment@deltacapita.com,dan.hedley@deltacapita.com',
  client_assigned_email: 'david.morrison@ext.deltacapita.com',
  active: 'true',
  updated_at: '2026-04-21',
});

export const agencyRow = rowFromHeaders({
  id: 'la-fosse',
  legal_name: 'La Fosse Associates Limited',
  trading_name: 'La Fosse',
  kind: 'agency',
  vat_number: '360 0265 37',
  billing_address: '1st Floor, 11-19 Artillery Row, London, SW1P 1RT',
  primary_contact_name: 'TBC',
  primary_contact_email: 'TBC',
  end_client_legal_name: 'The Edwin Group Ltd',
  end_client_address:
    'First Floor (South), Cathedral Buildings, Dean Street, Newcastle Upon Tyne, NE1 1PG',
  end_client_primary_contact_name: 'Aidan Gray',
  end_client_primary_contact_email: 'TBC',
  active: 'true',
  updated_at: '2026-04-21',
});

export const agencyInactiveRow = rowFromHeaders({
  id: 'old-agency',
  legal_name: 'Old Agency Ltd',
  trading_name: 'Old Agency',
  kind: 'agency',
  billing_address: 'Somewhere',
  primary_contact_name: 'Prior Contact',
  primary_contact_email: 'prior@example.com',
  end_client_legal_name: 'Legacy End Client Ltd',
  end_client_address: 'Legacy address',
  end_client_primary_contact_name: 'Legacy Contact',
  end_client_primary_contact_email: 'legacy@example.com',
  active: 'false',
  updated_at: '2024-01-01',
});

export function seedCsv(tmpDir: string, rows: readonly Record<string, string>[]): void {
  const clients: Client[] = rows.map(parseClientRow);
  writeClientsCsvFile(getClientsCsvPath(tmpDir), clients);
}
