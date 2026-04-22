/**
 * Merchants domain — public query surface.
 *
 * Every function here answers one named question by reading a
 * precomputed index. No function in this file contains a
 * `.filter(...)` over the raw flat list — if you find yourself
 * writing one, the answer belongs as a new index in `registry.ts`.
 *
 * Every query takes the registry as an optional parameter with
 * default `= getMerchantsRegistry()`. Tests inject fixture
 * registries without global-state pollution.
 */

import {
  getMerchantsRegistry,
  type MerchantsRegistry,
} from './registry.js';
import type { CategoryName, MerchantEntry } from './schema.js';

/** Ordered flat list of every merchant entry. */
export function allMerchantEntries(
  reg: MerchantsRegistry = getMerchantsRegistry(),
): readonly MerchantEntry[] {
  return reg.indexes.patterns;
}

/**
 * Return every entry whose category is `category`, in declaration
 * order. Returns an empty array if no entries are registered for
 * the category.
 */
export function merchantsByCategory(
  category: CategoryName,
  reg: MerchantsRegistry = getMerchantsRegistry(),
): readonly MerchantEntry[] {
  return reg.indexes.byCategory.get(category) ?? [];
}

/**
 * Lookup a named merchant entry by its cleaned `displayName`.
 * Returns `null` when the name is not registered. Category-only
 * matchers (`displayName: null`) are never returned.
 */
export function merchantByDisplayName(
  displayName: string,
  reg: MerchantsRegistry = getMerchantsRegistry(),
): MerchantEntry | null {
  return reg.indexes.byDisplayName.get(displayName) ?? null;
}

/**
 * Iterate entries top-to-bottom and return the category of the
 * first pattern that matches `normalized`. Returns `null` when no
 * entry matches — callers decide whether that means `'Other'`.
 */
export function findFirstCategoryMatch(
  normalized: string,
  reg: MerchantsRegistry = getMerchantsRegistry(),
): CategoryName | null {
  for (const entry of reg.indexes.patterns) {
    if (entry.pattern.test(normalized)) return entry.category;
  }
  return null;
}

/**
 * Iterate entries top-to-bottom and return the `displayName` of the
 * first *named* pattern that matches `normalized`. Category-only
 * matchers are skipped. Returns `null` when no named entry matches
 * — callers decide whether to apply a generic cleanup fallback.
 */
export function findFirstNamedMatch(
  normalized: string,
  reg: MerchantsRegistry = getMerchantsRegistry(),
): string | null {
  for (const entry of reg.indexes.patterns) {
    if (entry.displayName !== null && entry.pattern.test(normalized)) {
      return entry.displayName;
    }
  }
  return null;
}
