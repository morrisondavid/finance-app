import { describe, it, expect } from 'vitest';
import { buildPayrollRegistry } from './registry.js';
import { getPeopleRegistry } from '../people/index.js';

const reg = buildPayrollRegistry();

describe('registry invariants — entries coverage', () => {
  it('byAccount total count equals entries length (no dropped entries)', () => {
    let total = 0;
    for (const [, bucket] of reg.indexes.byAccount) {
      total += bucket.length;
    }
    expect(total).toBe(reg.indexes.entries.length);
  });

  it('byPersonAccount total count equals entries length', () => {
    let total = 0;
    for (const [, bucket] of reg.indexes.byPersonAccount) {
      total += bucket.length;
    }
    expect(total).toBe(reg.indexes.entries.length);
  });
});

describe('registry invariants — index containment', () => {
  it('byAccount values ⊂ entries', () => {
    const all = new Set(reg.indexes.entries);
    for (const [, bucket] of reg.indexes.byAccount) {
      for (const entry of bucket) {
        expect(all.has(entry)).toBe(true);
      }
    }
  });

  it('byPersonAccount values ⊂ entries', () => {
    const all = new Set(reg.indexes.entries);
    for (const [, bucket] of reg.indexes.byPersonAccount) {
      for (const entry of bucket) {
        expect(all.has(entry)).toBe(true);
      }
    }
  });
});

describe('registry invariants — directorsById coherence', () => {
  it('directorsById keys ⊂ people.directors', () => {
    const directors = new Set(getPeopleRegistry().indexes.directors);
    for (const id of reg.indexes.directorsById.keys()) {
      expect(directors.has(id)).toBe(true);
    }
  });

  it("every director with a payroll entry appears in directorsById", () => {
    const directors = getPeopleRegistry().indexes.directors;
    for (const id of directors) {
      const hasPayroll = reg.indexes.entries.some(e => e.personId === id);
      expect(reg.indexes.directorsById.has(id)).toBe(hasPayroll);
    }
  });

  it('monthlySalary matches the entry.amount for every hydrated director', () => {
    for (const [id, record] of reg.indexes.directorsById) {
      const entry = reg.indexes.entries.find(e => e.personId === id);
      expect(entry).toBeDefined();
      expect(record.monthlySalary).toBe(entry!.amount);
    }
  });
});
