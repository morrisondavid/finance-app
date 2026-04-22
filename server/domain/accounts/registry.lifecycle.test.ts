import { describe, it, expect, afterEach } from 'vitest';
import {
  __resetAccountsRegistryForTests,
  buildAccountsRegistry,
  getAccountsRegistry,
  invalidateAccountsRegistry,
} from './registry.js';
import { ACCOUNT_CONFIG_DATA } from './data.js';

describe('getAccountsRegistry lifecycle', () => {
  afterEach(() => {
    __resetAccountsRegistryForTests();
  });

  it('memoises — repeated calls return the same reference', () => {
    __resetAccountsRegistryForTests();
    const first = getAccountsRegistry();
    const second = getAccountsRegistry();
    expect(first).toBe(second);
  });

  it('invalidateAccountsRegistry busts the cache so the next get rebuilds', () => {
    __resetAccountsRegistryForTests();
    const first = getAccountsRegistry();
    invalidateAccountsRegistry();
    const second = getAccountsRegistry();
    expect(first).not.toBe(second);
    expect(first.indexes.business).toEqual(second.indexes.business);
  });

  it('__resetAccountsRegistryForTests(no-arg) drops the cache', () => {
    const first = getAccountsRegistry();
    __resetAccountsRegistryForTests();
    const second = getAccountsRegistry();
    expect(first).not.toBe(second);
  });

  it('__resetAccountsRegistryForTests(override) swaps in a fixture without calling build', () => {
    const fixture = buildAccountsRegistry(ACCOUNT_CONFIG_DATA);
    __resetAccountsRegistryForTests(fixture);
    expect(getAccountsRegistry()).toBe(fixture);
    expect(getAccountsRegistry()).toBe(fixture);
  });

  it('after an override reset, a plain reset restores the default build', () => {
    const fixture = buildAccountsRegistry(ACCOUNT_CONFIG_DATA);
    __resetAccountsRegistryForTests(fixture);
    expect(getAccountsRegistry()).toBe(fixture);
    __resetAccountsRegistryForTests();
    const rebuilt = getAccountsRegistry();
    expect(rebuilt).not.toBe(fixture);
    expect(rebuilt.indexes.business).toEqual(fixture.indexes.business);
  });
});

describe('buildAccountsRegistry determinism', () => {
  it('builds from the default data and produces the same shape every call', () => {
    const a = buildAccountsRegistry();
    const b = buildAccountsRegistry();
    expect(a.allNames).toEqual(b.allNames);
    expect(a.indexes.business).toEqual(b.indexes.business);
    expect(a.indexes.vatApplicable).toEqual(b.indexes.vatApplicable);
  });

  it('does not share mutable state between two independent builds', () => {
    const a = buildAccountsRegistry();
    const b = buildAccountsRegistry();
    expect(a).not.toBe(b);
    expect(a.indexes).not.toBe(b.indexes);
  });
});
