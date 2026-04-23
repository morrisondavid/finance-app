/**
 * CSV round-trip tests for the contracts domain.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import {
  parseContractRow,
  readContractsCsvFile,
  serializeContractsCsv,
  getContractsCsvPath,
} from './csv-io.js';
import {
  mkTmpDir,
  dcSowRow,
  lfContractRow,
  lfExtensionRow,
  seedCsv,
} from './test-helpers.js';

describe('parseContractRow', () => {
  it('parses the DC SOW seed row', () => {
    const c = parseContractRow(dcSowRow);
    expect(c.id).toBe('dc-sow-2026');
    expect(c.master_id).toBe('dc-master-2025');
    expect(c.day_rate).toBe(600);
    expect(c.invoice_cadence).toBe('monthly');
    expect(c.conduct_regs).toBe('opted-out');
  });

  it('parses the LF contract with null master_id', () => {
    const c = parseContractRow(lfContractRow);
    expect(c.master_id).toBeNull();
    expect(c.invoice_mechanism).toBe('self-bill');
  });

  it('throws on invalid renewal_warning_days', () => {
    expect(() =>
      parseContractRow({ ...dcSowRow, renewal_warning_days: '-1' }),
    ).toThrow(/non-negative integer/);
  });

  it('throws on invalid day_rate', () => {
    expect(() =>
      parseContractRow({ ...dcSowRow, day_rate: 'not-a-number' }),
    ).toThrow(/non-negative number/);
  });

  it('throws on missing client_id', () => {
    const { client_id: _c, ...rest } = dcSowRow;
    void _c;
    expect(() => parseContractRow(rest as Record<string, string>)).toThrow(
      /client_id is required/,
    );
  });
});

describe('CSV round-trip', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = mkTmpDir(); });
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('serialise → parse is identity for multiple rows', () => {
    const rows = [
      parseContractRow(dcSowRow),
      parseContractRow(lfContractRow),
      parseContractRow(lfExtensionRow),
    ];
    const csv = serializeContractsCsv(rows);
    const csvPath = getContractsCsvPath(tmpDir);
    fs.writeFileSync(csvPath, csv, 'utf8');
    const rehydrated = readContractsCsvFile(csvPath);
    expect(rehydrated).toEqual(rows);
  });

  it('returns [] when the CSV file is missing', () => {
    expect(readContractsCsvFile(getContractsCsvPath(tmpDir))).toEqual([]);
  });

  it('returns [] when the CSV file is empty', () => {
    const csvPath = getContractsCsvPath(tmpDir);
    fs.writeFileSync(csvPath, '', 'utf8');
    expect(readContractsCsvFile(csvPath)).toEqual([]);
  });

  it('writes a readable file via seedCsv', () => {
    seedCsv(tmpDir, [dcSowRow, lfContractRow]);
    const parsed = readContractsCsvFile(getContractsCsvPath(tmpDir));
    expect(parsed.map(c => c.id)).toEqual(['dc-sow-2026', 'lf-2026-mar']);
  });
});
