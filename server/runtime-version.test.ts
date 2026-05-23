/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildApiVersionPayload } from './runtime-version.js';

describe('buildApiVersionPayload', () => {
  const prevNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
  });

  it('returns packageVersion (non-empty), deterministic sourceSha256 fingerprint, manifest kind, nodeEnv', () => {
    const p = buildApiVersionPayload();

    expect(p.packageVersion.length).toBeGreaterThan(0);
    expect(p.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(p.sourceHashManifest).toMatch(/^(built|runtime-computed)$/);

    /** Non-production test env always lazy-hashes repo (not Docker `built` artefact semantics). */
    expect(p.sourceHashManifest).toBe('runtime-computed');

    expect(p.nodeEnv).toBe('test');
  });
});
