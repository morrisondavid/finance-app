import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  buildOverrideRegistry,
  getOverrideRegistry,
  invalidateOverrideRegistry,
  __resetOverrideRegistryForTests,
} from './registry.js';
import {
  getOverridesCsvPath,
  writeOverridesCsvFile,
} from './csv-io.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overrides-reg-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  __resetOverrideRegistryForTests();
});

describe('buildOverrideRegistry — explicit directory', () => {
  it('returns an empty registry when the CSV does not exist', () => {
    const reg = buildOverrideRegistry(tmpDir);
    expect(reg.size()).toBe(0);
    expect(reg.get('any-hash')).toBeNull();
  });

  it('returns an empty registry for a header-only file', () => {
    fs.writeFileSync(
      getOverridesCsvPath(tmpDir),
      'hash,category,notes,classified_at\n',
    );
    const reg = buildOverrideRegistry(tmpDir);
    expect(reg.size()).toBe(0);
  });

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
    expect(reg.get('abc123')).toBe('Inter-company Loan');
    expect(reg.get('not-in-file')).toBeNull();
    expect(reg.size()).toBe(1);
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
    expect(reg.get('abc')).toBe('Capital Contribution');
    expect(reg.size()).toBe(1);
  });

  it('exposes all active overrides via entries()', () => {
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
    const entries = reg.entries();
    expect(entries.size).toBe(2);
    expect(entries.get('a')).toBe('Inter-company Loan');
    expect(entries.get('b')).toBe('Inter-company False Positive');
  });
});

describe('getOverrideRegistry — cached singleton', () => {
  it('returns the same instance on subsequent calls', () => {
    __resetOverrideRegistryForTests(tmpDir);
    const first = getOverrideRegistry();
    const second = getOverrideRegistry();
    expect(first).toBe(second);
  });

  it('lazily rereads the CSV after invalidateOverrideRegistry()', () => {
    __resetOverrideRegistryForTests(tmpDir);
    expect(getOverrideRegistry().get('abc')).toBeNull();

    writeOverridesCsvFile(getOverridesCsvPath(tmpDir), [
      {
        hash: 'abc',
        category: 'Inter-company Loan',
        notes: null,
        classified_at: '2026-04-21',
      },
    ]);

    // Before invalidation the cache is stale.
    expect(getOverrideRegistry().get('abc')).toBeNull();

    invalidateOverrideRegistry();
    expect(getOverrideRegistry().get('abc')).toBe('Inter-company Loan');
  });
});
