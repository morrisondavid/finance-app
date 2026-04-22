import { describe, it, expect } from 'vitest';
import { buildMerchantsRegistry } from './registry.js';
import { STATIC_MERCHANT_DATA } from './data.js';
import { allPeople } from '../people/index.js';

const reg = buildMerchantsRegistry();

describe('registry invariants — patterns containment', () => {
  it('patterns has (people × 2) + static entries count', () => {
    const expected = allPeople().length * 2 + STATIC_MERCHANT_DATA.length;
    expect(reg.indexes.patterns.length).toBe(expected);
  });

  it('every static entry appears in patterns, in declaration order', () => {
    const offset = allPeople().length * 2;
    for (let i = 0; i < STATIC_MERCHANT_DATA.length; i++) {
      expect(reg.indexes.patterns[offset + i]).toBe(STATIC_MERCHANT_DATA[i]);
    }
  });
});

describe('registry invariants — index containment', () => {
  it('byCategory values ⊂ patterns', () => {
    const patternSet = new Set(reg.indexes.patterns);
    for (const [, bucket] of reg.indexes.byCategory) {
      for (const entry of bucket) {
        expect(patternSet.has(entry)).toBe(true);
      }
    }
  });

  it('byCategory total count equals patterns length (no dropped entries)', () => {
    let total = 0;
    for (const [, bucket] of reg.indexes.byCategory) {
      total += bucket.length;
    }
    expect(total).toBe(reg.indexes.patterns.length);
  });

  it('byDisplayName values ⊂ patterns', () => {
    const patternSet = new Set(reg.indexes.patterns);
    for (const [, entry] of reg.indexes.byDisplayName) {
      expect(patternSet.has(entry)).toBe(true);
    }
  });

  it('byDisplayName keys === distinct non-null displayNames in patterns', () => {
    const distinct = new Set<string>();
    for (const e of reg.indexes.patterns) {
      if (e.displayName !== null) distinct.add(e.displayName);
    }
    expect(reg.indexes.byDisplayName.size).toBe(distinct.size);
  });
});

describe('registry invariants — no duplicate named (displayName, category) pairs', () => {
  it('never declares the same displayName + category twice in static data', () => {
    const seen = new Map<string, number>();
    for (const [i, entry] of STATIC_MERCHANT_DATA.entries()) {
      if (entry.displayName === null) continue;
      const key = `${entry.displayName}\u0000${entry.category}`;
      const prev = seen.get(key);
      expect(prev, `duplicate at #${i} and #${prev}: ${entry.displayName}/${entry.category}`).toBeUndefined();
      seen.set(key, i);
    }
  });
});

describe('registry invariants — every entry has a round-trippable regex', () => {
  it('compiles cleanly and reports a boolean from .test()', () => {
    for (const [i, entry] of reg.indexes.patterns.entries()) {
      expect(entry.pattern, `entry #${i}`).toBeInstanceOf(RegExp);
      expect(entry.pattern.source.length, `entry #${i}`).toBeGreaterThan(0);
      const roundTrip = new RegExp(entry.pattern.source, entry.pattern.flags);
      expect(roundTrip.test('sanity')).toBeTypeOf('boolean');
    }
  });
});
