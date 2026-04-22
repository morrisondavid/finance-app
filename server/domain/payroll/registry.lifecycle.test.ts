import { describe, it, expect, afterEach } from 'vitest';
import {
  __resetPayrollRegistryForTests,
  buildPayrollRegistry,
  getPayrollRegistry,
  invalidatePayrollRegistry,
} from './registry.js';

describe('getPayrollRegistry lifecycle', () => {
  afterEach(() => {
    __resetPayrollRegistryForTests();
  });

  it('memoises — repeated calls return the same reference', () => {
    __resetPayrollRegistryForTests();
    const first = getPayrollRegistry();
    const second = getPayrollRegistry();
    expect(first).toBe(second);
  });

  it('invalidatePayrollRegistry busts the cache so the next get rebuilds', () => {
    __resetPayrollRegistryForTests();
    const first = getPayrollRegistry();
    invalidatePayrollRegistry();
    const second = getPayrollRegistry();
    expect(first).not.toBe(second);
    expect(first.indexes.entries.length).toBe(second.indexes.entries.length);
  });

  it('__resetPayrollRegistryForTests(no-arg) drops the cache', () => {
    const first = getPayrollRegistry();
    __resetPayrollRegistryForTests();
    const second = getPayrollRegistry();
    expect(first).not.toBe(second);
  });

  it('__resetPayrollRegistryForTests(override) swaps in a fixture without calling build', () => {
    const fixture = buildPayrollRegistry();
    __resetPayrollRegistryForTests(fixture);
    expect(getPayrollRegistry()).toBe(fixture);
    expect(getPayrollRegistry()).toBe(fixture);
  });

  it('after an override reset, a plain reset restores the default build', () => {
    const fixture = buildPayrollRegistry();
    __resetPayrollRegistryForTests(fixture);
    expect(getPayrollRegistry()).toBe(fixture);
    __resetPayrollRegistryForTests();
    const rebuilt = getPayrollRegistry();
    expect(rebuilt).not.toBe(fixture);
    expect(rebuilt.indexes.entries.length).toBe(fixture.indexes.entries.length);
  });
});

describe('buildPayrollRegistry determinism', () => {
  it('builds from the live upstream registries and produces the same shape every call', () => {
    const a = buildPayrollRegistry();
    const b = buildPayrollRegistry();
    expect(a.indexes.entries.length).toBe(b.indexes.entries.length);
    expect([...a.indexes.directorsById.keys()].sort()).toEqual(
      [...b.indexes.directorsById.keys()].sort(),
    );
  });

  it('does not share mutable state between two independent builds', () => {
    const a = buildPayrollRegistry();
    const b = buildPayrollRegistry();
    expect(a).not.toBe(b);
    expect(a.indexes).not.toBe(b.indexes);
  });
});
