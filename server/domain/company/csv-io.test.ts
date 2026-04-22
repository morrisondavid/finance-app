import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  parseCompanyRow,
  readCompaniesCsvFile,
  serializeCompaniesCsv,
  writeCompaniesCsvFile,
  getCompanyCsvPath,
  COMPANY_CSV_HEADERS,
} from './csv-io.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function mkTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'company-csv-'));
}

function rowFromHeaders(values: Partial<Record<(typeof COMPANY_CSV_HEADERS)[number], string>>): Record<string, string> {
  const row: Record<string, string> = {};
  for (const h of COMPANY_CSV_HEADERS) {
    row[h] = values[h] ?? '';
  }
  return row;
}

const ukRow = rowFromHeaders({
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

const uaeRow = rowFromHeaders({
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

describe('parseCompanyRow', () => {
  it('parses the UK Ltd seed row with all jurisdiction-specific fields populated', () => {
    const c = parseCompanyRow(ukRow);
    expect(c.jurisdiction).toBe('UK');
    expect(c.id).toBe('autonize-it-ltd');
    if (c.jurisdiction === 'UK') {
      expect(c.company_number).toBe('08842112');
      expect(c.vat_number).toBe('292 1465 96');
      expect(c.license_number).toBeNull();
      expect(c.registration_number).toBeNull();
      expect(c.iban).toBeNull();
      expect(c.swift_bic).toBeNull();
      expect(c.bank_sort_code).toBe('20-25-19');
      expect(c.bank_account_number).toBe('63648923');
      expect(c.qfzp_elected).toBeNull();
      expect(c.ct_registered).toBe(true);
    }
    expect(c.vat_registered).toBe(true);
    expect(c.active).toBe(true);
    expect(c.currency).toBe('GBP');
  });

  it('parses the UAE FZCO seed row with UAE-only identifiers', () => {
    const c = parseCompanyRow(uaeRow);
    expect(c.jurisdiction).toBe('UAE');
    expect(c.id).toBe('autonize-it-fzco');
    if (c.jurisdiction === 'UAE') {
      expect(c.license_number).toBe('73348');
      expect(c.registration_number).toBe('71347');
      expect(c.company_number).toBeNull();
      expect(c.vat_number).toBeNull();
      expect(c.bank_sort_code).toBeNull();
      expect(c.bank_account_number).toBeNull();
      expect(c.iban).toBe('TBC');
      expect(c.swift_bic).toBe('TBC');
      expect(c.ct_registered).toBe('TBC');
      expect(c.qfzp_elected).toBe('TBC');
    }
    expect(c.vat_registered).toBe(false);
    expect(c.currency).toBe('AED');
  });

  it('preserves the literal TBC for formation_date', () => {
    const c = parseCompanyRow(ukRow);
    expect(c.formation_date).toBe('TBC');
  });

  it('preserves the literal TBC for accountant_name and accountant_email', () => {
    const c = parseCompanyRow(uaeRow);
    expect(c.accountant_name).toBe('TBC');
    expect(c.accountant_email).toBe('TBC');
  });

  it('rejects a row with an unknown jurisdiction', () => {
    const bad = { ...ukRow, jurisdiction: 'US' };
    expect(() => parseCompanyRow(bad)).toThrow(/unknown jurisdiction/);
  });

  it('rejects a UK row missing company_number', () => {
    const bad = { ...ukRow, company_number: '' };
    expect(() => parseCompanyRow(bad)).toThrow(/company_number is required/);
  });

  it('rejects a UAE row missing license_number', () => {
    const bad = { ...uaeRow, license_number: '' };
    expect(() => parseCompanyRow(bad)).toThrow(/license_number is required/);
  });

  it('rejects a row with ct_registered that is neither true, false, nor TBC', () => {
    const bad = { ...uaeRow, ct_registered: 'maybe' };
    expect(() => parseCompanyRow(bad)).toThrow(/ct_registered must be/);
  });

  it('rejects a row with formation_date that is neither yyyy-mm-dd nor TBC', () => {
    const bad = { ...uaeRow, formation_date: 'not-a-date' };
    expect(() => parseCompanyRow(bad)).toThrow(/formation_date must be/);
  });

  it('rejects a row with a non-boolean active column', () => {
    const bad = { ...ukRow, active: 'TBC' };
    expect(() => parseCompanyRow(bad)).toThrow(/active must be/);
  });
});

describe('readCompaniesCsvFile + writeCompaniesCsvFile round-trip', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns an empty array when the file is missing', () => {
    const companies = readCompaniesCsvFile(getCompanyCsvPath(tmpDir));
    expect(companies).toEqual([]);
  });

  it('parses both seed rows from a hand-written CSV', () => {
    const companies = [parseCompanyRow(ukRow), parseCompanyRow(uaeRow)];
    writeCompaniesCsvFile(getCompanyCsvPath(tmpDir), companies);
    const reread = readCompaniesCsvFile(getCompanyCsvPath(tmpDir));
    expect(reread).toHaveLength(2);
    expect(reread[0]?.id).toBe('autonize-it-ltd');
    expect(reread[1]?.id).toBe('autonize-it-fzco');
  });

  it('round-trips the UK row byte-identically (serialize -> parse -> serialize)', () => {
    const uk = parseCompanyRow(ukRow);
    const serialized = serializeCompaniesCsv([uk]);
    writeCompaniesCsvFile(getCompanyCsvPath(tmpDir), [uk]);
    const reread = readCompaniesCsvFile(getCompanyCsvPath(tmpDir));
    expect(reread).toHaveLength(1);
    expect(reread[0]).toEqual(uk);
    expect(serializeCompaniesCsv(reread)).toBe(serialized);
  });

  it('round-trips the UAE row and preserves every TBC literal', () => {
    const uae = parseCompanyRow(uaeRow);
    writeCompaniesCsvFile(getCompanyCsvPath(tmpDir), [uae]);
    const reread = readCompaniesCsvFile(getCompanyCsvPath(tmpDir));
    expect(reread).toHaveLength(1);
    const r = reread[0];
    if (!r || r.jurisdiction !== 'UAE') throw new Error('expected UAE row');
    expect(r.iban).toBe('TBC');
    expect(r.swift_bic).toBe('TBC');
    expect(r.ct_registered).toBe('TBC');
    expect(r.qfzp_elected).toBe('TBC');
    expect(r.accountant_name).toBe('TBC');
    expect(r.accountant_email).toBe('TBC');
  });

  it('emits empty strings (not the word "null") for null cells', () => {
    const uk = parseCompanyRow(ukRow);
    const csv = serializeCompaniesCsv([uk]);
    expect(csv).not.toMatch(/,null,/);
    expect(csv).not.toMatch(/null\n/);
  });

  it('CSV-escapes addresses that contain commas', () => {
    const uk = parseCompanyRow(ukRow);
    const csv = serializeCompaniesCsv([uk]);
    expect(csv).toContain('"53 Heath Park Road, Romford, RM2 5UL"');
  });
});

describe('Committed seed file autonize-it/company.csv', () => {
  const seedPath = path.join(HERE, '../../../autonize-it/company.csv');

  it('exists on disk', () => {
    expect(fs.existsSync(seedPath)).toBe(true);
  });

  it('parses both seed rows without error', () => {
    const companies = readCompaniesCsvFile(seedPath);
    expect(companies).toHaveLength(2);
    const ids = companies.map(c => c.id).sort();
    expect(ids).toEqual(['autonize-it-fzco', 'autonize-it-ltd']);
  });

  it('UK row matches the roadmap spec', () => {
    const companies = readCompaniesCsvFile(seedPath);
    const uk = companies.find(c => c.id === 'autonize-it-ltd');
    if (!uk || uk.jurisdiction !== 'UK') throw new Error('UK seed row missing');
    expect(uk.legal_name).toBe('Autonize IT Limited');
    expect(uk.company_number).toBe('08842112');
    expect(uk.vat_number).toBe('292 1465 96');
    expect(uk.vat_registered).toBe(true);
    expect(uk.ct_registered).toBe(true);
    expect(uk.address).toBe('53 Heath Park Road, Romford, RM2 5UL');
    expect(uk.currency).toBe('GBP');
  });

  it('UAE row matches the roadmap spec, with every TBC field now resolved', () => {
    // All TBC gates have landed: CT registration + QFZP election are
    // `true`, and VAT is explicitly `false` (FZCO is not UAE-VAT-
    // registered — trailing-12m income sits below the AED 375k
    // mandatory threshold and La Fosse's self-bill agreement assumes
    // reverse-charge). If the FZCO ever registers for VAT this flips
    // to `true` in company.csv and this assertion flips with it.
    const companies = readCompaniesCsvFile(seedPath);
    const uae = companies.find(c => c.id === 'autonize-it-fzco');
    if (!uae || uae.jurisdiction !== 'UAE') throw new Error('UAE seed row missing');
    expect(uae.license_number).toBe('73348');
    expect(uae.registration_number).toBe('71347');
    expect(uae.formation_date).toBe('2025-11-04');
    expect(uae.ct_registered).toBe(true);
    expect(uae.iban).toBe('AE630340003508511754701');
    expect(uae.swift_bic).toBe('MEBLAEADXXX');
    expect(uae.accountant_email).toBe('marian@mceadvisory.com');
    expect(uae.qfzp_elected).toBe(true);
    expect(uae.vat_registered).toBe(false);
    expect(uae.currency).toBe('AED');
  });
});
