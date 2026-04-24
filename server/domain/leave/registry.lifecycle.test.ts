/**
 * Lifecycle semantics of the memoised default leave registry.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  __resetLeaveRegistryForTests,
  buildLeaveRegistryFromData,
  getLeaveRegistry,
  invalidateLeaveRegistry,
} from './registry.js';
import { makeStubContracts } from './test-helpers.js';

describe('getLeaveRegistry lifecycle', () => {
  afterEach(() => {
    __resetLeaveRegistryForTests();
  });

  it('memoises — repeated calls return the same reference', () => {
    __resetLeaveRegistryForTests();
    const first = getLeaveRegistry();
    const second = getLeaveRegistry();
    expect(first).toBe(second);
  });

  it('invalidateLeaveRegistry busts the cache', () => {
    __resetLeaveRegistryForTests();
    const first = getLeaveRegistry();
    invalidateLeaveRegistry();
    const second = getLeaveRegistry();
    expect(first).not.toBe(second);
    expect(first.all.length).toBe(second.all.length);
  });

  it('__resetLeaveRegistryForTests(override) swaps in a fixture', () => {
    const fixture = buildLeaveRegistryFromData([], { contracts: makeStubContracts() });
    __resetLeaveRegistryForTests(fixture);
    expect(getLeaveRegistry()).toBe(fixture);
  });
});
