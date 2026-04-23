/**
 * Gate logic for each index on the clients registry.
 *
 * One describe block per index, enumerating the inclusion/exclusion
 * rules that the loader applies. A regression here is loud because
 * each gate has a single, named owner.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import { buildClientRegistry } from './registry.js';
import {
  mkTmpDir,
  seedCsv,
  directRow,
  agencyRow,
  agencyInactiveRow,
} from './test-helpers.js';

describe('clients registry gates', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = mkTmpDir(); });
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('returns an empty registry when the CSV file is missing', () => {
    const reg = buildClientRegistry(tmpDir);
    expect(reg.all).toHaveLength(0);
    expect(reg.indexes.byId.size).toBe(0);
    expect(reg.indexes.byKind.size).toBe(0);
    expect(reg.indexes.active).toEqual([]);
  });

  it('preserves CSV order in `all`', () => {
    seedCsv(tmpDir, [directRow, agencyRow]);
    const reg = buildClientRegistry(tmpDir);
    expect(reg.all.map(c => c.id)).toEqual(['delta-capita', 'la-fosse']);
  });

  it('refuses a CSV with duplicate client ids', () => {
    seedCsv(tmpDir, [directRow, directRow]);
    expect(() => buildClientRegistry(tmpDir)).toThrow(/duplicate/i);
  });

  describe('indexes.byId', () => {
    it('gives O(1) access to each client', () => {
      seedCsv(tmpDir, [directRow, agencyRow]);
      const reg = buildClientRegistry(tmpDir);
      expect(reg.indexes.byId.get('delta-capita')?.kind).toBe('direct');
      expect(reg.indexes.byId.get('la-fosse')?.kind).toBe('agency');
    });

    it('has the same size as `all`', () => {
      seedCsv(tmpDir, [directRow, agencyRow]);
      const reg = buildClientRegistry(tmpDir);
      expect(reg.indexes.byId.size).toBe(reg.all.length);
    });
  });

  describe('indexes.byKind', () => {
    it('partitions clients by kind discriminator', () => {
      seedCsv(tmpDir, [directRow, agencyRow]);
      const reg = buildClientRegistry(tmpDir);
      expect(reg.indexes.byKind.get('direct')).toHaveLength(1);
      expect(reg.indexes.byKind.get('agency')).toHaveLength(1);
      expect(reg.indexes.byKind.get('direct')?.[0]?.id).toBe('delta-capita');
      expect(reg.indexes.byKind.get('agency')?.[0]?.id).toBe('la-fosse');
    });

    it('omits kinds with no rows', () => {
      seedCsv(tmpDir, [directRow]);
      const reg = buildClientRegistry(tmpDir);
      expect(reg.indexes.byKind.get('direct')).toHaveLength(1);
      expect(reg.indexes.byKind.has('agency')).toBe(false);
    });
  });

  describe('indexes.active', () => {
    it('includes clients with active === true', () => {
      seedCsv(tmpDir, [directRow, agencyRow]);
      const reg = buildClientRegistry(tmpDir);
      expect(reg.indexes.active.map(c => c.id).sort()).toEqual(
        ['delta-capita', 'la-fosse'],
      );
    });

    it('excludes clients with active === false', () => {
      seedCsv(tmpDir, [directRow, agencyInactiveRow]);
      const reg = buildClientRegistry(tmpDir);
      expect(reg.indexes.active.map(c => c.id)).toEqual(['delta-capita']);
    });
  });
});
