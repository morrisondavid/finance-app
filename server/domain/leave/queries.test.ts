/**
 * Query purity + write-path behaviour for the leave domain.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import {
  allLeave,
  deleteLeaveRow,
  findLeaveById,
  leaveForContract,
  leaveInWindow,
  upsertLeaveRows,
} from './queries.js';
import { makeTestLeaveRegistry } from './fixtures.js';
import {
  getLeaveCsvPath,
  parseLeaveRow,
  readLeaveCsvFile,
} from './csv-io.js';
import {
  dcHolidayRow,
  dcPastSickRow,
  lfHolidayRow,
  makeStubContracts,
  mkTmpDir,
  seedCsv,
} from './test-helpers.js';

const contracts = makeStubContracts();

describe('read-side queries', () => {
  const reg = makeTestLeaveRegistry({
    leave: [
      parseLeaveRow(dcHolidayRow),
      parseLeaveRow(dcPastSickRow),
      parseLeaveRow(lfHolidayRow),
    ],
    contracts,
    today: '2026-04-21',
  });

  it('allLeave returns rows in CSV order', () => {
    expect(allLeave(reg).map(r => r.id)).toEqual([
      'dc-sow-2026-2026-05-04',
      'dc-sow-2026-2026-03-10',
      'lf-2026-mar-2026-03-20',
    ]);
  });

  it('findLeaveById returns null for unknown ids', () => {
    expect(findLeaveById('nope-2026-01-01', reg)).toBeNull();
  });

  it('findLeaveById returns the row for a known id', () => {
    expect(findLeaveById('dc-sow-2026-2026-05-04', reg)?.type).toBe('holiday');
  });

  it('leaveForContract returns an empty array for unknown contract', () => {
    expect(leaveForContract('ghost', reg)).toEqual([]);
  });

  it('leaveForContract orders by date ascending', () => {
    const rows = leaveForContract('dc-sow-2026', reg);
    expect(rows.map(r => r.date)).toEqual(['2026-03-10', '2026-05-04']);
  });

  it('leaveInWindow clips to the inclusive range', () => {
    const rows = leaveInWindow('dc-sow-2026', '2026-04-01', '2026-05-31', reg);
    expect(rows.map(r => r.date)).toEqual(['2026-05-04']);
  });

  it('leaveInWindow is inclusive on both endpoints', () => {
    const rows = leaveInWindow('dc-sow-2026', '2026-03-10', '2026-05-04', reg);
    expect(rows.map(r => r.date)).toEqual(['2026-03-10', '2026-05-04']);
  });
});

describe('upsertLeaveRows write path', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = mkTmpDir(); });
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('inserts new rows into an empty CSV', () => {
    const rebuilt = upsertLeaveRows({
      rows: [parseLeaveRow(dcHolidayRow)],
      workingDaysDir: tmpDir,
      input: { contracts },
    });
    expect(rebuilt.all).toHaveLength(1);
    const onDisk = readLeaveCsvFile(getLeaveCsvPath(tmpDir));
    expect(onDisk).toHaveLength(1);
    expect(onDisk[0]?.id).toBe('dc-sow-2026-2026-05-04');
  });

  it('replaces a row with the same id (re-booking the same date)', () => {
    seedCsv(tmpDir, [dcHolidayRow]);
    const replacement = parseLeaveRow({ ...dcHolidayRow, type: 'sick', notes: 'swapped' });
    const rebuilt = upsertLeaveRows({
      rows: [replacement],
      workingDaysDir: tmpDir,
      input: { contracts },
    });
    expect(rebuilt.all).toHaveLength(1);
    expect(rebuilt.all[0]?.type).toBe('sick');
    expect(rebuilt.all[0]?.notes).toBe('swapped');
  });

  it('preserves unrelated rows on a targeted upsert', () => {
    seedCsv(tmpDir, [dcHolidayRow, lfHolidayRow]);
    upsertLeaveRows({
      rows: [parseLeaveRow(dcPastSickRow)],
      workingDaysDir: tmpDir,
      input: { contracts },
    });
    const onDisk = readLeaveCsvFile(getLeaveCsvPath(tmpDir));
    expect(onDisk).toHaveLength(3);
  });

  it('rejects rows referencing unknown contract_id (FK enforcement runs on write)', () => {
    const orphan = parseLeaveRow({
      ...dcHolidayRow,
      id: 'ghost-2026-05-04',
      contract_id: 'ghost',
    });
    expect(() =>
      upsertLeaveRows({ rows: [orphan], workingDaysDir: tmpDir, input: { contracts } }),
    ).toThrow(/unknown contract_id/);
  });
});

describe('deleteLeaveRow write path', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = mkTmpDir(); });
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('removes the row with the matching id', () => {
    seedCsv(tmpDir, [dcHolidayRow, lfHolidayRow]);
    const rebuilt = deleteLeaveRow({
      id: 'dc-sow-2026-2026-05-04',
      workingDaysDir: tmpDir,
      input: { contracts },
    });
    expect(rebuilt.all.map(r => r.id)).toEqual(['lf-2026-mar-2026-03-20']);
    const onDisk = readLeaveCsvFile(getLeaveCsvPath(tmpDir));
    expect(onDisk).toHaveLength(1);
  });

  it('is a no-op for unknown ids', () => {
    seedCsv(tmpDir, [dcHolidayRow]);
    const rebuilt = deleteLeaveRow({
      id: 'ghost-2026-01-01',
      workingDaysDir: tmpDir,
      input: { contracts },
    });
    expect(rebuilt.all).toHaveLength(1);
  });
});
