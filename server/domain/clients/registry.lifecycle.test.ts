/**
 * Lifecycle semantics of the memoised default clients registry.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  __resetClientRegistryForTests,
  buildClientRegistry,
  getClientRegistry,
  invalidateClientRegistry,
} from './registry.js';

describe('getClientRegistry lifecycle', () => {
  afterEach(() => {
    __resetClientRegistryForTests();
  });

  it('memoises — repeated calls return the same reference', () => {
    __resetClientRegistryForTests();
    const first = getClientRegistry();
    const second = getClientRegistry();
    expect(first).toBe(second);
  });

  it('invalidateClientRegistry busts the cache', () => {
    __resetClientRegistryForTests();
    const first = getClientRegistry();
    invalidateClientRegistry();
    const second = getClientRegistry();
    expect(first).not.toBe(second);
    expect(first.all.length).toBe(second.all.length);
  });

  it('__resetClientRegistryForTests(no-arg) drops the cache', () => {
    const first = getClientRegistry();
    __resetClientRegistryForTests();
    const second = getClientRegistry();
    expect(first).not.toBe(second);
  });

  it('__resetClientRegistryForTests(override) swaps in a fixture', () => {
    const fixture = buildClientRegistry();
    __resetClientRegistryForTests(fixture);
    expect(getClientRegistry()).toBe(fixture);
  });

  it('after an override reset, a plain reset restores the default build', () => {
    const fixture = buildClientRegistry();
    __resetClientRegistryForTests(fixture);
    expect(getClientRegistry()).toBe(fixture);
    __resetClientRegistryForTests();
    const rebuilt = getClientRegistry();
    expect(rebuilt).not.toBe(fixture);
    expect(rebuilt.all.length).toBe(fixture.all.length);
  });
});
