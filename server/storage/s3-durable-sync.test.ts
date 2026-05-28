/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { uploadDurableRelPathsToS3 } from './s3-durable-sync.js';

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
