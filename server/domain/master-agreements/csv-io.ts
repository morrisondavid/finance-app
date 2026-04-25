/**
 * CSV I/O for `clients/master-agreements.csv` — the tiny lookup table
 * of legal umbrella agreements that contracts hang under.
 *
 * Deliberately narrow in scope: read, parse, round-trip. No index
 * construction lives here; see `loader.ts` for memoised reads.
 */

import path from 'path';
import {
  type MasterAgreement,
  MasterAgreementSchema,
} from '../../../shared/api-contracts.js';
import { escapeCsvField, atomicWriteCsv } from '../../utils/csv-helpers.js';
import {
  createCsvDecoders,
  nullIfEmpty,
  readCsvRecords,
} from '../../utils/csv-decoders.js';

const decoders = createCsvDecoders('MasterAgreement');
const {
  requireNonEmpty,
  decodeIsoDate: requireIsoDate,
  decodeNullableIsoDate,
  decodeNonNegativeInt,
  decodeStrictBoolean,
} = decoders;

export const MASTER_AGREEMENTS_CSV_FILENAME = 'master-agreements.csv';

export const MASTER_AGREEMENT_CSV_HEADERS = [
  'id',
  'client_id',
  'reference',
  'start_date',
  'end_date',
  'company_notice_weeks',
  'supplier_notice_weeks',
  'jurisdiction',
  'signed_at',
  'docusign_envelope',
  'active',
  'updated_at',
] as const;

export function getMasterAgreementsCsvPath(clientsDir: string): string {
  return path.join(clientsDir, MASTER_AGREEMENTS_CSV_FILENAME);
}

// ─── Row parser ─────────────────────────────────────────────────────────────

export function parseMasterAgreementRow(row: Record<string, string>): MasterAgreement {
  const rowId = nullIfEmpty(row.id) ?? '<missing-id>';

  return MasterAgreementSchema.parse({
    id: requireNonEmpty(row.id, 'id', rowId),
    client_id: requireNonEmpty(row.client_id, 'client_id', rowId),
    reference: requireNonEmpty(row.reference, 'reference', rowId),
    start_date: requireIsoDate(row.start_date, 'start_date', rowId),
    end_date: decodeNullableIsoDate(row.end_date, 'end_date', rowId),
    company_notice_weeks: decodeNonNegativeInt(row.company_notice_weeks, 'company_notice_weeks', rowId),
    supplier_notice_weeks: decodeNonNegativeInt(row.supplier_notice_weeks, 'supplier_notice_weeks', rowId),
    jurisdiction: requireNonEmpty(row.jurisdiction, 'jurisdiction', rowId),
    signed_at: requireIsoDate(row.signed_at, 'signed_at', rowId),
    docusign_envelope: nullIfEmpty(row.docusign_envelope),
    active: decodeStrictBoolean(row.active, 'active', rowId),
    updated_at: decodeNullableIsoDate(row.updated_at, 'updated_at', rowId),
  });
}

// ─── File reader ────────────────────────────────────────────────────────────

export function readMasterAgreementsCsvFile(csvPath: string): MasterAgreement[] {
  const rows: MasterAgreement[] = [];
  for (const row of readCsvRecords(csvPath)) {
    if (!nullIfEmpty(row.id)) continue;
    rows.push(parseMasterAgreementRow(row));
  }
  return rows;
}

// ─── Cell encoders ──────────────────────────────────────────────────────────

function encodeOptional(value: string | null): string {
  return value ?? '';
}

export function serializeMasterAgreementRow(master: MasterAgreement): string {
  const cells: string[] = MASTER_AGREEMENT_CSV_HEADERS.map(header => {
    switch (header) {
      case 'id':
        return master.id;
      case 'client_id':
        return master.client_id;
      case 'reference':
        return master.reference;
      case 'start_date':
        return master.start_date;
      case 'end_date':
        return encodeOptional(master.end_date);
      case 'company_notice_weeks':
        return String(master.company_notice_weeks);
      case 'supplier_notice_weeks':
        return String(master.supplier_notice_weeks);
      case 'jurisdiction':
        return master.jurisdiction;
      case 'signed_at':
        return master.signed_at;
      case 'docusign_envelope':
        return encodeOptional(master.docusign_envelope);
      case 'active':
        return master.active ? 'true' : 'false';
      case 'updated_at':
        return encodeOptional(master.updated_at);
    }
  });
  return cells.map(escapeCsvField).join(',');
}

export function serializeMasterAgreementsCsv(masters: readonly MasterAgreement[]): string {
  const header = MASTER_AGREEMENT_CSV_HEADERS.join(',');
  const body = masters.map(serializeMasterAgreementRow).join('\n');
  return body === '' ? `${header}\n` : `${header}\n${body}\n`;
}

export function writeMasterAgreementsCsvFile(
  csvPath: string,
  masters: readonly MasterAgreement[],
): void {
  atomicWriteCsv(csvPath, serializeMasterAgreementsCsv(masters));
}
