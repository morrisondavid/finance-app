import { describe, expect, it, afterEach } from 'vitest';
import {
  clearReadResponseCache,
  resolveReadCacheTtlMs,
  withReadResponseCache,
} from './read-response-cache.js';

describe('read-response-cache', () => {
  const prevTtl = process.env.BANK_READ_CACHE_TTL_SECONDS;

  afterEach(() => {
    if (prevTtl === undefined) delete process.env.BANK_READ_CACHE_TTL_SECONDS;
    else process.env.BANK_READ_CACHE_TTL_SECONDS = prevTtl;
    clearReadResponseCache();
  });

  it('returns cached value within TTL', () => {
    process.env.BANK_READ_CACHE_TTL_SECONDS = '60';
    let calls = 0;
    const compute = () => {
      calls += 1;
      return { n: calls };
    };
    expect(withReadResponseCache('tool', {}, compute)).toEqual({ n: 1 });
    expect(withReadResponseCache('tool', {}, compute)).toEqual({ n: 1 });
    expect(calls).toBe(1);
  });

  it('disables cache when TTL is 0', () => {
    process.env.BANK_READ_CACHE_TTL_SECONDS = '0';
    expect(resolveReadCacheTtlMs()).toBe(0);
    let calls = 0;
    const compute = () => {
      calls += 1;
      return calls;
    };
    expect(withReadResponseCache('tool', {}, compute)).toBe(1);
    expect(withReadResponseCache('tool', {}, compute)).toBe(2);
  });
});
