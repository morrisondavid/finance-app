/**
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { REPO_ROOT } from '../repo-root.js';
import {
  appendDurableFileSync,
  resetDurableUploadsSuppressedForTests,
  setDurableUploadsSuppressed,
  writeDurableFileSync,
} from './durable-fs.js';
import { isDurableRepoRelativePath } from './s3-durable-sync.js';

const uploadMock = vi.fn().mockResolvedValue(undefined);

vi.mock('./s3-durable-sync.js', async () => {
  const actual = await vi.importActual<typeof import('./s3-durable-sync.js')>(
    './s3-durable-sync.js',
  );
  return {
    ...actual,
    uploadDurableRelPathsToS3: (...args: unknown[]) => uploadMock(...args),
  };
});

describe('isDurableRepoRelativePath', () => {
  it('accepts durable top-level CSV paths', () => {
    expect(isDurableRepoRelativePath('obligations/obligation-state.csv')).toBe(true);
    expect(isDurableRepoRelativePath('debt-strategy/plans.csv')).toBe(true);
  });

  it('accepts data CSV paths except SQLite artefacts', () => {
    expect(isDurableRepoRelativePath('data/opening-balances.csv')).toBe(true);
    expect(isDurableRepoRelativePath('data/transactions.db')).toBe(false);
  });

  it('rejects paths outside durable roots', () => {
    expect(isDurableRepoRelativePath('dist/app.js')).toBe(false);
    expect(isDurableRepoRelativePath('../escape.csv')).toBe(false);
    expect(isDurableRepoRelativePath('secrets/key.pem')).toBe(false);
  });
});

describe('writeDurableFileSync', () => {
  let tmpRelDir: string;
  let absPath: string;

  beforeEach(() => {
    uploadMock.mockClear();
    resetDurableUploadsSuppressedForTests();
    tmpRelDir = `data/.vitest-durable-fs-${String(Date.now())}`;
    absPath = path.join(REPO_ROOT, tmpRelDir, 'sample.csv');
  });

  afterEach(() => {
    fs.rmSync(path.join(REPO_ROOT, tmpRelDir), { recursive: true, force: true });
  });

  it('uploads when writing under a durable root', async () => {
    writeDurableFileSync(absPath, 'a,b\n1,2\n');
    await new Promise<void>(resolve => {
      setTimeout(resolve, 0);
    });
    expect(uploadMock).toHaveBeenCalledWith(
      [`${tmpRelDir}/sample.csv`],
      'data',
    );
  });

  it('does not upload for paths outside the repo root', async () => {
    const outside = path.join(os.tmpdir(), `outside-${String(Date.now())}.csv`);
    writeDurableFileSync(outside, 'x\n');
    await new Promise<void>(resolve => {
      setTimeout(resolve, 0);
    });
    expect(uploadMock).not.toHaveBeenCalled();
    fs.unlinkSync(outside);
  });

  it('skips upload when suppression is enabled', async () => {
    setDurableUploadsSuppressed(true);
    writeDurableFileSync(absPath, 'suppressed\n');
    await new Promise<void>(resolve => {
      setTimeout(resolve, 0);
    });
    expect(uploadMock).not.toHaveBeenCalled();
  });
});

describe('appendDurableFileSync', () => {
  let tmpRelDir: string;
  let absPath: string;

  beforeEach(() => {
    uploadMock.mockClear();
    resetDurableUploadsSuppressedForTests();
    tmpRelDir = `data/.vitest-durable-append-${String(Date.now())}`;
    absPath = path.join(REPO_ROOT, tmpRelDir, 'events.jsonl');
  });

  afterEach(() => {
    fs.rmSync(path.join(REPO_ROOT, tmpRelDir), { recursive: true, force: true });
  });

  it('uploads after append under a durable root', async () => {
    appendDurableFileSync(absPath, '{"event":1}\n');
    await new Promise<void>(resolve => {
      setTimeout(resolve, 0);
    });
    expect(uploadMock).toHaveBeenCalledWith(
      [`${tmpRelDir}/events.jsonl`],
      'data',
    );
  });
});
