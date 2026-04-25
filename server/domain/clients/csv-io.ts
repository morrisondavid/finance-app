/**
 * CSV I/O for `clients/clients.csv` — the client registry covering
 * both direct (the payer is also the end client) and agency
 * (intermediary payer + end-client block) shapes in a single flat CSV.
 *
 * Columns that don't apply to a given client `kind` are left empty and
 * round-trip back to `null` via `nullIfEmpty`. As with company.csv, the
 * literal string `TBC` is a first-class value and survives round-trip
 * byte-for-byte so the Warnings Engine can distinguish "unresolved"
 * from "not applicable" / `null`.
 */

import path from 'path';
import {
  type Client,
  DirectClientSchema,
  AgencyClientSchema,
} from '../../../shared/api-contracts.js';
import { escapeCsvField, atomicWriteCsv } from '../../utils/csv-helpers.js';
import {
  createCsvDecoders,
  nullIfEmpty,
  readCsvRecords,
} from '../../utils/csv-decoders.js';

const decoders = createCsvDecoders('Client');
const {
  requireNonEmpty,
  decodeNullableIsoDate,
  decodeStrictBoolean,
} = decoders;

/** `TBC` is preserved verbatim; empty cell → null. Pure string passthrough. */
function decodeNullableStringOrTbc(value: string | undefined): string | 'TBC' | null {
  return nullIfEmpty(value);
}

/** `TBC` is preserved verbatim; empty cell → required-field error. */
function decodeRequiredStringOrTbc(
  value: string | undefined,
  field: string,
  rowId: string,
): string | 'TBC' {
  return requireNonEmpty(value, field, rowId);
}

export const CLIENTS_CSV_FILENAME = 'clients.csv';

export const CLIENT_CSV_HEADERS = [
  'id',
  'legal_name',
  'trading_name',
  'kind',
  'vat_number',
  'billing_address',
  'primary_contact_name',
  'primary_contact_email',
  'secondary_contact_name',
  'secondary_contact_email',
  'hr_contact_name',
  'hr_contact_email',
  'accounts_contact_name',
  'accounts_contact_email',
  'cc_emails',
  'end_client_legal_name',
  'end_client_address',
  'end_client_primary_contact_name',
  'end_client_primary_contact_email',
  'end_client_secondary_contact_name',
  'end_client_secondary_contact_email',
  'holiday_system_url',
  'client_assigned_email',
  'active',
  'updated_at',
] as const;

export function getClientsCsvPath(clientsDir: string): string {
  return path.join(clientsDir, CLIENTS_CSV_FILENAME);
}

// ─── Row parser ─────────────────────────────────────────────────────────────

/**
 * Rehydrate a flat CSV row into the correct discriminated-union variant
 * (direct | agency) and validate with Zod. Throws with a precise message
 * pointing at the offending row/field on any violation.
 */
export function parseClientRow(row: Record<string, string>): Client {
  const rowId = nullIfEmpty(row.id) ?? '<missing-id>';
  const kind = requireNonEmpty(row.kind, 'kind', rowId);

  const common = {
    id: requireNonEmpty(row.id, 'id', rowId),
    legal_name: requireNonEmpty(row.legal_name, 'legal_name', rowId),
    trading_name: requireNonEmpty(row.trading_name, 'trading_name', rowId),
    vat_number: decodeNullableStringOrTbc(row.vat_number),
    billing_address: requireNonEmpty(row.billing_address, 'billing_address', rowId),
    primary_contact_name: decodeRequiredStringOrTbc(row.primary_contact_name, 'primary_contact_name', rowId),
    primary_contact_email: decodeRequiredStringOrTbc(row.primary_contact_email, 'primary_contact_email', rowId),
    secondary_contact_name: decodeNullableStringOrTbc(row.secondary_contact_name),
    secondary_contact_email: decodeNullableStringOrTbc(row.secondary_contact_email),
    hr_contact_name: decodeNullableStringOrTbc(row.hr_contact_name),
    hr_contact_email: decodeNullableStringOrTbc(row.hr_contact_email),
    accounts_contact_name: decodeNullableStringOrTbc(row.accounts_contact_name),
    accounts_contact_email: decodeNullableStringOrTbc(row.accounts_contact_email),
    cc_emails: nullIfEmpty(row.cc_emails),
    holiday_system_url: decodeNullableStringOrTbc(row.holiday_system_url),
    client_assigned_email: decodeNullableStringOrTbc(row.client_assigned_email),
    active: decodeStrictBoolean(row.active, 'active', rowId),
    updated_at: decodeNullableIsoDate(row.updated_at, 'updated_at', rowId),
  };

  if (kind === 'direct') {
    return DirectClientSchema.parse({
      ...common,
      kind: 'direct',
      end_client_legal_name: null,
      end_client_address: null,
      end_client_primary_contact_name: null,
      end_client_primary_contact_email: null,
      end_client_secondary_contact_name: null,
      end_client_secondary_contact_email: null,
    });
  }

  if (kind === 'agency') {
    return AgencyClientSchema.parse({
      ...common,
      kind: 'agency',
      end_client_legal_name: requireNonEmpty(row.end_client_legal_name, 'end_client_legal_name', rowId),
      end_client_address: requireNonEmpty(row.end_client_address, 'end_client_address', rowId),
      end_client_primary_contact_name: decodeRequiredStringOrTbc(row.end_client_primary_contact_name, 'end_client_primary_contact_name', rowId),
      end_client_primary_contact_email: decodeRequiredStringOrTbc(row.end_client_primary_contact_email, 'end_client_primary_contact_email', rowId),
      end_client_secondary_contact_name: decodeNullableStringOrTbc(row.end_client_secondary_contact_name),
      end_client_secondary_contact_email: decodeNullableStringOrTbc(row.end_client_secondary_contact_email),
    });
  }

  throw new Error(`Client ${rowId}: unknown kind '${kind}' (must be 'direct' or 'agency')`);
}

// ─── File reader ────────────────────────────────────────────────────────────

export function readClientsCsvFile(csvPath: string): Client[] {
  const rows: Client[] = [];
  for (const row of readCsvRecords(csvPath)) {
    if (!nullIfEmpty(row.id)) continue;
    rows.push(parseClientRow(row));
  }
  return rows;
}

// ─── Cell encoders ──────────────────────────────────────────────────────────

function encodeOptional(value: string | null): string {
  return value ?? '';
}

function encodeStrictBoolean(value: boolean): string {
  return value ? 'true' : 'false';
}

export function serializeClientRow(client: Client): string {
  const cells: string[] = CLIENT_CSV_HEADERS.map(header => {
    switch (header) {
      case 'id':
        return client.id;
      case 'legal_name':
        return client.legal_name;
      case 'trading_name':
        return client.trading_name;
      case 'kind':
        return client.kind;
      case 'vat_number':
        return encodeOptional(client.vat_number);
      case 'billing_address':
        return client.billing_address;
      case 'primary_contact_name':
        return client.primary_contact_name;
      case 'primary_contact_email':
        return client.primary_contact_email;
      case 'secondary_contact_name':
        return encodeOptional(client.secondary_contact_name);
      case 'secondary_contact_email':
        return encodeOptional(client.secondary_contact_email);
      case 'hr_contact_name':
        return encodeOptional(client.hr_contact_name);
      case 'hr_contact_email':
        return encodeOptional(client.hr_contact_email);
      case 'accounts_contact_name':
        return encodeOptional(client.accounts_contact_name);
      case 'accounts_contact_email':
        return encodeOptional(client.accounts_contact_email);
      case 'cc_emails':
        return encodeOptional(client.cc_emails);
      case 'end_client_legal_name':
        return client.kind === 'agency' ? client.end_client_legal_name : '';
      case 'end_client_address':
        return client.kind === 'agency' ? client.end_client_address : '';
      case 'end_client_primary_contact_name':
        return client.kind === 'agency' ? client.end_client_primary_contact_name : '';
      case 'end_client_primary_contact_email':
        return client.kind === 'agency' ? client.end_client_primary_contact_email : '';
      case 'end_client_secondary_contact_name':
        return client.kind === 'agency'
          ? encodeOptional(client.end_client_secondary_contact_name)
          : '';
      case 'end_client_secondary_contact_email':
        return client.kind === 'agency'
          ? encodeOptional(client.end_client_secondary_contact_email)
          : '';
      case 'holiday_system_url':
        return encodeOptional(client.holiday_system_url);
      case 'client_assigned_email':
        return encodeOptional(client.client_assigned_email);
      case 'active':
        return encodeStrictBoolean(client.active);
      case 'updated_at':
        return encodeOptional(client.updated_at);
    }
  });
  return cells.map(escapeCsvField).join(',');
}

export function serializeClientsCsv(clients: readonly Client[]): string {
  const header = CLIENT_CSV_HEADERS.join(',');
  const body = clients.map(serializeClientRow).join('\n');
  return body === '' ? `${header}\n` : `${header}\n${body}\n`;
}

export function writeClientsCsvFile(csvPath: string, clients: readonly Client[]): void {
  atomicWriteCsv(csvPath, serializeClientsCsv(clients));
}
