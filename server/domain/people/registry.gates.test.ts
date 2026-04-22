import { describe, it, expect } from 'vitest';
import { buildPeopleRegistry } from './registry.js';
import { PEOPLE_DATA } from './data.js';
import { makeTestPeopleRegistry } from './fixtures.js';

const reg = buildPeopleRegistry(PEOPLE_DATA);

describe('indexes.directors (gate: isDirector === true)', () => {
  it('includes every seeded director', () => {
    expect(reg.indexes.directors).toEqual(expect.arrayContaining(['david', 'heena']));
  });

  it('excludes a person with isDirector === false', () => {
    const fx = makeTestPeopleRegistry([
      { id: 'david', name: 'David Morrison', isDirector: false, matchAliases: ['DAVID'] },
      { id: 'heena', name: 'Heena Tailor', isDirector: true, matchAliases: ['HEENA'] },
    ]);
    expect(fx.indexes.directors).toEqual(['heena']);
  });

  it('excludes a person with isDirector omitted', () => {
    const fx = makeTestPeopleRegistry([
      { id: 'guest', name: 'Guest User', matchAliases: ['GUEST'] },
    ]);
    expect(fx.indexes.directors).toEqual([]);
  });
});

describe('indexes.saFilers (gate: filesSelfAssessment === true)', () => {
  it('includes every seeded filer', () => {
    expect(reg.indexes.saFilers).toEqual(expect.arrayContaining(['david', 'heena']));
  });

  it('excludes a person with filesSelfAssessment === false', () => {
    const fx = makeTestPeopleRegistry([
      { id: 'david', name: 'David Morrison', filesSelfAssessment: true, matchAliases: ['DAVID'] },
      { id: 'bob', name: 'Bob Bobson', filesSelfAssessment: false, matchAliases: ['BOB'] },
    ]);
    expect(fx.indexes.saFilers).toEqual(['david']);
  });

  it('excludes a person with filesSelfAssessment omitted', () => {
    const fx = makeTestPeopleRegistry([
      { id: 'guest', name: 'Guest User', matchAliases: ['GUEST'] },
    ]);
    expect(fx.indexes.saFilers).toEqual([]);
  });
});

describe('indexes.aliasRegexes (one precompiled regex per person)', () => {
  it('contains one entry per person id', () => {
    expect(reg.indexes.aliasRegexes.size).toBe(reg.all.length);
  });

  it('regex matches every declared alias case-insensitively', () => {
    const david = reg.indexes.aliasRegexes.get('david');
    expect(david).toBeDefined();
    expect(david!.test('bacs DAVID MORRISON reference')).toBe(true);
    expect(david!.test('david morrison')).toBe(true);
    expect(david!.test('BACS D MORRISON ref')).toBe(true);
  });

  it("does not match unrelated descriptions", () => {
    expect(reg.indexes.aliasRegexes.get('david')!.test('TESCO STORES')).toBe(false);
    expect(reg.indexes.aliasRegexes.get('heena')!.test('AMAZON UK MARKETPLACE')).toBe(false);
  });
});

describe('byId primary-key lookup', () => {
  it('returns the full record for a known id', () => {
    expect(reg.byId.get('david')?.name).toBe('David Morrison');
  });

  it('returns undefined for an unknown id', () => {
    expect(reg.byId.get('martha' as never)).toBeUndefined();
  });
});
