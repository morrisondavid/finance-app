/**
 * Transaction-overrides domain — public query surface.
 *
 * Every function answers one named question by reading the
 * precomputed `indexes.byHash` map. Callers should consume these
 * queries, not `registry.indexes.byHash` directly, so the domain
 * boundary stays stable if additional indexes are added later.
 */

import type { CategoryName } from './schema.js';
import {
  getOverrideRegistry,
  type OverrideRegistry,
} from './registry.js';

/**
 * Resolve a pinned override for `hash`, or `null` if none. Drop-in
 * replacement for the old `registry.get(hash)` method.
 */
export function lookupOverride(
  hash: string,
  reg: OverrideRegistry = getOverrideRegistry(),
): CategoryName | null {
  return reg.indexes.byHash.get(hash) ?? null;
}

/**
 * Every active override (last-write-wins applied). Drop-in
 * replacement for the old `registry.entries()` method.
 */
export function allOverrides(
  reg: OverrideRegistry = getOverrideRegistry(),
): ReadonlyMap<string, CategoryName> {
  return reg.indexes.byHash;
}

/** How many distinct hashes currently carry overrides. */
export function overrideCount(
  reg: OverrideRegistry = getOverrideRegistry(),
): number {
  return reg.indexes.byHash.size;
}
