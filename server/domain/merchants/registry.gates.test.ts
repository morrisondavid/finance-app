import { describe, it, expect } from 'vitest';
import { buildMerchantsRegistry } from './registry.js';
import type { MerchantEntry } from './schema.js';

const reg = buildMerchantsRegistry();

describe('indexes.patterns (gate: ordered flat list)', () => {
  it('starts with the person-derived entries (narrow payroll first, then generic transfers)', () => {
    const first = reg.indexes.patterns[0];
    expect(first.category).toBe('Payroll');
    expect(first.displayName).toBeNull();
  });

  it('follows person entries with MONZO JOINT as the first static entry', () => {
    const monzoIdx = reg.indexes.patterns.findIndex(e => e.displayName === 'Monzo Joint');
    expect(monzoIdx).toBeGreaterThan(0);
    for (let i = 0; i < monzoIdx; i++) {
      const e = reg.indexes.patterns[i];
      expect(e.category === 'Payroll' || e.category === 'Transfers').toBe(true);
    }
  });

  it('never has an entry whose category is unknown', () => {
    for (const entry of reg.indexes.patterns) {
      expect(typeof entry.category).toBe('string');
      expect(entry.category.length).toBeGreaterThan(0);
    }
  });
});

describe('indexes.byCategory (gate: group by category)', () => {
  it('has one bucket per distinct category seen in patterns', () => {
    const categoriesInPatterns = new Set(reg.indexes.patterns.map(e => e.category));
    for (const cat of categoriesInPatterns) {
      expect(reg.indexes.byCategory.has(cat)).toBe(true);
    }
  });

  it('preserves declaration order within each bucket', () => {
    for (const [, bucket] of reg.indexes.byCategory) {
      let lastIdx = -1;
      for (const entry of bucket) {
        const idx = reg.indexes.patterns.indexOf(entry);
        expect(idx).toBeGreaterThan(lastIdx);
        lastIdx = idx;
      }
    }
  });

  it('covers the Groceries category with well-known entries', () => {
    const groceries = reg.indexes.byCategory.get('Groceries') ?? [];
    const names = groceries.map(e => e.displayName);
    expect(names).toContain('Tesco');
    expect(names).toContain('Asda');
  });
});

describe('indexes.byDisplayName (gate: first-wins for named entries)', () => {
  it('never contains a key for a null-displayName entry', () => {
    for (const [name] of reg.indexes.byDisplayName) {
      expect(name).not.toBe('');
      expect(typeof name).toBe('string');
    }
  });

  it('every named entry has a reverse lookup', () => {
    for (const entry of reg.indexes.patterns) {
      if (entry.displayName === null) continue;
      const found = reg.indexes.byDisplayName.get(entry.displayName);
      expect(found).toBeDefined();
    }
  });

  it('applies first-wins semantics when a displayName appears twice', () => {
    const custom: readonly MerchantEntry[] = [
      { pattern: /FIRST/i, category: 'Shopping', displayName: 'DupeName' },
      { pattern: /SECOND/i, category: 'Business', displayName: 'DupeName' },
    ];
    const fx = buildMerchantsRegistry({ staticEntries: custom, people: [] });
    const resolved = fx.indexes.byDisplayName.get('DupeName');
    expect(resolved?.category).toBe('Shopping');
    expect(resolved?.pattern.source).toBe('FIRST');
  });
});
