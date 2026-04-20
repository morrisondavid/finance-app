import { describe, it, expect } from 'vitest';
import {
  PEOPLE,
  getPerson,
  getSaFilers,
  personShortName,
  personNamePattern,
  isPersonId,
  allPersonIds,
  matchPersonInDescription,
  type PersonId,
} from './people.js';

describe('people config', () => {
  describe('PEOPLE / PersonId', () => {
    it('exposes David and Heena with stable kebab-case ids', () => {
      expect(PEOPLE.map(p => p.id).sort()).toEqual(['david', 'heena']);
    });

    it('marks both as Self Assessment filers in V1 fixtures', () => {
      expect(PEOPLE.every(p => p.filesSelfAssessment === true)).toBe(true);
    });

    it('PersonId literal union is usable at runtime via allPersonIds()', () => {
      const ids = allPersonIds();
      // compile-time: assigning concrete literals proves the union.
      const david: PersonId = 'david';
      const heena: PersonId = 'heena';
      expect(ids).toContain(david);
      expect(ids).toContain(heena);
    });
  });

  describe('getPerson', () => {
    it('returns the Person for a valid id', () => {
      const david = getPerson('david');
      expect(david.name).toBe('David Morrison');
    });

    it('throws for an unknown id', () => {
      // Bypass compile-time checks with a cast, mirroring runtime-only misuse.
      expect(() => getPerson('martha' as PersonId)).toThrow(/Unknown person/);
    });
  });

  describe('getSaFilers', () => {
    it('returns only filers', () => {
      const filers = getSaFilers();
      expect(filers.length).toBeGreaterThan(0);
      expect(filers.every(p => p.filesSelfAssessment === true)).toBe(true);
    });
  });

  describe('isPersonId', () => {
    it('returns true for known ids', () => {
      expect(isPersonId('david')).toBe(true);
      expect(isPersonId('heena')).toBe(true);
    });

    it('returns false for unknown strings and non-strings', () => {
      expect(isPersonId('martha')).toBe(false);
      expect(isPersonId('')).toBe(false);
      expect(isPersonId(null)).toBe(false);
      expect(isPersonId(42)).toBe(false);
    });
  });

  describe('derivation helpers', () => {
    it('personShortName defaults to first word of name', () => {
      expect(personShortName(getPerson('david'))).toBe('David');
      expect(personShortName(getPerson('heena'))).toBe('Heena');
    });

    it('personNamePattern is an UPPERCASE LIKE pattern', () => {
      expect(personNamePattern(getPerson('david'))).toBe('%DAVID MORRISON%');
    });
  });

  describe('matchPersonInDescription', () => {
    it('matches David by full name', () => {
      expect(matchPersonInDescription('STO SALARY DAVID MORRISON')?.id).toBe('david');
    });

    it('matches David by short-form alias', () => {
      expect(matchPersonInDescription('BACS D MORRISON REF 123')?.id).toBe('david');
    });

    it('matches Heena by both married and maiden aliases', () => {
      expect(matchPersonInDescription('STO SALARY HEENA TAILOR')?.id).toBe('heena');
      expect(matchPersonInDescription('STO PAYROLL HEENA MORRISON')?.id).toBe('heena');
    });

    it('returns null when no alias matches', () => {
      expect(matchPersonInDescription('TESCO STORES 2345')).toBeNull();
    });
  });
});
