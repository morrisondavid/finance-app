import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { assertManifestConsumers } from './manifest-test.js';

interface FakeRegistry {
  readonly indexes: {
    readonly alpha: readonly string[];
    readonly beta: readonly string[];
  };
}

const fakeRegistry: FakeRegistry = {
  indexes: { alpha: [], beta: [] },
};

describe('assertManifestConsumers', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-test-'));
    fs.writeFileSync(path.join(tmpDir, 'existing.ts'), '// stub\n');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('passes when every index has a consumer and every consumer file exists', () => {
    expect(() =>
      assertManifestConsumers({
        registry: fakeRegistry,
        repoRoot: tmpDir,
        consumers: {
          alpha: [{ file: 'existing.ts', functions: ['useAlpha'] }],
          beta: [{ file: 'existing.ts' }],
        },
      }),
    ).not.toThrow();
  });

  it('fails when an index has no documented consumer', () => {
    expect(() =>
      assertManifestConsumers({
        registry: fakeRegistry,
        repoRoot: tmpDir,
        consumers: {
          alpha: [{ file: 'existing.ts' }],
        },
      }),
    ).toThrow(/Orphaned indexes.*beta/);
  });

  it('fails when an index has an empty consumer list', () => {
    expect(() =>
      assertManifestConsumers({
        registry: fakeRegistry,
        repoRoot: tmpDir,
        consumers: {
          alpha: [{ file: 'existing.ts' }],
          beta: [],
        },
      }),
    ).toThrow(/Orphaned indexes.*beta/);
  });

  it('fails when a consumer references a non-existent index key', () => {
    expect(() =>
      assertManifestConsumers({
        registry: fakeRegistry,
        repoRoot: tmpDir,
        consumers: {
          alpha: [{ file: 'existing.ts' }],
          beta: [{ file: 'existing.ts' }],
          gamma: [{ file: 'existing.ts' }],
        },
      }),
    ).toThrow(/reference index keys that do not exist.*gamma/);
  });

  it('fails when a documented consumer file does not exist on disk', () => {
    expect(() =>
      assertManifestConsumers({
        registry: fakeRegistry,
        repoRoot: tmpDir,
        consumers: {
          alpha: [{ file: 'existing.ts' }],
          beta: [{ file: 'ghost.ts' }],
        },
      }),
    ).toThrow(/Documented consumer files do not exist.*ghost\.ts/s);
  });

  it('aggregates multiple failures into one readable error', () => {
    let captured: Error | null = null;
    try {
      assertManifestConsumers({
        registry: fakeRegistry,
        repoRoot: tmpDir,
        consumers: {
          alpha: [{ file: 'ghost.ts' }],
          gamma: [{ file: 'existing.ts' }],
        },
      });
    } catch (e) {
      captured = e instanceof Error ? e : new Error(String(e));
    }
    expect(captured).not.toBeNull();
    const message = captured?.message ?? '';
    expect(message).toMatch(/Orphaned indexes.*beta/);
    expect(message).toMatch(/reference index keys that do not exist.*gamma/);
    expect(message).toMatch(/Documented consumer files do not exist/);
    expect(message).toContain('ghost.ts');
  });

  it('defaults repoRoot to process.cwd() when not provided', () => {
    const reg: FakeRegistry = { indexes: { alpha: [], beta: [] } };
    expect(() =>
      assertManifestConsumers({
        registry: reg,
        consumers: {
          alpha: [{ file: 'nonexistent-file-xyz-manifest-test-probe.ts' }],
          beta: [{ file: 'nonexistent-file-xyz-manifest-test-probe.ts' }],
        },
      }),
    ).toThrow(/Documented consumer files do not exist/);
  });
});
