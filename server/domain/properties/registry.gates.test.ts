/**
 * Properties registry — gate tests.
 *
 * Locks the build-time invariants and primary-key behaviour of the
 * indexes against fixture data.
 */

import { describe, it, expect } from 'vitest';
import { buildPropertyRegistryFromData } from './registry.js';
import type { Property } from './schema.js';

const propertyDefaults = {
  acquisition_date: null,
  acquisition_cost: null,
  april_2015_value: null,
  estimated_market_value: null,
  enhancement_costs: 0,
  selling_costs: 0,
} as const;

const fx: readonly Property[] = [
  {
    id: 'a-property',
    address: '1 Test Lane',
    ownership_david: 0.6,
    ownership_heena: 0.4,
    notes: null,
    status: 'owned',
    sold_at: null,
    updated_at: '2026-01-01',
    ...propertyDefaults,
  },
  {
    id: 'b-property',
    address: '2 Other Road',
    ownership_david: 0.5,
    ownership_heena: 0.5,
    notes: 'Note',
    status: 'let',
    sold_at: null,
    updated_at: '2026-02-01',
    ...propertyDefaults,
  },
];

describe('byId primary-key lookup', () => {
  const reg = buildPropertyRegistryFromData(fx);

  it('returns the full record for a known id', () => {
    expect(reg.indexes.byId.get('a-property')?.address).toBe('1 Test Lane');
  });

  it('returns undefined for an unknown id', () => {
    expect(reg.indexes.byId.get('zzz')).toBeUndefined();
  });

  it('throws on duplicate ids at build time', () => {
    const dup: readonly Property[] = [fx[0], { ...fx[0] }];
    expect(() => buildPropertyRegistryFromData(dup)).toThrow();
  });
});

describe('byAddress lookup', () => {
  const reg = buildPropertyRegistryFromData(fx);

  it('returns the property with that exact address', () => {
    expect(reg.indexes.byAddress.get('2 Other Road')?.id).toBe('b-property');
  });

  it('returns undefined for an unknown address', () => {
    expect(reg.indexes.byAddress.get('999 Nope')).toBeUndefined();
  });
});
