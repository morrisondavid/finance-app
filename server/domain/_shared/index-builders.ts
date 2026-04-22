/**
 * Declarative index builders for registry loaders.
 *
 * Loaders that derive indexes from a raw data array otherwise end up
 * writing the same for-loop-with-Map boilerplate in every registry.
 * These helpers let loaders stay readable: one line per index, intent
 * visible at the call site.
 *
 * Contract:
 *   - `groupBy` — partition items by key. Insertion order preserved.
 *   - `indexBy` — one item per key; configurable collision policy.
 *   - `filterToIndex` — the named version of `.filter()` for a derived
 *     index, chosen to emphasise that the output is an index (read-
 *     only, documented) rather than an ad-hoc filter at a call site.
 */

export function groupBy<T, K>(
  items: readonly T[],
  keyFn: (item: T) => K,
): ReadonlyMap<K, readonly T[]> {
  const m = new Map<K, T[]>();
  for (const item of items) {
    const k = keyFn(item);
    const existing = m.get(k);
    if (existing !== undefined) {
      existing.push(item);
    } else {
      m.set(k, [item]);
    }
  }
  return m;
}

export type CollisionPolicy = 'throw' | 'last-wins' | 'first-wins';

export function indexBy<T, K>(
  items: readonly T[],
  keyFn: (item: T) => K,
  opts?: { readonly onCollision?: CollisionPolicy; readonly indexName?: string },
): ReadonlyMap<K, T> {
  const mode: CollisionPolicy = opts?.onCollision ?? 'throw';
  const m = new Map<K, T>();
  for (const item of items) {
    const k = keyFn(item);
    if (m.has(k)) {
      if (mode === 'throw') {
        const label = opts?.indexName ?? 'indexBy';
        throw new Error(`${label}: duplicate key '${String(k)}'`);
      }
      if (mode === 'first-wins') continue;
    }
    m.set(k, item);
  }
  return m;
}

export function filterToIndex<T>(
  items: readonly T[],
  predicate: (item: T) => boolean,
): readonly T[] {
  const result: T[] = [];
  for (const item of items) {
    if (predicate(item)) result.push(item);
  }
  return result;
}

/**
 * Extract a specific field from every item. Useful for indexes that
 * project an identifier out of a richer object (e.g. `accountNames =
 * mapToField(accounts, a => a.name)`). Purely a naming aid over
 * `items.map(fn)` so the intent ("this is an index") is grep-able.
 */
export function mapToIndex<T, U>(
  items: readonly T[],
  fn: (item: T) => U,
): readonly U[] {
  return items.map(fn);
}
