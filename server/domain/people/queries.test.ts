import { describe, it, expect } from 'vitest';
import {
  allPeople,
  allPersonIds,
  directorIds,
  directors,
  getPerson,
  isPersonId,
  getResidency,
  isNonResidentForTaxYear,
  matchPersonInDescription,
  personAliasAlternation,
  personAliasRegex,
  personNamePattern,
  personShortName,
  saFilerIds,
  saFilers,
} from './queries.js';
import { makeTestPeopleRegistry } from './fixtures.js';
import type { PersonId } from './data.js';

const reg = makeTestPeopleRegistry();

describe('allPersonIds / allPeople', () => {
  it('exposes David and Heena', () => {
    expect(allPersonIds(reg).slice().sort()).toEqual(['david', 'heena']);
  });

  it('returns records in declaration order', () => {
    expect(allPeople(reg).map(p => p.id)).toEqual(['david', 'heena']);
  });
});

describe('getPerson', () => {
  it('returns the Person for a valid id', () => {
    expect(getPerson('david', reg).name).toBe('David Morrison');
  });

  it('throws for an unknown id', () => {
    expect(() => getPerson('martha' as PersonId, reg)).toThrow(/Unknown person/);
  });
});

describe('isPersonId', () => {
  it('returns true for known ids', () => {
    expect(isPersonId('david', reg)).toBe(true);
    expect(isPersonId('heena', reg)).toBe(true);
  });

  it('returns false for unknown strings and non-strings', () => {
    expect(isPersonId('martha', reg)).toBe(false);
    expect(isPersonId('', reg)).toBe(false);
    expect(isPersonId(null, reg)).toBe(false);
    expect(isPersonId(42, reg)).toBe(false);
  });
});

describe('directors / directorIds', () => {
  it('returns ids of all seeded directors', () => {
    expect(directorIds(reg).slice().sort()).toEqual(['david', 'heena']);
  });

  it('returns hydrated records for all seeded directors', () => {
    expect(directors(reg).map(p => p.id).sort()).toEqual(['david', 'heena']);
  });
});

describe('saFilers / saFilerIds', () => {
  it('returns ids of all seeded SA filers', () => {
    expect(saFilerIds(reg).slice().sort()).toEqual(['david', 'heena']);
  });

  it('returns hydrated records for all seeded SA filers', () => {
    const filers = saFilers(reg);
    expect(filers.length).toBeGreaterThan(0);
    expect(filers.every(p => p.filesSelfAssessment === true)).toBe(true);
  });
});

describe('derivation helpers', () => {
  it('personShortName defaults to first word of name', () => {
    expect(personShortName(getPerson('david', reg))).toBe('David');
    expect(personShortName(getPerson('heena', reg))).toBe('Heena');
  });

  it('personShortName uses displayName when provided', () => {
    expect(
      personShortName({ id: 'x' as PersonId, name: 'Xavier Name', displayName: 'Xav', matchAliases: [] }),
    ).toBe('Xav');
  });

  it('personNamePattern is an UPPERCASE LIKE pattern', () => {
    expect(personNamePattern(getPerson('david', reg))).toBe('%DAVID MORRISON%');
  });

  it('personAliasAlternation joins aliases with |', () => {
    expect(personAliasAlternation(getPerson('david', reg))).toMatch(/DAVID\\s\+MORRISON.*MORRISON\\s\+DD/);
  });

  it('personAliasRegex matches every alias', () => {
    const rx = personAliasRegex(getPerson('david', reg), reg);
    expect(rx.test('something DAVID MORRISON else')).toBe(true);
    expect(rx.test('D MORRISON')).toBe(true);
  });
});

describe('matchPersonInDescription', () => {
  it('matches David by full name', () => {
    expect(matchPersonInDescription('STO SALARY DAVID MORRISON', reg)?.id).toBe('david');
  });

  it('matches David by short-form alias', () => {
    expect(matchPersonInDescription('BACS D MORRISON REF 123', reg)?.id).toBe('david');
  });

  it('matches Heena by both married and maiden aliases', () => {
    expect(matchPersonInDescription('STO SALARY HEENA TAILOR', reg)?.id).toBe('heena');
    expect(matchPersonInDescription('STO PAYROLL HEENA MORRISON', reg)?.id).toBe('heena');
  });

  it('returns null when no alias matches', () => {
    expect(matchPersonInDescription('TESCO STORES 2345', reg)).toBeNull();
  });
});

describe('residency queries', () => {
  it('defaults to UK resident when residency is absent', () => {
    const reg = makeTestPeopleRegistry([
      { id: 'david', name: 'David Test', matchAliases: ['DAVID'] },
    ]);
    expect(getResidency('david', reg).status).toBe('uk-resident');
  });

  it('david and heena are non-resident from tax year after 2025/26', () => {
    expect(isNonResidentForTaxYear('david', 2025)).toBe(false);
    expect(isNonResidentForTaxYear('david', 2026)).toBe(true);
    expect(isNonResidentForTaxYear('heena', 2026)).toBe(true);
  });

  it('getResidency returns UAE for seeded non-residents', () => {
    expect(getResidency('david').countryOfResidence).toBe('UAE');
    expect(getResidency('david').leftUkDate).toBe('2026-03-07');
  });
});

describe('query purity — injection of a fixture registry is honoured', () => {
  it('same query returns different results on different fixture registries', () => {
    const onlyDavid = makeTestPeopleRegistry([
      { id: 'david', name: 'David Morrison', isDirector: true, filesSelfAssessment: true, matchAliases: ['DAVID'] },
    ]);
    const onlyBob = makeTestPeopleRegistry([
      { id: 'bob', name: 'Bob Bobson', isDirector: false, filesSelfAssessment: false, matchAliases: ['BOB'] },
    ]);
    expect(allPersonIds(onlyDavid)).toEqual(['david']);
    expect(allPersonIds(onlyBob)).toEqual(['bob']);
    expect(directorIds(onlyDavid)).toEqual(['david']);
    expect(directorIds(onlyBob)).toEqual([]);
    expect(saFilerIds(onlyDavid)).toEqual(['david']);
    expect(saFilerIds(onlyBob)).toEqual([]);
  });
});
