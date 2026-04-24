/**
 * Gate logic for each index on the leave registry.
 *
 * One describe block per index, plus an FK-validation section covering
 * the upstream contracts-registry join.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import { buildLeaveRegistry } from './registry.js';
import {
  dcHolidayRow,
  dcPastSickRow,
  lfHolidayRow,
  makeStubContracts,
  mkTmpDir,
  rowFromHeaders,
  seedCsv,
} from './test-helpers.js';

function buildWithStubs(tmpDir: string, today = '2026-04-21') {
  return buildLeaveRegistry(tmpDir, { contracts: makeStubContracts(), today });
}

describe('leave registry gates', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = mkTmpDir(); });
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('returns an empty registry when the CSV file is missing', () => {
    const reg = buildWithStubs(tmpDir);
    expect(reg.all).toHaveLength(0);
    expect(reg.indexes.byId.size).toBe(0);
    expect(reg.indexes.byContract.size).toBe(0);
    expect(reg.indexes.byDate.size).toBe(0);
    expect(reg.indexes.futureByContract.size).toBe(0);
  });

  it('preserves CSV order in `all`', () => {
    seedCsv(tmpDir, [dcHolidayRow, lfHolidayRow]);
    const reg = buildWithStubs(tmpDir);
    expect(reg.all.map(r => r.id)).toEqual([
      'dc-sow-2026-2026-05-04',
      'lf-2026-mar-2026-03-20',
    ]);
  });

  it('refuses a CSV with duplicate leave ids', () => {
    seedCsv(tmpDir, [dcHolidayRow, dcHolidayRow]);
    expect(() => buildWithStubs(tmpDir)).toThrow(/duplicate/i);
  });

  describe('FK validation', () => {
    it('throws when contract_id does not exist in the contracts registry', () => {
      const orphaned = rowFromHeaders({
        ...dcHolidayRow,
        id: 'ghost-2026-05-04',
        contract_id: 'ghost',
      });
      seedCsv(tmpDir, [orphaned]);
      expect(() => buildWithStubs(tmpDir)).toThrow(/unknown contract_id 'ghost'/);
    });
  });

  describe('indexes.byId', () => {
    it('gives O(1) access to each leave row', () => {
      seedCsv(tmpDir, [dcHolidayRow, lfHolidayRow]);
      const reg = buildWithStubs(tmpDir);
      expect(reg.indexes.byId.get('dc-sow-2026-2026-05-04')?.type).toBe('holiday');
      expect(reg.indexes.byId.get('lf-2026-mar-2026-03-20')?.contract_id).toBe('lf-2026-mar');
    });
  });

  describe('indexes.byContract', () => {
    it('groups leave rows by contract_id', () => {
      seedCsv(tmpDir, [dcHolidayRow, dcPastSickRow, lfHolidayRow]);
      const reg = buildWithStubs(tmpDir);
      expect(reg.indexes.byContract.get('dc-sow-2026')).toHaveLength(2);
      expect(reg.indexes.byContract.get('lf-2026-mar')).toHaveLength(1);
    });

    it('orders rows within a contract by date ascending', () => {
      seedCsv(tmpDir, [dcHolidayRow, dcPastSickRow]);
      const reg = buildWithStubs(tmpDir);
      const series = reg.indexes.byContract.get('dc-sow-2026') ?? [];
      expect(series.map(r => r.date)).toEqual(['2026-03-10', '2026-05-04']);
    });
  });

  describe('indexes.byDate', () => {
    it('groups leave rows by date across contracts', () => {
      seedCsv(tmpDir, [dcHolidayRow, lfHolidayRow]);
      const reg = buildWithStubs(tmpDir);
      expect(reg.indexes.byDate.get('2026-05-04')).toHaveLength(1);
      expect(reg.indexes.byDate.get('2026-03-20')).toHaveLength(1);
    });
  });

  describe('indexes.futureByContract', () => {
    it('includes only rows with date >= today', () => {
      seedCsv(tmpDir, [dcHolidayRow, dcPastSickRow]);
      const reg = buildWithStubs(tmpDir, '2026-04-21');
      const future = reg.indexes.futureByContract.get('dc-sow-2026') ?? [];
      expect(future.map(r => r.date)).toEqual(['2026-05-04']);
    });

    it('includes rows dated exactly today (inclusive lower bound)', () => {
      const todayRow = rowFromHeaders({
        ...dcHolidayRow,
        id: 'dc-sow-2026-2026-04-21',
        date: '2026-04-21',
      });
      seedCsv(tmpDir, [todayRow]);
      const reg = buildWithStubs(tmpDir, '2026-04-21');
      expect(reg.indexes.futureByContract.get('dc-sow-2026')).toHaveLength(1);
    });
  });
});
