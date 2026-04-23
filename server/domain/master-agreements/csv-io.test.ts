/**
 * CSV round-trip tests for master-agreements.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import {
  parseMasterAgreementRow,
  readMasterAgreementsCsvFile,
  serializeMasterAgreementsCsv,
  getMasterAgreementsCsvPath,
} from './csv-io.js';
import { mkTmpDir, dcMasterRow, seedCsv, rowFromHeaders } from './test-helpers.js';

describe('parseMasterAgreementRow', () => {
  it('parses the DC master seed row', () => {
    const m = parseMasterAgreementRow(dcMasterRow);
    expect(m.id).toBe('dc-master-2025');
    expect(m.client_id).toBe('delta-capita');
    expect(m.end_date).toBeNull();
    expect(m.company_notice_weeks).toBe(1);
    expect(m.active).toBe(true);
  });

  it('throws on missing client_id', () => {
    const { client_id: _c, ...rest } = dcMasterRow;
    void _c;
    expect(() => parseMasterAgreementRow(rest as Record<string, string>)).toThrow(
      /client_id is required/,
    );
  });

  it('throws on negative notice period', () => {
    expect(() =>
      parseMasterAgreementRow(rowFromHeaders({
        ...dcMasterRow,
        company_notice_weeks: '-1',
      })),
    ).toThrow(/non-negative integer/);
  });
});

describe('CSV round-trip', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = mkTmpDir(); });
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('serialise → parse is identity', () => {
    const m = parseMasterAgreementRow(dcMasterRow);
    const csv = serializeMasterAgreementsCsv([m]);
    const csvPath = getMasterAgreementsCsvPath(tmpDir);
    fs.writeFileSync(csvPath, csv, 'utf8');
    const rehydrated = readMasterAgreementsCsvFile(csvPath);
    expect(rehydrated).toEqual([m]);
  });

  it('returns [] when the CSV file is missing', () => {
    expect(readMasterAgreementsCsvFile(getMasterAgreementsCsvPath(tmpDir))).toEqual([]);
  });

  it('writes a readable file via seedCsv', () => {
    seedCsv(tmpDir, [dcMasterRow]);
    const parsed = readMasterAgreementsCsvFile(getMasterAgreementsCsvPath(tmpDir));
    expect(parsed.map(m => m.id)).toEqual(['dc-master-2025']);
  });
});
