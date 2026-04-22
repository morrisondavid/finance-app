/**
 * Gate logic for indexes on the transaction-overrides registry.
 *
 * The registry has a single index (`byHash`) — the gates test
 * enumerates the last-write-wins rule and the empty / header-only
 * file cases.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import { buildOverrideRegistry } from './registry.js';
import { getOverridesCsvPath, writeOverridesCsvFile } from './csv-io.js';
import { mkTmpDir } from './test-helpers.js';

describe('transaction-overrides registry gates', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = mkTmpDir(); });
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('returns an empty byHash when the CSV file is missing', () => {
    const reg = buildOverrideRegistry(tmpDir);
    expect(reg.indexes.byHash.size).toBe(0);
  });

  it('returns an empty byHash for a header-only file', () => {
    fs.writeFileSync(
      getOverridesCsvPath(tmpDir),
      'hash,category,notes,classified_at\n',
    );
    const reg = buildOverrideRegistry(tmpDir);
    expect(reg.indexes.byHash.size).toBe(0);
  });

  describe('indexes.byHash', () => {
    it('resolves a single hash to its category', () => {
      writeOverridesCsvFile(getOverridesCsvPath(tmpDir), [
        {
          hash: 'abc123',
          category: 'Inter-company Loan',
          notes: null,
          classified_at: '2026-04-21',
        },
      ]);
      const reg = buildOverrideRegistry(tmpDir);
      expect(reg.indexes.byHash.get('abc123')).toBe('Inter-company Loan');
      expect(reg.indexes.byHash.get('not-in-file')).toBeUndefined();
    });

    it('applies last-write-wins when a hash appears twice', () => {
      writeOverridesCsvFile(getOverridesCsvPath(tmpDir), [
        {
          hash: 'abc',
          category: 'Inter-company Loan',
          notes: null,
          classified_at: '2026-04-20',
        },
        {
          hash: 'abc',
          category: 'Capital Contribution',
          notes: null,
          classified_at: '2026-04-21',
        },
      ]);
      const reg = buildOverrideRegistry(tmpDir);
      expect(reg.indexes.byHash.get('abc')).toBe('Capital Contribution');
      expect(reg.indexes.byHash.size).toBe(1);
    });

    it('exposes all active overrides in the map', () => {
      writeOverridesCsvFile(getOverridesCsvPath(tmpDir), [
        {
          hash: 'a',
          category: 'Inter-company Loan',
          notes: null,
          classified_at: '2026-04-21',
        },
        {
          hash: 'b',
          category: 'Inter-company False Positive',
          notes: null,
          classified_at: '2026-04-21',
        },
      ]);
      const reg = buildOverrideRegistry(tmpDir);
      expect(reg.indexes.byHash.size).toBe(2);
      expect(reg.indexes.byHash.get('a')).toBe('Inter-company Loan');
      expect(reg.indexes.byHash.get('b')).toBe('Inter-company False Positive');
    });
  });
});
