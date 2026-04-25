/**
 * Properties registry — invariants over the live seed data + ownership.
 */

import { describe, it, expect } from 'vitest';
import { buildPropertyRegistry } from './registry.js';

const reg = buildPropertyRegistry();

describe('properties registry — coverage', () => {
  it('byId covers every entry in `all`', () => {
    for (const p of reg.all) {
      expect(reg.indexes.byId.get(p.id)).toBeDefined();
    }
  });

  it('byAddress covers every entry in `all`', () => {
    for (const p of reg.all) {
      expect(reg.indexes.byAddress.get(p.address)).toBeDefined();
    }
  });

  it('allIds matches all in declaration order', () => {
    expect(reg.allIds).toEqual(reg.all.map(p => p.id));
  });
});

describe('properties registry — ownership invariants', () => {
  it('every property has ownership shares summing to 1 (within 1e-6)', () => {
    for (const p of reg.all) {
      expect(p.ownership_david + p.ownership_heena).toBeCloseTo(1, 6);
    }
  });

  it('every property has non-negative ownership shares', () => {
    for (const p of reg.all) {
      expect(p.ownership_david).toBeGreaterThanOrEqual(0);
      expect(p.ownership_heena).toBeGreaterThanOrEqual(0);
    }
  });
});
