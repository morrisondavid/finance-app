/**
 * Transaction categorizer -- maps transaction descriptions to spending categories.
 *
 * Reads from the single-source-of-truth merchant-registry.ts so that category
 * assignments and display names can never drift out of sync.
 *
 * Entries are checked top-to-bottom; first match wins.
 * "Transfers" entries are deliberately first so inter-account movements are caught
 * before they could accidentally match more specific categories.
 */

import { MERCHANT_REGISTRY, CATEGORY_NAMES } from './merchant-registry.js';
import type { CategoryName } from './merchant-registry.js';
import { getOverrideRegistry } from '../domain/transaction-overrides/registry.js';

export { CATEGORY_NAMES };
export type { CategoryName };

/**
 * Optional context used by the categoriser to consult the
 * per-transaction override store before falling through to the
 * description-based pattern list. Call sites that don't have a hash
 * can simply omit the arg — backward compatible.
 */
export interface CategorizeOptions {
  /** Stable transaction hash (matches `transactions.hash`). */
  hash?: string;
}

/**
 * Strip NatWest-style formatting noise before pattern matching.
 * NatWest descriptions use commas as field separators (e.g.
 * "5120 08APR26 , PAYPAL , *STEAM GAMES , 35314369001 GB")
 * and 4-digit card prefixes that would break multi-word patterns.
 */
function normalizeForMatching(description: string): string {
  return description
    .replace(/,/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function categorizeTransaction(
  description: string,
  opts?: CategorizeOptions,
): CategoryName {
  // Manual override always wins — it encodes a human assertion
  // that pattern matching cannot express (e.g. "this is an
  // inter-company loan, not a general Transfer").
  if (opts?.hash !== undefined) {
    const override = getOverrideRegistry().get(opts.hash);
    if (override !== null) return override;
  }
  const normalized = normalizeForMatching(description);
  for (const entry of MERCHANT_REGISTRY) {
    if (entry.pattern.test(normalized)) {
      return entry.category;
    }
  }
  return 'Other';
}

// ─── Category Config ─────────────────────────────────────────────────────────

interface CategoryConfig {
  colour: string;
  budgetable: boolean;
}

export const CATEGORY_CONFIG: Record<CategoryName, CategoryConfig> = {
  'Groceries':             { colour: '#22C55E', budgetable: true },
  'Eating Out':            { colour: '#F97316', budgetable: true },
  'Transport':             { colour: '#EAB308', budgetable: true },
  'Shopping':              { colour: '#EC4899', budgetable: true },
  'Entertainment':         { colour: '#A855F7', budgetable: true },
  'Childcare & Education': { colour: '#3B82F6', budgetable: true },
  'Health & Personal':     { colour: '#10B981', budgetable: true },
  'Business':              { colour: '#14B8A6', budgetable: true },
  'Accommodation':         { colour: '#B45309', budgetable: true },
  'Travel':                { colour: '#FB923C', budgetable: true },
  'Other':                 { colour: '#C084FC', budgetable: true },
  'Housing':               { colour: '#6366F1', budgetable: false },
  'Utilities':             { colour: '#06B6D4', budgetable: false },
  'Insurance':             { colour: '#8B5CF6', budgetable: false },
  'Debt Repayment':        { colour: '#EF4444', budgetable: false },
  'Tax':                   { colour: '#F43F5E', budgetable: false },
  'Payroll':               { colour: '#0D9488', budgetable: false },
  'Dividends':             { colour: '#DB2777', budgetable: false },
  'Property':              { colour: '#F59E0B', budgetable: false },
  'Transfers':             { colour: '#38BDF8', budgetable: false },
  'Income':                { colour: '#34D399', budgetable: false },
  // Inter-company (Phase 8) — never budgetable; colours are distinct
  // tints so the dashboard renders them unambiguously against the
  // general `Transfers` / `Business` colours.
  'Inter-company Loan':          { colour: '#0EA5E9', budgetable: false },
  'Capital Contribution':        { colour: '#6EE7B7', budgetable: false },
  'Inter-company Service Fee':    { colour: '#A78BFA', budgetable: false },
  'Inter-company False Positive': { colour: '#9CA3AF', budgetable: false },
  'Inter-company Other':          { colour: '#F472B6', budgetable: false },
};

export const CATEGORY_COLOURS: Record<CategoryName, string> =
  Object.fromEntries(
    CATEGORY_NAMES.map(name => [name, CATEGORY_CONFIG[name].colour]),
  ) as Record<CategoryName, string>;

const CATEGORY_COLOUR_FALLBACK = '#6B7280';

export function categoryColour(name: string): string {
  return CATEGORY_COLOURS[name as CategoryName] ?? CATEGORY_COLOUR_FALLBACK;
}
