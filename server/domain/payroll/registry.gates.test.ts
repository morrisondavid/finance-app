import { describe, it, expect } from 'vitest';
import { buildPayrollRegistry, personAccountKey } from './registry.js';

const reg = buildPayrollRegistry();

describe('indexes.entries (gate: category === payroll)', () => {
  it('has at least one entry (seed data declares David and Heena)', () => {
    expect(reg.indexes.entries.length).toBeGreaterThan(0);
  });

  it('every entry has category "payroll"', () => {
    for (const entry of reg.indexes.entries) {
      expect(entry.category).toBe('payroll');
    }
  });

  it('every entry has a non-null personId and account', () => {
    for (const entry of reg.indexes.entries) {
      expect(entry.personId).toBeTruthy();
      expect(entry.account).toBeTruthy();
    }
  });
});

describe('indexes.byAccount (gate: group by account)', () => {
  it('has at least one bucket for the barclays-current seed account', () => {
    const bucket = reg.indexes.byAccount.get('barclays-current');
    expect(bucket).toBeDefined();
    expect(bucket!.length).toBeGreaterThan(0);
  });

  it('preserves declaration order within each bucket', () => {
    for (const [, bucket] of reg.indexes.byAccount) {
      let lastIdx = -1;
      for (const entry of bucket) {
        const idx = reg.indexes.entries.indexOf(entry);
        expect(idx).toBeGreaterThan(lastIdx);
        lastIdx = idx;
      }
    }
  });
});

describe('indexes.byPersonAccount (gate: group by (personId, account))', () => {
  it('has a bucket for (david, barclays-current)', () => {
    const key = personAccountKey('david', 'barclays-current');
    const bucket = reg.indexes.byPersonAccount.get(key);
    expect(bucket).toBeDefined();
    expect(bucket!.every(e => e.personId === 'david')).toBe(true);
  });

  it('has no entries under a (person, account) pair with no payroll obligation', () => {
    const key = personAccountKey('david', 'emirates-islamic');
    const bucket = reg.indexes.byPersonAccount.get(key);
    expect(bucket).toBeUndefined();
  });
});

describe('indexes.directorsById (gate: is director AND has payroll obligation)', () => {
  it('contains every director with a payroll obligation (David, Heena)', () => {
    expect(reg.indexes.directorsById.has('david')).toBe(true);
    expect(reg.indexes.directorsById.has('heena')).toBe(true);
  });

  it("derives the name pattern from the person's name", () => {
    expect(reg.indexes.directorsById.get('david')?.namePattern).toBe(
      '%DAVID MORRISON%',
    );
  });

  it('derives the UI label from the short name', () => {
    expect(reg.indexes.directorsById.get('david')?.label).toBe("David's Tax");
  });

  it('derives the short code from the first two letters of the id', () => {
    expect(reg.indexes.directorsById.get('david')?.code).toBe('DA');
    expect(reg.indexes.directorsById.get('heena')?.code).toBe('HE');
  });
});
