/**
 * CSV I/O for `clients/contracts.csv` — the engagement table. Each
 * row is a time-bounded engagement with full commercial terms; there
 * is no `type` column (see the ContractSchema docstring for the
 * rationale — master/standalone is in `master_id`, renewal/extension
 * is positional).
 *
 * Contract rows reference three upstream registries:
 *   - `client_id`          → clients registry
 *   - `issuing_entity_id`  → company registry
 *   - `master_id`          → master-agreements loader (nullable)
 *
 * Those FK checks are enforced at registry-build time (see
 * `registry.ts`), not here — parsing is deliberately syntactic so a
 * stand-alone CSV round-trip test doesn't need to spin up the whole
 * cross-registry join.
 */

import path from 'path';
import {
  type Contract,
  ContractSchema,
} from '../../../shared/api-contracts.js';
import { escapeCsvField, atomicWriteCsv } from '../../utils/csv-helpers.js';
import {
  createCsvDecoders,
  nullIfEmpty,
  readCsvRecords,
} from '../../utils/csv-decoders.js';

const decoders = createCsvDecoders('Contract');
const {
  requireNonEmpty,
  decodeIsoDate: requireIsoDate,
  decodeNullableIsoDate,
  decodeStrictBoolean,
  decodeNonNegativeInt,
  decodeNonNegativeNumber,
} = decoders;

export const CONTRACTS_CSV_FILENAME = 'contracts.csv';

export const CONTRACT_CSV_HEADERS = [
  'id',
  'client_id',
  'issuing_entity_id',
  'master_id',
  'reference',
  'start_date',
  'end_date',
  'works_monday',
  'works_tuesday',
  'works_wednesday',
  'works_thursday',
  'works_friday',
  'works_saturday',
  'works_sunday',
  'day_rate',
  'day_rate_currency',
  'invoice_currency',
  'invoice_cadence',
  'invoice_mechanism',
  'payment_terms_days',
  'company_notice_weeks',
  'supplier_notice_weeks',
  'renewal_warning_days',
  'job_title',
  'job_description',
  'work_location',
  'conduct_regs',
  'engagement_tax_status',
  'jurisdiction',
  'signed_at',
  'docusign_envelope',
  'active',
  'updated_at',
] as const;

export function getContractsCsvPath(clientsDir: string): string {
  return path.join(clientsDir, CONTRACTS_CSV_FILENAME);
}

// ─── Row parser ─────────────────────────────────────────────────────────────

export function parseContractRow(row: Record<string, string>): Contract {
  const rowId = nullIfEmpty(row.id) ?? '<missing-id>';

  return ContractSchema.parse({
    id: requireNonEmpty(row.id, 'id', rowId),
    client_id: requireNonEmpty(row.client_id, 'client_id', rowId),
    issuing_entity_id: requireNonEmpty(row.issuing_entity_id, 'issuing_entity_id', rowId),
    master_id: nullIfEmpty(row.master_id),
    reference: requireNonEmpty(row.reference, 'reference', rowId),
    start_date: requireIsoDate(row.start_date, 'start_date', rowId),
    end_date: decodeNullableIsoDate(row.end_date, 'end_date', rowId),
    works_monday: decodeStrictBoolean(row.works_monday, 'works_monday', rowId),
    works_tuesday: decodeStrictBoolean(row.works_tuesday, 'works_tuesday', rowId),
    works_wednesday: decodeStrictBoolean(row.works_wednesday, 'works_wednesday', rowId),
    works_thursday: decodeStrictBoolean(row.works_thursday, 'works_thursday', rowId),
    works_friday: decodeStrictBoolean(row.works_friday, 'works_friday', rowId),
    works_saturday: decodeStrictBoolean(row.works_saturday, 'works_saturday', rowId),
    works_sunday: decodeStrictBoolean(row.works_sunday, 'works_sunday', rowId),
    day_rate: decodeNonNegativeNumber(row.day_rate, 'day_rate', rowId),
    day_rate_currency: requireNonEmpty(row.day_rate_currency, 'day_rate_currency', rowId),
    invoice_currency: requireNonEmpty(row.invoice_currency, 'invoice_currency', rowId),
    invoice_cadence: requireNonEmpty(row.invoice_cadence, 'invoice_cadence', rowId),
    invoice_mechanism: requireNonEmpty(row.invoice_mechanism, 'invoice_mechanism', rowId),
    payment_terms_days: decodeNonNegativeInt(row.payment_terms_days, 'payment_terms_days', rowId),
    company_notice_weeks: decodeNonNegativeInt(row.company_notice_weeks, 'company_notice_weeks', rowId),
    supplier_notice_weeks: decodeNonNegativeInt(row.supplier_notice_weeks, 'supplier_notice_weeks', rowId),
    renewal_warning_days: decodeNonNegativeInt(row.renewal_warning_days, 'renewal_warning_days', rowId),
    job_title: requireNonEmpty(row.job_title, 'job_title', rowId),
    job_description: nullIfEmpty(row.job_description),
    work_location: requireNonEmpty(row.work_location, 'work_location', rowId),
    conduct_regs: nullIfEmpty(row.conduct_regs),
    engagement_tax_status: nullIfEmpty(row.engagement_tax_status),
    jurisdiction: requireNonEmpty(row.jurisdiction, 'jurisdiction', rowId),
    signed_at: requireIsoDate(row.signed_at, 'signed_at', rowId),
    docusign_envelope: nullIfEmpty(row.docusign_envelope),
    active: decodeStrictBoolean(row.active, 'active', rowId),
    updated_at: decodeNullableIsoDate(row.updated_at, 'updated_at', rowId),
  });
}

// ─── File reader ────────────────────────────────────────────────────────────

export function readContractsCsvFile(csvPath: string): Contract[] {
  const rows: Contract[] = [];
  for (const row of readCsvRecords(csvPath)) {
    if (!nullIfEmpty(row.id)) continue;
    rows.push(parseContractRow(row));
  }
  return rows;
}

// ─── Cell encoders ──────────────────────────────────────────────────────────

function encodeOptional(value: string | null): string {
  return value ?? '';
}

function encodeBool(value: boolean): string {
  return value ? 'true' : 'false';
}

export function serializeContractRow(contract: Contract): string {
  const cells: string[] = CONTRACT_CSV_HEADERS.map(header => {
    switch (header) {
      case 'id':
        return contract.id;
      case 'client_id':
        return contract.client_id;
      case 'issuing_entity_id':
        return contract.issuing_entity_id;
      case 'master_id':
        return encodeOptional(contract.master_id);
      case 'reference':
        return contract.reference;
      case 'start_date':
        return contract.start_date;
      case 'end_date':
        return encodeOptional(contract.end_date);
      case 'works_monday':
        return encodeBool(contract.works_monday);
      case 'works_tuesday':
        return encodeBool(contract.works_tuesday);
      case 'works_wednesday':
        return encodeBool(contract.works_wednesday);
      case 'works_thursday':
        return encodeBool(contract.works_thursday);
      case 'works_friday':
        return encodeBool(contract.works_friday);
      case 'works_saturday':
        return encodeBool(contract.works_saturday);
      case 'works_sunday':
        return encodeBool(contract.works_sunday);
      case 'day_rate':
        return String(contract.day_rate);
      case 'day_rate_currency':
        return contract.day_rate_currency;
      case 'invoice_currency':
        return contract.invoice_currency;
      case 'invoice_cadence':
        return contract.invoice_cadence;
      case 'invoice_mechanism':
        return contract.invoice_mechanism;
      case 'payment_terms_days':
        return String(contract.payment_terms_days);
      case 'company_notice_weeks':
        return String(contract.company_notice_weeks);
      case 'supplier_notice_weeks':
        return String(contract.supplier_notice_weeks);
      case 'renewal_warning_days':
        return String(contract.renewal_warning_days);
      case 'job_title':
        return contract.job_title;
      case 'job_description':
        return encodeOptional(contract.job_description);
      case 'work_location':
        return contract.work_location;
      case 'conduct_regs':
        return encodeOptional(contract.conduct_regs);
      case 'engagement_tax_status':
        return encodeOptional(contract.engagement_tax_status);
      case 'jurisdiction':
        return contract.jurisdiction;
      case 'signed_at':
        return contract.signed_at;
      case 'docusign_envelope':
        return encodeOptional(contract.docusign_envelope);
      case 'active':
        return encodeBool(contract.active);
      case 'updated_at':
        return encodeOptional(contract.updated_at);
    }
  });
  return cells.map(escapeCsvField).join(',');
}

export function serializeContractsCsv(contracts: readonly Contract[]): string {
  const header = CONTRACT_CSV_HEADERS.join(',');
  const body = contracts.map(serializeContractRow).join('\n');
  return body === '' ? `${header}\n` : `${header}\n${body}\n`;
}

export function writeContractsCsvFile(
  csvPath: string,
  contracts: readonly Contract[],
): void {
  atomicWriteCsv(csvPath, serializeContractsCsv(contracts));
}
