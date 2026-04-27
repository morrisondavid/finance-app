/**
 * CSV round-trip tests for the clients domain.
 *
 * Parsing produces typed `Client` values; serialising them back
 * produces byte-identical CSV (modulo whitespace normalisation).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import {
  parseClientRow,
  readClientsCsvFile,
  serializeClientsCsv,
  getClientsCsvPath,
} from './csv-io.js';
import {
  mkTmpDir,
  directRow,
  agencyRow,
  agencyInactiveRow,
  seedCsv,
} from './test-helpers.js';

describe('parseClientRow', () => {
  it('parses a direct client with its end-client block nulled', () => {
    const c = parseClientRow(directRow);
    expect(c.kind).toBe('direct');
    expect(c.id).toBe('delta-capita');
    if (c.kind === 'direct') {
      expect(c.end_client_legal_name).toBeNull();
      expect(c.end_client_primary_contact_email).toBeNull();
    }
    expect(c.primary_contact_email).toBe('lily.lovegrove@deltacapita.com');
    expect(c.hr_contact_name).toBe('William Swift');
    expect(c.cc_emails).toBe('hrandrecruitment@deltacapita.com,dan.hedley@deltacapita.com');
    expect(c.vat_number).toBe('TBC');
  });

  it('parses an agency client with its end-client block populated', () => {
    const c = parseClientRow(agencyRow);
    expect(c.kind).toBe('agency');
    if (c.kind === 'agency') {
      expect(c.end_client_legal_name).toBe('The Edwin Group Ltd');
      expect(c.end_client_primary_contact_name).toBe('Aidan Gray');
      expect(c.end_client_primary_contact_email).toBe('TBC');
    }
    expect(c.primary_contact_email).toBe('TBC');
  });

  it('throws on missing required column', () => {
    const { id: _id, ...rest } = directRow;
    void _id;
    expect(() => parseClientRow(rest as Record<string, string>)).toThrow(/id is required/);
  });

  it('throws on unknown `kind`', () => {
    expect(() => parseClientRow({ ...directRow, kind: 'bogus' })).toThrow(/unknown kind/);
  });
});

describe('CSV round-trip', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = mkTmpDir(); });
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('serialise → parse is identity for direct + agency rows', () => {
    const direct = parseClientRow(directRow);
    const agency = parseClientRow(agencyRow);
    const csv = serializeClientsCsv([direct, agency]);
    const csvPath = getClientsCsvPath(tmpDir);
    fs.writeFileSync(csvPath, csv, 'utf8');
    const rehydrated = readClientsCsvFile(csvPath);
    expect(rehydrated).toEqual([direct, agency]);
  });

  it('inactive rows round-trip with active=false preserved', () => {
    const inactive = parseClientRow(agencyInactiveRow);
    const csv = serializeClientsCsv([inactive]);
    const csvPath = getClientsCsvPath(tmpDir);
    fs.writeFileSync(csvPath, csv, 'utf8');
    const rehydrated = readClientsCsvFile(csvPath);
    expect(rehydrated[0]?.active).toBe(false);
  });

  it('writeClientsCsvFile produces a readable file', () => {
    seedCsv(tmpDir, [directRow, agencyRow]);
    const parsed = readClientsCsvFile(getClientsCsvPath(tmpDir));
    expect(parsed.map(c => c.id)).toEqual(['delta-capita', 'la-fosse']);
  });

  it('returns [] when the CSV file is missing', () => {
    expect(readClientsCsvFile(getClientsCsvPath(tmpDir))).toEqual([]);
  });

  it('returns [] when the CSV file is empty', () => {
    const csvPath = getClientsCsvPath(tmpDir);
    fs.writeFileSync(csvPath, '', 'utf8');
    expect(readClientsCsvFile(csvPath)).toEqual([]);
  });
});
