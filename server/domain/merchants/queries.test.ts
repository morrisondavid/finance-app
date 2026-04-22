import { describe, it, expect } from 'vitest';
import {
  allMerchantEntries,
  findFirstCategoryMatch,
  findFirstNamedMatch,
  merchantByDisplayName,
  merchantsByCategory,
} from './queries.js';
import { makeTestMerchantsRegistry } from './fixtures.js';
import type { MerchantEntry } from './schema.js';

const reg = makeTestMerchantsRegistry();

describe('allMerchantEntries', () => {
  it('returns the same ordered list as registry.indexes.patterns', () => {
    expect(allMerchantEntries(reg)).toBe(reg.indexes.patterns);
  });
});

describe('merchantsByCategory', () => {
  it('returns every entry in the Groceries bucket', () => {
    const groceries = merchantsByCategory('Groceries', reg);
    expect(groceries.length).toBeGreaterThan(5);
    expect(groceries.every(e => e.category === 'Groceries')).toBe(true);
  });

  it('returns an empty array for a category with no entries', () => {
    const customReg = makeTestMerchantsRegistry({
      staticEntries: [
        { pattern: /ONE/i, category: 'Shopping', displayName: 'One' },
      ],
      people: [],
    });
    expect(merchantsByCategory('Groceries', customReg)).toEqual([]);
  });
});

describe('merchantByDisplayName', () => {
  it('resolves well-known names to their entry', () => {
    const tesco = merchantByDisplayName('Tesco', reg);
    expect(tesco?.category).toBe('Groceries');
  });

  it('returns null for unknown names', () => {
    expect(merchantByDisplayName('NotAMerchant', reg)).toBeNull();
  });
});

describe('findFirstCategoryMatch', () => {
  it('returns Groceries for a Tesco line', () => {
    expect(findFirstCategoryMatch('TESCO STORES 2345', reg)).toBe('Groceries');
  });

  it('honours first-match-wins ordering (Uber Eats before Uber)', () => {
    expect(findFirstCategoryMatch('UBER EATS', reg)).toBe('Eating Out');
    expect(findFirstCategoryMatch('UBER TRIP HELP UBER COM', reg)).toBe('Transport');
  });

  it('returns null when no entry matches', () => {
    expect(findFirstCategoryMatch('ZZZ NO MATCH', reg)).toBeNull();
  });
});

describe('findFirstNamedMatch', () => {
  it('returns the display name of the first named entry', () => {
    expect(findFirstNamedMatch('TESCO STORES 2345', reg)).toBe('Tesco');
  });

  it('skips category-only matchers (displayName: null) even when they match first', () => {
    const custom: readonly MerchantEntry[] = [
      { pattern: /WIDGET/i, category: 'Shopping', displayName: null },
      { pattern: /WIDGET CORP/i, category: 'Shopping', displayName: 'Widget Corp' },
    ];
    const fx = makeTestMerchantsRegistry({ staticEntries: custom, people: [] });
    expect(findFirstCategoryMatch('BUYING A WIDGET TODAY', fx)).toBe('Shopping');
    expect(findFirstNamedMatch('BUYING A WIDGET TODAY', fx)).toBeNull();
    expect(findFirstNamedMatch('WIDGET CORP ORDER 1', fx)).toBe('Widget Corp');
  });

  it('returns null when no named entry matches', () => {
    expect(findFirstNamedMatch('ZZZ NO MATCH', reg)).toBeNull();
  });
});

describe('query purity — injection of a fixture registry is honoured', () => {
  it('same query returns different results on different fixture registries', () => {
    const onlyA = makeTestMerchantsRegistry({
      staticEntries: [{ pattern: /APPLEA/i, category: 'Groceries', displayName: 'AppleA' }],
      people: [],
    });
    const onlyB = makeTestMerchantsRegistry({
      staticEntries: [{ pattern: /BANANAB/i, category: 'Shopping', displayName: 'BananaB' }],
      people: [],
    });
    expect(findFirstNamedMatch('APPLEA CORP', onlyA)).toBe('AppleA');
    expect(findFirstNamedMatch('APPLEA CORP', onlyB)).toBeNull();
    expect(findFirstNamedMatch('BANANAB CORP', onlyB)).toBe('BananaB');
  });
});
