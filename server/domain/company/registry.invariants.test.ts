/**
 * Cross-index invariants for the company registry.
 *
 * Internal consistency: indexes derived from the same source must
 * agree on membership. A drift between `byId` and `all` (for example)
 * indicates a loader bug.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import { buildCompanyRegistry } from './registry.js';
import {
  mkTmpDir,
  seedCsv,
  ukRow,
  uaeRow,
  uaeInactiveRow,
} from './test-helpers.js';

describe('company registry invariants', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = mkTmpDir(); });
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('byId covers exactly the companies in `all`', () => {
    seedCsv(tmpDir, [ukRow, uaeRow]);
    const reg = buildCompanyRegistry(tmpDir);
    expect(reg.indexes.byId.size).toBe(reg.all.length);
    for (const c of reg.all) {
      expect(reg.indexes.byId.get(c.id)).toBe(c);
    }
  });

  it('entityIds matches `all` in order', () => {
    seedCsv(tmpDir, [ukRow, uaeRow]);
    const reg = buildCompanyRegistry(tmpDir);
    expect(reg.entityIds).toEqual(reg.all.map(c => c.id));
  });

  it('byJurisdiction union covers every row in `all`', () => {
    seedCsv(tmpDir, [ukRow, uaeRow]);
    const reg = buildCompanyRegistry(tmpDir);
    const union: string[] = [];
    for (const rows of reg.indexes.byJurisdiction.values()) {
      for (const c of rows) union.push(c.id);
    }
    expect(union.sort()).toEqual(reg.all.map(c => c.id).sort());
  });

  it('active ⊆ all', () => {
    seedCsv(tmpDir, [ukRow, uaeInactiveRow]);
    const reg = buildCompanyRegistry(tmpDir);
    const allIds = new Set(reg.all.map(c => c.id));
    for (const c of reg.indexes.active) {
      expect(allIds.has(c.id)).toBe(true);
    }
  });

  it('every active company has active === true', () => {
    seedCsv(tmpDir, [ukRow, uaeInactiveRow]);
    const reg = buildCompanyRegistry(tmpDir);
    for (const c of reg.indexes.active) {
      expect(c.active).toBe(true);
    }
  });
});
