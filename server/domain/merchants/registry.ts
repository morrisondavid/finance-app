/**
 * Merchants domain — registry.
 *
 * The loader (`buildMerchantsRegistry`) is the one place where the
 * flat ordered entry list is turned into answers. The list itself
 * (`indexes.patterns`) IS the canonical matcher: `categorizeTransaction`
 * and `normalizeMerchant` both iterate it in order so category
 * assignments and display names can never drift out of sync.
 *
 * Person-derived entries (narrow payroll + generic transfer rows
 * for each configured person) are prepended at build time from the
 * people registry. Everything else comes from `STATIC_MERCHANT_DATA`.
 *
 * Adding a new named question:
 *   1. Add the field to `MerchantsRegistry.indexes` below.
 *   2. Populate it in `buildMerchantsRegistry` using the `_shared`
 *      index builders.
 *   3. Expose a named query in `queries.ts`.
 *   4. Document the consumer(s) in `registry.manifest.test.ts`.
 */

import { createRegistry } from '../_shared/create-registry.js';
import { groupBy } from '../_shared/index-builders.js';
import {
  allPeople,
  personAliasAlternation,
  type Person,
} from '../people/index.js';
import { STATIC_MERCHANT_DATA } from './data.js';
import type { CategoryName, MerchantEntry } from './schema.js';

export interface MerchantsRegistry {
  readonly indexes: {
    /**
     * Ordered flat list of every merchant entry — the canonical
     * first-match-wins matcher used by both `categorizeTransaction`
     * and `normalizeMerchant`. Person entries come first so narrow
     * payroll precedes generic transfers and downstream merchants.
     */
    readonly patterns: readonly MerchantEntry[];
    /**
     * Entries grouped by category, preserving declaration order
     * within each bucket. Useful for analytics / debugging surfaces
     * that list "every merchant in Business", etc.
     */
    readonly byCategory: ReadonlyMap<CategoryName, readonly MerchantEntry[]>;
    /**
     * Named entries keyed by their cleaned `displayName`. Later
     * duplicates are dropped (first-wins) so iteration order of
     * `patterns` determines which entry a name resolves to. Entries
     * with `displayName: null` (category-only matchers) are excluded.
     */
    readonly byDisplayName: ReadonlyMap<string, MerchantEntry>;
  };
}

const SALARY_KEYWORDS_SRC = '(?:SALARY|PAYROLL|WAGE|NET\\s+PAY|GROSS\\s+PAY)';

/**
 * Narrow Payroll entry for a person: matches when the description contains
 * a salary keyword AND any alias for the person, and does NOT contain
 * "DIVIDEND". Must be checked before the generic Transfers entry below.
 */
function narrowPayrollEntry(p: Person): MerchantEntry {
  const aliases = personAliasAlternation(p);
  return {
    pattern: new RegExp(
      `^(?!.*\\bDIVIDEND\\b)(?=.*\\b${SALARY_KEYWORDS_SRC}\\b).*(?:${aliases})`,
      'i',
    ),
    category: 'Payroll',
    displayName: null,
  };
}

/** Generic Transfers entry for a person: catches any alias, always displays the full name. */
function personTransferEntry(p: Person): MerchantEntry {
  return {
    pattern: new RegExp(personAliasAlternation(p), 'i'),
    category: 'Transfers',
    displayName: p.name,
  };
}

export interface BuildMerchantsRegistryInput {
  /** Static (non-person) merchant entries, in declaration order. */
  readonly staticEntries?: readonly MerchantEntry[];
  /** People to derive narrow-payroll + transfer entries for. */
  readonly people?: readonly Person[];
}

export function buildMerchantsRegistry(
  input: BuildMerchantsRegistryInput = {},
): MerchantsRegistry {
  const staticEntries = input.staticEntries ?? STATIC_MERCHANT_DATA;
  const people = input.people ?? allPeople();

  const personEntries: readonly MerchantEntry[] = [
    ...people.map(narrowPayrollEntry),
    ...people.map(personTransferEntry),
  ];

  const patterns: readonly MerchantEntry[] = [
    ...personEntries,
    ...staticEntries,
  ];

  const byCategory = groupBy(patterns, e => e.category);

  const byDisplayName = new Map<string, MerchantEntry>();
  for (const entry of patterns) {
    if (entry.displayName === null) continue;
    if (byDisplayName.has(entry.displayName)) continue;
    byDisplayName.set(entry.displayName, entry);
  }

  return {
    indexes: {
      patterns,
      byCategory,
      byDisplayName,
    },
  };
}

const handle = createRegistry<MerchantsRegistry>({
  name: 'merchants',
  build: () => buildMerchantsRegistry(),
});

export const getMerchantsRegistry = handle.get;
export const invalidateMerchantsRegistry = handle.invalidate;
export const __resetMerchantsRegistryForTests = handle.__resetForTests;
