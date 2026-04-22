/**
 * CSV I/O for `autonize-it/company.csv` — the entity registry for the
 * two legally-distinct companies this app accounts for.
 *
 * On-disk shape is a single flat row covering both jurisdiction
 * variants; columns that don't apply to a given entity are left empty.
 * Parsing rehydrates the correct discriminated-union variant (UK | UAE)
 * and runs it through the Zod schema so bad data fails at the trust
 * boundary with a precise path.
 *
 * The literal string `TBC` is a first-class value and must survive
 * round-trip (parse → serialize → parse) byte-for-byte — downstream
 * warnings depend on being able to distinguish "unresolved" from
 * "not applicable" / `null`.
 */

import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import {
  type Company,
  UkCompanySchema,
  UaeCompanySchema,
} from '../../../shared/api-contracts.js';
import { escapeCsvField, atomicWriteCsv } from '../../utils/csv-helpers.js';

export const COMPANY_CSV_FILENAME = 'company.csv';

export const COMPANY_CSV_HEADERS = [
  'id',
  'legal_name',
  'trading_name',
  'kind',
  'jurisdiction',
  'regulator',
  'company_number',
  'vat_number',
  'license_number',
  'registration_number',
  'formation_date',
  'address',
  'currency',
  'bank_sort_code',
  'bank_account_number',
  'iban',
  'swift_bic',
  'email',
  'logo_path',
  'accountant_name',
  'accountant_email',
  'ct_registered',
  'qfzp_elected',
  'vat_registered',
  'active',
  'updated_at',
] as const;

export function getCompanyCsvPath(autonizeItDir: string): string {
  return path.join(autonizeItDir, COMPANY_CSV_FILENAME);
}

// ─── Cell decoders ──────────────────────────────────────────────────────────
//
// Every decoder has one job: turn the raw string from a CSV cell into the
// precise TS value (including the literal 'TBC') the Zod schema expects.
// Empty cells become `null`.

function nullIfEmpty(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function requireNonEmpty(value: string | undefined, field: string, rowId: string): string {
  const v = nullIfEmpty(value);
  if (v === null) {
    throw new Error(`Company ${rowId}: ${field} is required`);
  }
  return v;
}

/** Decode a boolean column that also allows the literal 'TBC'. */
function decodeBooleanOrTbc(
  value: string | undefined,
  field: string,
  rowId: string,
): boolean | 'TBC' {
  const raw = nullIfEmpty(value);
  if (raw === null) {
    throw new Error(`Company ${rowId}: ${field} is required (true | false | TBC)`);
  }
  if (raw === 'TBC') return 'TBC';
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error(`Company ${rowId}: ${field} must be 'true' | 'false' | 'TBC', got '${raw}'`);
}

/** Decode a nullable boolean-or-TBC column (empty cell → null). */
function decodeNullableBooleanOrTbc(
  value: string | undefined,
  field: string,
  rowId: string,
): boolean | 'TBC' | null {
  const raw = nullIfEmpty(value);
  if (raw === null) return null;
  return decodeBooleanOrTbc(value, field, rowId);
}

/** Decode a nullable string-or-TBC column (empty cell → null, `TBC` preserved). */
function decodeNullableStringOrTbc(value: string | undefined): string | 'TBC' | null {
  return nullIfEmpty(value);
}

/** Decode a nullable ISO-date-or-TBC column. */
function decodeNullableDateOrTbc(
  value: string | undefined,
  field: string,
  rowId: string,
): string | null {
  const raw = nullIfEmpty(value);
  if (raw === null) return null;
  if (raw === 'TBC') return 'TBC';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new Error(`Company ${rowId}: ${field} must be yyyy-mm-dd or 'TBC', got '${raw}'`);
  }
  return raw;
}

/** Decode a strict boolean column (true | false) with no TBC allowed. */
function decodeStrictBoolean(
  value: string | undefined,
  field: string,
  rowId: string,
): boolean {
  const raw = nullIfEmpty(value);
  if (raw === null) {
    throw new Error(`Company ${rowId}: ${field} is required (true | false)`);
  }
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error(`Company ${rowId}: ${field} must be 'true' | 'false', got '${raw}'`);
}

// ─── Row parser ─────────────────────────────────────────────────────────────

/**
 * Rehydrate a flat CSV row into the correct discriminated-union variant
 * (UK | UAE) and validate with Zod. Throws with a precise message
 * pointing at the offending row/field on any violation.
 */
export function parseCompanyRow(row: Record<string, string>): Company {
  const rowId = nullIfEmpty(row.id) ?? '<missing-id>';
  const jurisdiction = requireNonEmpty(row.jurisdiction, 'jurisdiction', rowId);

  const common = {
    id: requireNonEmpty(row.id, 'id', rowId),
    legal_name: requireNonEmpty(row.legal_name, 'legal_name', rowId),
    trading_name: requireNonEmpty(row.trading_name, 'trading_name', rowId),
    regulator: requireNonEmpty(row.regulator, 'regulator', rowId),
    formation_date: decodeNullableDateOrTbc(row.formation_date, 'formation_date', rowId),
    address: requireNonEmpty(row.address, 'address', rowId),
    email: requireNonEmpty(row.email, 'email', rowId),
    logo_path: nullIfEmpty(row.logo_path),
    accountant_name: decodeNullableStringOrTbc(row.accountant_name),
    accountant_email: decodeNullableStringOrTbc(row.accountant_email),
    vat_registered: decodeBooleanOrTbc(row.vat_registered, 'vat_registered', rowId),
    active: decodeStrictBoolean(row.active, 'active', rowId),
    updated_at: nullIfEmpty(row.updated_at),
  };

  if (jurisdiction === 'UK') {
    return UkCompanySchema.parse({
      ...common,
      jurisdiction: 'UK',
      kind: requireNonEmpty(row.kind, 'kind', rowId),
      currency: requireNonEmpty(row.currency, 'currency', rowId),
      company_number: requireNonEmpty(row.company_number, 'company_number', rowId),
      vat_number: nullIfEmpty(row.vat_number),
      license_number: null,
      registration_number: null,
      bank_sort_code: nullIfEmpty(row.bank_sort_code),
      bank_account_number: nullIfEmpty(row.bank_account_number),
      iban: null,
      swift_bic: null,
      ct_registered: decodeBooleanOrTbc(row.ct_registered, 'ct_registered', rowId),
      qfzp_elected: null,
    });
  }

  if (jurisdiction === 'UAE') {
    return UaeCompanySchema.parse({
      ...common,
      jurisdiction: 'UAE',
      kind: requireNonEmpty(row.kind, 'kind', rowId),
      currency: requireNonEmpty(row.currency, 'currency', rowId),
      company_number: null,
      vat_number: null,
      license_number: requireNonEmpty(row.license_number, 'license_number', rowId),
      registration_number: requireNonEmpty(row.registration_number, 'registration_number', rowId),
      bank_sort_code: null,
      bank_account_number: null,
      iban: decodeNullableStringOrTbc(row.iban),
      swift_bic: decodeNullableStringOrTbc(row.swift_bic),
      ct_registered: decodeBooleanOrTbc(row.ct_registered, 'ct_registered', rowId),
      qfzp_elected: decodeNullableBooleanOrTbc(row.qfzp_elected, 'qfzp_elected', rowId),
    });
  }

  throw new Error(`Company ${rowId}: unknown jurisdiction '${jurisdiction}'`);
}

// ─── File reader ────────────────────────────────────────────────────────────

export function readCompaniesCsvFile(csvPath: string): Company[] {
  if (!fs.existsSync(csvPath)) return [];
  const content = fs.readFileSync(csvPath, 'utf8').trim();
  if (content === '') return [];

  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as Record<string, string>[];

  const rows: Company[] = [];
  for (const row of records) {
    if (!nullIfEmpty(row.id)) continue;
    rows.push(parseCompanyRow(row));
  }
  return rows;
}

// ─── Cell encoders ──────────────────────────────────────────────────────────

function encodeOptional(value: string | null): string {
  return value ?? '';
}

function encodeBooleanOrTbc(value: boolean | 'TBC'): string {
  if (value === 'TBC') return 'TBC';
  return value ? 'true' : 'false';
}

function encodeNullableBooleanOrTbc(value: boolean | 'TBC' | null): string {
  if (value === null) return '';
  return encodeBooleanOrTbc(value);
}

function encodeStrictBoolean(value: boolean): string {
  return value ? 'true' : 'false';
}

/**
 * Serialize a single company row back to a CSV line, preserving `TBC`
 * literals and emitting empty strings for nulls so round-trip
 * parsing yields byte-identical data.
 */
export function serializeCompanyRow(company: Company): string {
  const cells: string[] = COMPANY_CSV_HEADERS.map(header => {
    switch (header) {
      case 'id':
        return company.id;
      case 'legal_name':
        return company.legal_name;
      case 'trading_name':
        return company.trading_name;
      case 'kind':
        return company.kind;
      case 'jurisdiction':
        return company.jurisdiction;
      case 'regulator':
        return company.regulator;
      case 'company_number':
        return company.jurisdiction === 'UK' ? company.company_number : '';
      case 'vat_number':
        return company.jurisdiction === 'UK' ? encodeOptional(company.vat_number) : '';
      case 'license_number':
        return company.jurisdiction === 'UAE' ? company.license_number : '';
      case 'registration_number':
        return company.jurisdiction === 'UAE' ? company.registration_number : '';
      case 'formation_date':
        return encodeOptional(company.formation_date);
      case 'address':
        return company.address;
      case 'currency':
        return company.currency;
      case 'bank_sort_code':
        return company.jurisdiction === 'UK' ? encodeOptional(company.bank_sort_code) : '';
      case 'bank_account_number':
        return company.jurisdiction === 'UK' ? encodeOptional(company.bank_account_number) : '';
      case 'iban':
        return company.jurisdiction === 'UAE' ? encodeOptional(company.iban) : '';
      case 'swift_bic':
        return company.jurisdiction === 'UAE' ? encodeOptional(company.swift_bic) : '';
      case 'email':
        return company.email;
      case 'logo_path':
        return encodeOptional(company.logo_path);
      case 'accountant_name':
        return encodeOptional(company.accountant_name);
      case 'accountant_email':
        return encodeOptional(company.accountant_email);
      case 'ct_registered':
        return encodeBooleanOrTbc(company.ct_registered);
      case 'qfzp_elected':
        return company.jurisdiction === 'UAE'
          ? encodeNullableBooleanOrTbc(company.qfzp_elected)
          : '';
      case 'vat_registered':
        return encodeBooleanOrTbc(company.vat_registered);
      case 'active':
        return encodeStrictBoolean(company.active);
      case 'updated_at':
        return encodeOptional(company.updated_at);
    }
  });
  return cells.map(escapeCsvField).join(',');
}

export function serializeCompaniesCsv(companies: readonly Company[]): string {
  const header = COMPANY_CSV_HEADERS.join(',');
  const body = companies.map(serializeCompanyRow).join('\n');
  return body === '' ? `${header}\n` : `${header}\n${body}\n`;
}

export function writeCompaniesCsvFile(csvPath: string, companies: readonly Company[]): void {
  atomicWriteCsv(csvPath, serializeCompaniesCsv(companies));
}
