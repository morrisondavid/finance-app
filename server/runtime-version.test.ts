/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildApiVersionPayload } from './runtime-version.js';

describe('buildApiVersionPayload', () => {
  const prevGit = process.env.BANK_APP_BUILD_GIT_COMMIT;
  const prevAt = process.env.BANK_APP_IMAGE_BUILT_AT;
  const prevNode = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.BANK_APP_BUILD_GIT_COMMIT = 'deadbeef';
    process.env.BANK_APP_IMAGE_BUILT_AT = '2026-05-01T12:00:00Z';
    process.env.NODE_ENV = 'production';
  });

  afterEach(() => {
    if (prevGit === undefined) delete process.env.BANK_APP_BUILD_GIT_COMMIT;
    else process.env.BANK_APP_BUILD_GIT_COMMIT = prevGit;
    if (prevAt === undefined) delete process.env.BANK_APP_IMAGE_BUILT_AT;
    else process.env.BANK_APP_IMAGE_BUILT_AT = prevAt;
    if (prevNode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNode;
  });

  it('reads BANK_APP_* build stamps and NODE_ENV', () => {
    const p = buildApiVersionPayload();
    expect(p.gitCommit).toBe('deadbeef');
    expect(p.imageBuiltAt).toBe('2026-05-01T12:00:00Z');
    expect(p.nodeEnv).toBe('production');
    expect(p.packageVersion.length).toBeGreaterThan(0);
  });
});
