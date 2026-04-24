/**
 * Cross-index invariants for the leave registry.
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
  seedCsv,
} from './test-helpers.js';

function buildWithStubs(tmpDir: string, today = '2026-04-21') {
  return buildLeaveRegistry(tmpDir, { contracts: makeStubContracts(), today });
}

describe('leave registry invariants', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = mkTmpDir(); });
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('byId covers exactly the rows in `all`', () => {
    seedCsv(tmpDir, [dcHolidayRow, lfHolidayRow]);
    const reg = buildWithStubs(tmpDir);
    expect(reg.indexes.byId.size).toBe(reg.all.length);
    for (const r of reg.all) {
      expect(reg.indexes.byId.get(r.id)).toBe(r);
    }
  });

  it('byContract union covers every row in `all`', () => {
    seedCsv(tmpDir, [dcHolidayRow, dcPastSickRow, lfHolidayRow]);
    const reg = buildWithStubs(tmpDir);
    const union: string[] = [];
    for (const rows of reg.indexes.byContract.values()) {
      for (const r of rows) union.push(r.id);
    }
    expect(union.sort()).toEqual(reg.all.map(r => r.id).sort());
  });

  it('byDate union covers every row in `all`', () => {
    seedCsv(tmpDir, [dcHolidayRow, dcPastSickRow, lfHolidayRow]);
    const reg = buildWithStubs(tmpDir);
    const union: string[] = [];
    for (const rows of reg.indexes.byDate.values()) {
      for (const r of rows) union.push(r.id);
    }
    expect(union.sort()).toEqual(reg.all.map(r => r.id).sort());
  });

  it('byContract rows are ordered by date ascending', () => {
    seedCsv(tmpDir, [dcHolidayRow, dcPastSickRow]);
    const reg = buildWithStubs(tmpDir);
    for (const rows of reg.indexes.byContract.values()) {
      for (let i = 1; i < rows.length; i++) {
        const prev = rows[i - 1];
        const cur = rows[i];
        if (prev !== undefined && cur !== undefined) {
          expect(cur.date >= prev.date).toBe(true);
        }
      }
    }
  });

  it('futureByContract ⊆ byContract', () => {
    seedCsv(tmpDir, [dcHolidayRow, dcPastSickRow]);
    const reg = buildWithStubs(tmpDir);
    for (const [contractId, futureRows] of reg.indexes.futureByContract) {
      const allRows = reg.indexes.byContract.get(contractId) ?? [];
      const allIds = new Set(allRows.map(r => r.id));
      for (const f of futureRows) expect(allIds.has(f.id)).toBe(true);
    }
  });

  it('every future row has date >= today', () => {
    seedCsv(tmpDir, [dcHolidayRow, dcPastSickRow]);
    const today = '2026-04-21';
    const reg = buildWithStubs(tmpDir, today);
    for (const rows of reg.indexes.futureByContract.values()) {
      for (const r of rows) expect(r.date >= today).toBe(true);
    }
  });
});
