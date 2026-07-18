/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isDurableRepoRelativePath,
  resolveBankS3DurableSyncConfig,
  uploadDurableRelPathsToS3,
} from './s3-durable-sync.js';

describe('isDurableRepoRelativePath', () => {
  it('rejects paths outside durable roots (assertSafeRepoRelative guard)', () => {
    expect(isDurableRepoRelativePath('dist/not-durable.js')).toBe(false);
  });

  it('includes debt-strategy paths', () => {
    expect(isDurableRepoRelativePath('debt-strategy/plans.csv')).toBe(true);
  });
});

describe('s3-durable-sync OAuth paths', () => {
  let prevBucket: string | undefined;

  beforeEach(() => {
    prevBucket = process.env.BANK_S3_DURABLE_BUCKET;
    delete process.env.BANK_S3_DURABLE_BUCKET;
  });

  afterEach(() => {
    if (prevBucket === undefined) delete process.env.BANK_S3_DURABLE_BUCKET;
    else process.env.BANK_S3_DURABLE_BUCKET = prevBucket;
  });

  it('accepts truelayer token path without throwing when bucket is unset (dev no-op)', async () => {
    await expect(
      uploadDurableRelPathsToS3(['data/truelayer-tokens.local.json'], 'unit-test'),
    ).resolves.toBeUndefined();
  });

  it('accepts enable-sessions path without throwing when bucket is unset', async () => {
    await expect(
      uploadDurableRelPathsToS3(['data/enable-sessions.json'], 'unit-test'),
    ).resolves.toBeUndefined();
  });
});

describe('resolveBankS3DurableSyncConfig NODE_ENV gate', () => {
  let prevBucket: string | undefined;
  let prevNodeEnv: string | undefined;

  beforeEach(() => {
    prevBucket = process.env.BANK_S3_DURABLE_BUCKET;
    prevNodeEnv = process.env.NODE_ENV;
    process.env.BANK_S3_DURABLE_BUCKET = 'some-bucket';
  });

  afterEach(() => {
    if (prevBucket === undefined) delete process.env.BANK_S3_DURABLE_BUCKET;
    else process.env.BANK_S3_DURABLE_BUCKET = prevBucket;
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
  });

  it('returns null outside production even when the bucket is set', () => {
    process.env.NODE_ENV = 'development';
    expect(resolveBankS3DurableSyncConfig()).toBeNull();
  });

  it('resolves the bucket in production', () => {
    process.env.NODE_ENV = 'production';
    expect(resolveBankS3DurableSyncConfig()).not.toBeNull();
  });
});
