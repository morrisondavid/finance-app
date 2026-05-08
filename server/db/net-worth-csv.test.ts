import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  ensureNetWorthSnapshotsCsvWithHeader,
  getNetWorthSnapshotsCsvPath,
  readNetWorthSnapshotsFromCsvFile,
  writeNetWorthSnapshotsToCsvFile,
  rowDiskKey,
  type NetWorthSnapshotCsvRow,
} from './net-worth-csv.js';

describe('net-worth snapshots CSV', () => {
  let tmpDir: string;
  let csvPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'net-worth-csv-test-'));
    csvPath = getNetWorthSnapshotsCsvPath(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates header-only file via ensureNetWorthSnapshotsCsvWithHeader', () => {
    ensureNetWorthSnapshotsCsvWithHeader(tmpDir);
    const text = fs.readFileSync(csvPath, 'utf8').trim();
    expect(text.startsWith('period_key,')).toBe(true);
    expect(readNetWorthSnapshotsFromCsvFile(csvPath)).toEqual([]);
  });

  it('round-trips rows and sorts on write', () => {
    const a: NetWorthSnapshotCsvRow = {
      periodKey: '2026-W02',
      snapshotDate: '2026-01-12',
      entityId: 'global',
      reportingCurrency: 'GBP',
      cadence: 'weekly',
      totalCashGbp: 100,
      totalCreditGbp: -10,
      totalObligations12mGbp: 20,
      totalDebtGbp: 30,
      netGbp: 40,
      formulaVersion: '1.0.0',
      capturedAt: '2026-01-12T10:00:00.000Z',
    };
    const b: NetWorthSnapshotCsvRow = {
      ...a,
      periodKey: '2026-W01',
      entityId: 'autonize-it-ltd',
      netGbp: 5,
    };
    writeNetWorthSnapshotsToCsvFile(csvPath, [a, b]);
    const parsed = readNetWorthSnapshotsFromCsvFile(csvPath);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].periodKey).toBe('2026-W01');
    expect(parsed[1].periodKey).toBe('2026-W02');
    expect(parsed[1].entityId).toBe('global');
  });

  it('rowDiskKey matches dedupe semantics', () => {
    const row: NetWorthSnapshotCsvRow = {
      periodKey: '2026-W19',
      snapshotDate: '2026-05-11',
      entityId: 'autonize-it-fzco',
      reportingCurrency: 'GBP',
      cadence: 'weekly',
      totalCashGbp: 1,
      totalCreditGbp: 2,
      totalObligations12mGbp: 3,
      totalDebtGbp: 4,
      netGbp: -4,
      formulaVersion: '1.0.0',
      capturedAt: 'x',
    };
    expect(rowDiskKey(row)).toBe('2026-W19\tautonize-it-fzco\tGBP');
  });
});
