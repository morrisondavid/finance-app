import { describe, it, expect } from 'vitest';
import { buildPropertyRegistryFromData } from './registry.js';
import {
  allProperties,
  allPropertyIds,
  propertyById,
  isPropertyId,
} from './queries.js';
import type { Property } from './schema.js';

const fx: readonly Property[] = [
  {
    id: 'a-property',
    address: '1 Test Lane',
    ownership_david: 0.5,
    ownership_heena: 0.5,
    notes: null,
    status: 'owned',
    sold_at: null,
    updated_at: '2026-01-01',
  },
];

describe('queries', () => {
  const reg = buildPropertyRegistryFromData(fx);

  it('allProperties returns the full list', () => {
    expect(allProperties(reg)).toEqual(fx);
  });

  it('allPropertyIds returns the ids in order', () => {
    expect(allPropertyIds(reg)).toEqual(['a-property']);
  });

  it('propertyById returns the property for a known id', () => {
    expect(propertyById('a-property', reg)?.address).toBe('1 Test Lane');
  });

  it('propertyById returns null for an unknown id', () => {
    expect(propertyById('zzz', reg)).toBeNull();
  });

  it('isPropertyId narrows correctly', () => {
    expect(isPropertyId('a-property', reg)).toBe(true);
    expect(isPropertyId('zzz', reg)).toBe(false);
    expect(isPropertyId(123, reg)).toBe(false);
  });
});
