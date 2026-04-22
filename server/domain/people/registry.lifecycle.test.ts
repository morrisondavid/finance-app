import { describe, it, expect, afterEach } from 'vitest';
import {
  __resetPeopleRegistryForTests,
  buildPeopleRegistry,
  getPeopleRegistry,
  invalidatePeopleRegistry,
} from './registry.js';
import { PEOPLE_DATA } from './data.js';

describe('getPeopleRegistry lifecycle', () => {
  afterEach(() => {
    __resetPeopleRegistryForTests();
  });

  it('memoises — repeated calls return the same reference', () => {
    __resetPeopleRegistryForTests();
    const first = getPeopleRegistry();
    const second = getPeopleRegistry();
    expect(first).toBe(second);
  });

  it('invalidatePeopleRegistry busts the cache so the next get rebuilds', () => {
    __resetPeopleRegistryForTests();
    const first = getPeopleRegistry();
    invalidatePeopleRegistry();
    const second = getPeopleRegistry();
    expect(first).not.toBe(second);
    expect(first.indexes.directors).toEqual(second.indexes.directors);
  });

  it('__resetPeopleRegistryForTests(no-arg) drops the cache', () => {
    const first = getPeopleRegistry();
    __resetPeopleRegistryForTests();
    const second = getPeopleRegistry();
    expect(first).not.toBe(second);
  });

  it('__resetPeopleRegistryForTests(override) swaps in a fixture without calling build', () => {
    const fixture = buildPeopleRegistry(PEOPLE_DATA);
    __resetPeopleRegistryForTests(fixture);
    expect(getPeopleRegistry()).toBe(fixture);
    expect(getPeopleRegistry()).toBe(fixture);
  });

  it('after an override reset, a plain reset restores the default build', () => {
    const fixture = buildPeopleRegistry(PEOPLE_DATA);
    __resetPeopleRegistryForTests(fixture);
    expect(getPeopleRegistry()).toBe(fixture);
    __resetPeopleRegistryForTests();
    const rebuilt = getPeopleRegistry();
    expect(rebuilt).not.toBe(fixture);
    expect(rebuilt.indexes.directors).toEqual(fixture.indexes.directors);
  });
});

describe('buildPeopleRegistry determinism', () => {
  it('builds from the default data and produces the same shape every call', () => {
    const a = buildPeopleRegistry();
    const b = buildPeopleRegistry();
    expect(a.allIds).toEqual(b.allIds);
    expect(a.indexes.directors).toEqual(b.indexes.directors);
    expect(a.indexes.saFilers).toEqual(b.indexes.saFilers);
  });

  it('does not share mutable state between two independent builds', () => {
    const a = buildPeopleRegistry();
    const b = buildPeopleRegistry();
    expect(a).not.toBe(b);
    expect(a.indexes).not.toBe(b.indexes);
  });
});
