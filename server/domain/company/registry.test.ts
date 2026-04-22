import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  buildCompanyRegistry,
  __resetCompanyRegistryForTests,
  getCompanyRegistry,
} from './registry.js';
import { writeCompaniesCsvFile, parseCompanyRow, getCompanyCsvPath, COMPANY_CSV_HEADERS } from './csv-io.js';

function mkTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'company-registry-'));
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

describe('buildCompanyRegistry', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns an empty registry when the CSV file is missing', () => {
    const reg = buildCompanyRegistry(tmpDir);
    expect(reg.all).toHaveLength(0);
    expect(reg.listEntityIds()).toEqual([]);
    expect(reg.getById('autonize-it-ltd')).toBeNull();
  });

  it('loads both entities from a seeded CSV', () => {
    writeCompaniesCsvFile(getCompanyCsvPath(tmpDir), [
      parseCompanyRow(ukRow),
      parseCompanyRow(uaeRow),
    ]);
    const reg = buildCompanyRegistry(tmpDir);
    expect(reg.all).toHaveLength(2);
    expect(reg.listEntityIds()).toEqual(['autonize-it-ltd', 'autonize-it-fzco']);
  });

  it('getById returns the matching entity and null for unknown ids', () => {
    writeCompaniesCsvFile(getCompanyCsvPath(tmpDir), [
      parseCompanyRow(ukRow),
      parseCompanyRow(uaeRow),
    ]);
    const reg = buildCompanyRegistry(tmpDir);
    expect(reg.getById('autonize-it-ltd')?.jurisdiction).toBe('UK');
    expect(reg.getById('autonize-it-fzco')?.jurisdiction).toBe('UAE');
  });

  it('getById returns the row with exact field values', () => {
    writeCompaniesCsvFile(getCompanyCsvPath(tmpDir), [
      parseCompanyRow(ukRow),
      parseCompanyRow(uaeRow),
    ]);
    const reg = buildCompanyRegistry(tmpDir);
    const uk = reg.getById('autonize-it-ltd');
    if (!uk || uk.jurisdiction !== 'UK') throw new Error('UK missing');
    expect(uk.vat_registered).toBe(true);
    expect(uk.company_number).toBe('08842112');

    const uae = reg.getById('autonize-it-fzco');
    if (!uae || uae.jurisdiction !== 'UAE') throw new Error('UAE missing');
    expect(uae.qfzp_elected).toBe('TBC');
    expect(uae.vat_registered).toBe(false);
  });

  it('listByJurisdiction filters by the UK or UAE discriminator', () => {
    writeCompaniesCsvFile(getCompanyCsvPath(tmpDir), [
      parseCompanyRow(ukRow),
      parseCompanyRow(uaeRow),
    ]);
    const reg = buildCompanyRegistry(tmpDir);
    expect(reg.listByJurisdiction('UK')).toHaveLength(1);
    expect(reg.listByJurisdiction('UAE')).toHaveLength(1);
    expect(reg.listByJurisdiction('UK')[0]?.id).toBe('autonize-it-ltd');
    expect(reg.listByJurisdiction('UAE')[0]?.id).toBe('autonize-it-fzco');
  });

  it('refuses a CSV with duplicate entity ids', () => {
    writeCompaniesCsvFile(getCompanyCsvPath(tmpDir), [
      parseCompanyRow(ukRow),
      parseCompanyRow(ukRow),
    ]);
    expect(() => buildCompanyRegistry(tmpDir)).toThrow(/duplicate id/);
  });
});

describe('getCompanyRegistry default singleton', () => {
  afterEach(() => {
    __resetCompanyRegistryForTests();
  });

  it('loads the committed seed file and returns both entities', () => {
    __resetCompanyRegistryForTests();
    const reg = getCompanyRegistry();
    expect(reg.all).toHaveLength(2);
    expect(reg.getById('autonize-it-ltd')?.legal_name).toBe('Autonize IT Limited');
    expect(reg.getById('autonize-it-fzco')?.jurisdiction).toBe('UAE');
  });

  it('caches the registry across calls', () => {
    __resetCompanyRegistryForTests();
    const first = getCompanyRegistry();
    const second = getCompanyRegistry();
    expect(first).toBe(second);
  });
});
