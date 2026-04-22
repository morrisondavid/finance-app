import { describe, it, expect } from 'vitest';
import { shallowMergeFixture, defineFixtureBuilder } from './fixture-builder.js';

interface Data {
  readonly a: number;
  readonly b: string;
  readonly c: readonly number[];
}

describe('shallowMergeFixture', () => {
  const defaults: Data = { a: 1, b: 'hi', c: [1, 2, 3] };

  it('returns the defaults unchanged when overrides is undefined', () => {
    const result = shallowMergeFixture(defaults);
    expect(result).toEqual(defaults);
  });

  it('merges a single overridden field', () => {
    const result = shallowMergeFixture(defaults, { a: 42 });
    expect(result).toEqual({ a: 42, b: 'hi', c: [1, 2, 3] });
  });

  it('overrides a nested array by replacement (shallow — not deep merge)', () => {
    const result = shallowMergeFixture(defaults, { c: [99] });
    expect(result.c).toEqual([99]);
  });

  it('does not mutate the defaults', () => {
    const snapshot = { ...defaults, c: [...defaults.c] };
    shallowMergeFixture(defaults, { a: 42, b: 'bye' });
    expect(defaults).toEqual(snapshot);
  });

  it('returns a fresh object (identity-inequal to defaults) on merge', () => {
    const result = shallowMergeFixture(defaults, { a: 1 });
    expect(result).not.toBe(defaults);
  });
});

describe('defineFixtureBuilder', () => {
  interface Registry {
    readonly sum: number;
  }

  it('returns the same function identity (acts as a type-safe marker)', () => {
    const fn = (overrides?: Partial<Data>): Registry => ({
      sum: (overrides?.a ?? 0) + (overrides?.c?.length ?? 0),
    });
    const defined = defineFixtureBuilder<Data, Registry>(fn);
    expect(defined).toBe(fn);
  });

  it('preserves the inferred signature — a builder returns a registry given overrides', () => {
    const make = defineFixtureBuilder<Data, Registry>(overrides => ({
      sum: (overrides?.a ?? 1) + (overrides?.c?.length ?? 3),
    }));
    expect(make()).toEqual({ sum: 4 });
    expect(make({ a: 10 })).toEqual({ sum: 13 });
    expect(make({ a: 10, c: [] })).toEqual({ sum: 10 });
  });
});
