/**
 * Query purity for the transaction-overrides domain.
 *
 * Every query is driven via an explicit fixture registry so the same
 * function over different data produces different results. Pure by
 * construction — no global state dependency.
 */

import { describe, it, expect } from 'vitest';
import {
  allOverrides,
  lookupOverride,
  overrideCount,
} from './queries.js';
import { makeTestOverrideRegistry } from './fixtures.js';

const twoEntries = makeTestOverrideRegistry({
  entries: [
    ['hash-a', 'Inter-company Loan'],
    ['hash-b', 'Capital Contribution'],
  ],
});
const empty = makeTestOverrideRegistry();

describe('lookupOverride', () => {
  it('resolves a known hash', () => {
    expect(lookupOverride('hash-a', twoEntries)).toBe('Inter-company Loan');
    expect(lookupOverride('hash-b', twoEntries)).toBe('Capital Contribution');
  });

  it('returns null for an unknown hash', () => {
    expect(lookupOverride('missing', twoEntries)).toBeNull();
  });

  it('returns null on an empty registry', () => {
    expect(lookupOverride('hash-a', empty)).toBeNull();
  });
});

describe('allOverrides', () => {
  it('returns the full byHash map', () => {
    const all = allOverrides(twoEntries);
    expect(all.size).toBe(2);
    expect(all.get('hash-a')).toBe('Inter-company Loan');
  });

  it('returns an empty map on an empty registry', () => {
    expect(allOverrides(empty).size).toBe(0);
  });
});

describe('overrideCount', () => {
  it('returns the number of distinct hashes', () => {
    expect(overrideCount(twoEntries)).toBe(2);
    expect(overrideCount(empty)).toBe(0);
  });
});
