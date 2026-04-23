/**
 * Lifecycle semantics of the memoised default contracts registry.
 *
 * Because the default registry reads the real upstream files at build
 * time, these tests exercise memoisation / invalidation behaviour
 * (which is pure of the data content) rather than data round-trips.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  __resetContractRegistryForTests,
  buildContractRegistryFromData,
  getContractRegistry,
  invalidateContractRegistry,
} from './registry.js';
import { makeStubClients, makeStubCompanies, makeStubMasters } from './test-helpers.js';

describe('getContractRegistry lifecycle', () => {
  afterEach(() => {
    __resetContractRegistryForTests();
  });

  it('memoises — repeated calls return the same reference', () => {
    __resetContractRegistryForTests();
    const first = getContractRegistry();
    const second = getContractRegistry();
    expect(first).toBe(second);
  });

  it('invalidateContractRegistry busts the cache', () => {
    __resetContractRegistryForTests();
    const first = getContractRegistry();
    invalidateContractRegistry();
    const second = getContractRegistry();
    expect(first).not.toBe(second);
    expect(first.all.length).toBe(second.all.length);
  });

  it('__resetContractRegistryForTests(override) swaps in a fixture', () => {
    const fixture = buildContractRegistryFromData([], {
      clients: makeStubClients(),
      companies: makeStubCompanies(),
      masters: makeStubMasters(),
    });
    __resetContractRegistryForTests(fixture);
    expect(getContractRegistry()).toBe(fixture);
  });
});
