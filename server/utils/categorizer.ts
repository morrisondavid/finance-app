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

export { CATEGORY_NAMES };
export type { CategoryName };

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

export function categorizeTransaction(description: string): CategoryName {
  const normalized = normalizeForMatching(description);
  for (const entry of MERCHANT_REGISTRY) {
    if (entry.pattern.test(normalized)) {
      return entry.category;
    }
  }
  return 'Other';
}

// ─── Colour Map ──────────────────────────────────────────────────────────────

export const CATEGORY_COLOURS: Record<CategoryName, string> = {
  'Housing':               '#6366F1',
  'Utilities':             '#06B6D4',
  'Groceries':             '#22C55E',
  'Eating Out':            '#F97316',
  'Transport':             '#EAB308',
  'Shopping':              '#EC4899',
  'Entertainment':         '#A855F7',
  'Childcare & Education': '#3B82F6',
  'Health & Personal':     '#10B981',
  'Insurance':             '#8B5CF6',
  'Debt Repayment':        '#EF4444',
  'Tax':                   '#F43F5E',
  'Business':              '#14B8A6',
  'Payroll':               '#0D9488',
  'Property':              '#F59E0B',
  'Transfers':             '#38BDF8',
  'Travel':                '#FB923C',
  'Income':                '#34D399',
  'Other':                 '#C084FC',
};
