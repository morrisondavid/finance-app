/**
 * Lifecycle semantics of the memoised default company registry.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  __resetCompanyRegistryForTests,
  buildCompanyRegistry,
  getCompanyRegistry,
  invalidateCompanyRegistry,
} from './registry.js';

describe('getCompanyRegistry lifecycle', () => {
  afterEach(() => {
    __resetCompanyRegistryForTests();
  });

  it('memoises — repeated calls return the same reference', () => {
    __resetCompanyRegistryForTests();
    const first = getCompanyRegistry();
    const second = getCompanyRegistry();
    expect(first).toBe(second);
  });

  it('invalidateCompanyRegistry busts the cache', () => {
    __resetCompanyRegistryForTests();
    const first = getCompanyRegistry();
    invalidateCompanyRegistry();
    const second = getCompanyRegistry();
    expect(first).not.toBe(second);
    expect(first.all.length).toBe(second.all.length);
  });

  it('__resetCompanyRegistryForTests(no-arg) drops the cache', () => {
    const first = getCompanyRegistry();
    __resetCompanyRegistryForTests();
    const second = getCompanyRegistry();
    expect(first).not.toBe(second);
  });

  it('__resetCompanyRegistryForTests(override) swaps in a fixture', () => {
    const fixture = buildCompanyRegistry();
    __resetCompanyRegistryForTests(fixture);
    expect(getCompanyRegistry()).toBe(fixture);
  });

  it('after an override reset, a plain reset restores the default build', () => {
    const fixture = buildCompanyRegistry();
    __resetCompanyRegistryForTests(fixture);
    expect(getCompanyRegistry()).toBe(fixture);
    __resetCompanyRegistryForTests();
    const rebuilt = getCompanyRegistry();
    expect(rebuilt).not.toBe(fixture);
    expect(rebuilt.all.length).toBe(fixture.all.length);
  });
});
