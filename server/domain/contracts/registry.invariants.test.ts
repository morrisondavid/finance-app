/**
 * Cross-index invariants for the contracts registry.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import { buildContractRegistry } from './registry.js';
import {
  mkTmpDir,
  makeStubClients,
  makeStubCompanies,
  makeStubMasters,
  seedCsv,
  dcSowRow,
  lfContractRow,
  lfExtensionRow,
  dcSowInactiveRow,
} from './test-helpers.js';

function buildWithStubs(tmpDir: string) {
  return buildContractRegistry(tmpDir, {
    clients: makeStubClients(),
    companies: makeStubCompanies(),
    masters: makeStubMasters(),
  });
}

describe('contracts registry invariants', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = mkTmpDir(); });
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('byId covers exactly the contracts in `all`', () => {
    seedCsv(tmpDir, [dcSowRow, lfContractRow]);
    const reg = buildWithStubs(tmpDir);
    expect(reg.indexes.byId.size).toBe(reg.all.length);
    for (const c of reg.all) {
      expect(reg.indexes.byId.get(c.id)).toBe(c);
    }
  });

  it('byClient union covers every row in `all`', () => {
    seedCsv(tmpDir, [dcSowRow, lfContractRow, lfExtensionRow]);
    const reg = buildWithStubs(tmpDir);
    const union: string[] = [];
    for (const rows of reg.indexes.byClient.values()) {
      for (const c of rows) union.push(c.id);
    }
    expect(union.sort()).toEqual(reg.all.map(c => c.id).sort());
  });

  it('byClientAndEntity union covers every row in `all`', () => {
    seedCsv(tmpDir, [dcSowRow, lfContractRow, lfExtensionRow]);
    const reg = buildWithStubs(tmpDir);
    const union: string[] = [];
    for (const rows of reg.indexes.byClientAndEntity.values()) {
      for (const c of rows) union.push(c.id);
    }
    expect(union.sort()).toEqual(reg.all.map(c => c.id).sort());
  });

  it('byClientAndEntity rows are ordered by start_date ascending', () => {
    seedCsv(tmpDir, [lfExtensionRow, lfContractRow]);
    const reg = buildWithStubs(tmpDir);
    for (const rows of reg.indexes.byClientAndEntity.values()) {
      for (let i = 1; i < rows.length; i++) {
        const prev = rows[i - 1];
        const cur = rows[i];
        if (prev !== undefined && cur !== undefined) {
          expect(cur.start_date >= prev.start_date).toBe(true);
        }
      }
    }
  });

  it('byMaster contains only contracts whose master_id is non-null', () => {
    seedCsv(tmpDir, [dcSowRow, lfContractRow]);
    const reg = buildWithStubs(tmpDir);
    for (const rows of reg.indexes.byMaster.values()) {
      for (const c of rows) expect(c.master_id).not.toBeNull();
    }
  });

  it('active ⊆ all', () => {
    seedCsv(tmpDir, [dcSowRow, dcSowInactiveRow]);
    const reg = buildWithStubs(tmpDir);
    const allIds = new Set(reg.all.map(c => c.id));
    for (const c of reg.indexes.active) {
      expect(allIds.has(c.id)).toBe(true);
    }
  });

  it('every active contract has active === true', () => {
    seedCsv(tmpDir, [dcSowRow, dcSowInactiveRow]);
    const reg = buildWithStubs(tmpDir);
    for (const c of reg.indexes.active) {
      expect(c.active).toBe(true);
    }
  });
});
