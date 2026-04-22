import { describe, it, expect } from 'vitest';
import { groupBy, indexBy, filterToIndex, mapToIndex } from './index-builders.js';

interface Row {
  readonly id: string;
  readonly kind: 'a' | 'b';
  readonly n: number;
}

const rows: readonly Row[] = [
  { id: 'r1', kind: 'a', n: 1 },
  { id: 'r2', kind: 'a', n: 2 },
  { id: 'r3', kind: 'b', n: 3 },
  { id: 'r4', kind: 'b', n: 4 },
];

describe('groupBy', () => {
  it('partitions items by key, preserving insertion order within groups', () => {
    const m = groupBy(rows, r => r.kind);
    expect(Array.from(m.keys())).toEqual(['a', 'b']);
    expect(m.get('a')?.map(r => r.id)).toEqual(['r1', 'r2']);
    expect(m.get('b')?.map(r => r.id)).toEqual(['r3', 'r4']);
  });

  it('returns an empty map for empty input', () => {
    const m = groupBy([], (r: Row) => r.kind);
    expect(m.size).toBe(0);
  });

  it('supports non-string keys (numbers, booleans)', () => {
    const m = groupBy(rows, r => r.n % 2 === 0);
    expect(m.get(true)?.map(r => r.id)).toEqual(['r2', 'r4']);
    expect(m.get(false)?.map(r => r.id)).toEqual(['r1', 'r3']);
  });
});

describe('indexBy (collision: throw by default)', () => {
  it('returns one item per key when keys are unique', () => {
    const m = indexBy(rows, r => r.id);
    expect(m.size).toBe(4);
    expect(m.get('r3')).toEqual({ id: 'r3', kind: 'b', n: 3 });
  });

  it('throws on a duplicate key by default', () => {
    const dupes: readonly Row[] = [
      { id: 'x', kind: 'a', n: 1 },
      { id: 'x', kind: 'b', n: 2 },
    ];
    expect(() => indexBy(dupes, r => r.id)).toThrow(/duplicate key 'x'/);
  });

  it('includes the index name in the error when provided', () => {
    const dupes: readonly Row[] = [
      { id: 'x', kind: 'a', n: 1 },
      { id: 'x', kind: 'b', n: 2 },
    ];
    expect(() => indexBy(dupes, r => r.id, { indexName: 'byAccountName' })).toThrow(
      /byAccountName.*duplicate key 'x'/,
    );
  });

  it("collision='last-wins' keeps the last item for duplicate keys", () => {
    const dupes: readonly Row[] = [
      { id: 'x', kind: 'a', n: 1 },
      { id: 'x', kind: 'b', n: 2 },
    ];
    const m = indexBy(dupes, r => r.id, { onCollision: 'last-wins' });
    expect(m.get('x')).toEqual({ id: 'x', kind: 'b', n: 2 });
  });

  it("collision='first-wins' keeps the first item for duplicate keys", () => {
    const dupes: readonly Row[] = [
      { id: 'x', kind: 'a', n: 1 },
      { id: 'x', kind: 'b', n: 2 },
    ];
    const m = indexBy(dupes, r => r.id, { onCollision: 'first-wins' });
    expect(m.get('x')).toEqual({ id: 'x', kind: 'a', n: 1 });
  });
});

describe('filterToIndex', () => {
  it('returns items matching the predicate, insertion order', () => {
    const index = filterToIndex(rows, r => r.n > 1);
    expect(index.map(r => r.id)).toEqual(['r2', 'r3', 'r4']);
  });

  it('returns an empty array when nothing matches', () => {
    const index = filterToIndex(rows, r => r.n > 100);
    expect(index).toEqual([]);
  });

  it('does not mutate the input', () => {
    const input = [...rows];
    filterToIndex(input, r => r.n > 1);
    expect(input.map(r => r.id)).toEqual(rows.map(r => r.id));
  });
});

describe('mapToIndex', () => {
  it('projects a single field out of every item', () => {
    const ids = mapToIndex(rows, r => r.id);
    expect(ids).toEqual(['r1', 'r2', 'r3', 'r4']);
  });

  it('preserves input order', () => {
    const ns = mapToIndex(rows, r => r.n);
    expect(ns).toEqual([1, 2, 3, 4]);
  });
});
