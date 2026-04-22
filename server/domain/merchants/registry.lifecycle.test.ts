import { describe, it, expect, afterEach } from 'vitest';
import {
  __resetMerchantsRegistryForTests,
  buildMerchantsRegistry,
  getMerchantsRegistry,
  invalidateMerchantsRegistry,
} from './registry.js';

describe('getMerchantsRegistry lifecycle', () => {
  afterEach(() => {
    __resetMerchantsRegistryForTests();
  });

  it('memoises — repeated calls return the same reference', () => {
    __resetMerchantsRegistryForTests();
    const first = getMerchantsRegistry();
    const second = getMerchantsRegistry();
    expect(first).toBe(second);
  });

  it('invalidateMerchantsRegistry busts the cache so the next get rebuilds', () => {
    __resetMerchantsRegistryForTests();
    const first = getMerchantsRegistry();
    invalidateMerchantsRegistry();
    const second = getMerchantsRegistry();
    expect(first).not.toBe(second);
    expect(first.indexes.patterns.length).toBe(second.indexes.patterns.length);
  });

  it('__resetMerchantsRegistryForTests(no-arg) drops the cache', () => {
    const first = getMerchantsRegistry();
    __resetMerchantsRegistryForTests();
    const second = getMerchantsRegistry();
    expect(first).not.toBe(second);
  });

  it('__resetMerchantsRegistryForTests(override) swaps in a fixture without calling build', () => {
    const fixture = buildMerchantsRegistry();
    __resetMerchantsRegistryForTests(fixture);
    expect(getMerchantsRegistry()).toBe(fixture);
    expect(getMerchantsRegistry()).toBe(fixture);
  });

  it('after an override reset, a plain reset restores the default build', () => {
    const fixture = buildMerchantsRegistry();
    __resetMerchantsRegistryForTests(fixture);
    expect(getMerchantsRegistry()).toBe(fixture);
    __resetMerchantsRegistryForTests();
    const rebuilt = getMerchantsRegistry();
    expect(rebuilt).not.toBe(fixture);
    expect(rebuilt.indexes.patterns.length).toBe(fixture.indexes.patterns.length);
  });
});

describe('buildMerchantsRegistry determinism', () => {
  it('builds from the default data and produces the same shape every call', () => {
    const a = buildMerchantsRegistry();
    const b = buildMerchantsRegistry();
    expect(a.indexes.patterns.length).toBe(b.indexes.patterns.length);
    expect([...a.indexes.byDisplayName.keys()].sort()).toEqual(
      [...b.indexes.byDisplayName.keys()].sort(),
    );
  });

  it('does not share mutable state between two independent builds', () => {
    const a = buildMerchantsRegistry();
    const b = buildMerchantsRegistry();
    expect(a).not.toBe(b);
    expect(a.indexes).not.toBe(b.indexes);
  });
});
