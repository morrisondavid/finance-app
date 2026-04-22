/**
 * Lifecycle semantics of the memoised default overrides registry.
 *
 * Also covers the domain-specific wrinkle: `__resetOverrideRegistryForTests`
 * redirects the directory the default singleton reads from, so writers
 * (POST /classify) that consult `getOverridesDir()` point at the same
 * tmp dir the test redirected the registry to.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import {
  __resetOverrideRegistryForTests,
  getOverrideRegistry,
  getOverridesDir,
  invalidateOverrideRegistry,
} from './registry.js';
import { getOverridesCsvPath, writeOverridesCsvFile } from './csv-io.js';
import { mkTmpDir } from './test-helpers.js';

describe('getOverrideRegistry lifecycle', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = mkTmpDir();
    __resetOverrideRegistryForTests(tmpDir);
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    __resetOverrideRegistryForTests();
  });

  it('returns the same instance on subsequent calls (memoised)', () => {
    const first = getOverrideRegistry();
    const second = getOverrideRegistry();
    expect(first).toBe(second);
  });

  it('invalidate() drops the cache so the next get rereads the CSV', () => {
    expect(getOverrideRegistry().indexes.byHash.get('abc')).toBeUndefined();

    writeOverridesCsvFile(getOverridesCsvPath(tmpDir), [
      {
        hash: 'abc',
        category: 'Inter-company Loan',
        notes: null,
        classified_at: '2026-04-21',
      },
    ]);

    expect(getOverrideRegistry().indexes.byHash.get('abc')).toBeUndefined();

    invalidateOverrideRegistry();
    expect(getOverrideRegistry().indexes.byHash.get('abc')).toBe('Inter-company Loan');
  });

  it('__resetOverrideRegistryForTests(dir) redirects both the cache and the directory writers see', () => {
    expect(getOverridesDir()).toBe(tmpDir);
    const other = mkTmpDir();
    try {
      __resetOverrideRegistryForTests(other);
      expect(getOverridesDir()).toBe(other);
    } finally {
      fs.rmSync(other, { recursive: true, force: true });
    }
  });
});
