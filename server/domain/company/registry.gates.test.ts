/**
 * Gate logic for each index on the company registry.
 *
 * One describe block per index, enumerating the inclusion/exclusion
 * rules that the loader applies. A regression here is loud because
 * each gate has a single, named owner.
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

describe('company registry gates', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = mkTmpDir(); });
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('returns an empty registry when the CSV file is missing', () => {
    const reg = buildCompanyRegistry(tmpDir);
    expect(reg.all).toHaveLength(0);
    expect(reg.entityIds).toEqual([]);
    expect(reg.indexes.byId.size).toBe(0);
    expect(reg.indexes.byJurisdiction.size).toBe(0);
    expect(reg.indexes.active).toEqual([]);
  });

  it('preserves CSV order in `all` and `entityIds`', () => {
    seedCsv(tmpDir, [ukRow, uaeRow]);
    const reg = buildCompanyRegistry(tmpDir);
    expect(reg.all.map(c => c.id)).toEqual(['autonize-it-ltd', 'autonize-it-fzco']);
    expect(reg.entityIds).toEqual(['autonize-it-ltd', 'autonize-it-fzco']);
  });

  it('refuses a CSV with duplicate entity ids', () => {
    seedCsv(tmpDir, [ukRow, ukRow]);
    expect(() => buildCompanyRegistry(tmpDir)).toThrow(/duplicate/i);
  });

  describe('indexes.byId', () => {
    it('gives O(1) access to each company', () => {
      seedCsv(tmpDir, [ukRow, uaeRow]);
      const reg = buildCompanyRegistry(tmpDir);
      expect(reg.indexes.byId.get('autonize-it-ltd')?.jurisdiction).toBe('UK');
      expect(reg.indexes.byId.get('autonize-it-fzco')?.jurisdiction).toBe('UAE');
    });

    it('has the same size as `all`', () => {
      seedCsv(tmpDir, [ukRow, uaeRow]);
      const reg = buildCompanyRegistry(tmpDir);
      expect(reg.indexes.byId.size).toBe(reg.all.length);
    });
  });

  describe('indexes.byJurisdiction', () => {
    it('partitions companies by jurisdiction discriminator', () => {
      seedCsv(tmpDir, [ukRow, uaeRow]);
      const reg = buildCompanyRegistry(tmpDir);
      expect(reg.indexes.byJurisdiction.get('UK')).toHaveLength(1);
      expect(reg.indexes.byJurisdiction.get('UAE')).toHaveLength(1);
      expect(reg.indexes.byJurisdiction.get('UK')?.[0]?.id).toBe('autonize-it-ltd');
      expect(reg.indexes.byJurisdiction.get('UAE')?.[0]?.id).toBe('autonize-it-fzco');
    });

    it('omits jurisdictions with no rows', () => {
      seedCsv(tmpDir, [ukRow]);
      const reg = buildCompanyRegistry(tmpDir);
      expect(reg.indexes.byJurisdiction.get('UK')).toHaveLength(1);
      expect(reg.indexes.byJurisdiction.has('UAE')).toBe(false);
    });
  });

  describe('indexes.active', () => {
    it('includes companies with active === true', () => {
      seedCsv(tmpDir, [ukRow, uaeRow]);
      const reg = buildCompanyRegistry(tmpDir);
      expect(reg.indexes.active).toHaveLength(2);
      expect(reg.indexes.active.map(c => c.id).sort()).toEqual(
        ['autonize-it-fzco', 'autonize-it-ltd'],
      );
    });

    it('excludes companies with active === false', () => {
      seedCsv(tmpDir, [ukRow, uaeInactiveRow]);
      const reg = buildCompanyRegistry(tmpDir);
      expect(reg.indexes.active.map(c => c.id)).toEqual(['autonize-it-ltd']);
    });
  });
});
