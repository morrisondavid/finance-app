/**
 * Transaction categorizer -- maps transaction descriptions to spending categories.
 *
 * Consumes the merchants domain registry so that category assignments
 * and display names cannot drift out of sync. The registry iterates
 * entries top-to-bottom; first match wins. "Transfers" entries are
 * deliberately first so inter-account movements are caught before
 * they could accidentally match more specific categories.
 */

import {
  CATEGORY_NAMES,
  findFirstCategoryMatch,
  type CategoryName,
} from '../domain/merchants/index.js';
import { lookupOverride } from '../domain/transaction-overrides/index.js';

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
    const override = lookupOverride(opts.hash);
    if (override !== null) return override;
  }
  const normalized = normalizeForMatching(description);
  return findFirstCategoryMatch(normalized) ?? 'Other';
}

// ─── Category Config ─────────────────────────────────────────────────────────

interface CategoryConfig {
  colour: string;
  budgetable: boolean;
  /**
   * Quality-of-life flag (§1.9 Debt Strategy planner). When `true`, the
   * planner respects the user's budget cap as **inviolable** — never
   * proposes reducing it. When `false` (or undefined), the budget cap
   * is **malleable**: the planner shows it in the activation UI as a
   * candidate the user can manually trim to free more headroom.
   *
   * Mandatory categories (`budgetable: false`) omit this field — they
   * are a third class entirely (already classified upstream by
   * `isMandatoryCategory`).
   *
   * Defaults seeded from a sensible UK personal-finance default set;
   * users override by editing this file (v1).
   */
  qol?: boolean;
}

export const CATEGORY_CONFIG: Record<CategoryName, CategoryConfig> = {
  // QoL: true — inviolable lifestyle budgets the planner never touches.
  'Groceries':             { colour: '#22C55E', budgetable: true, qol: true },
  'Childcare & Education': { colour: '#3B82F6', budgetable: true, qol: true },
  'Health & Personal':     { colour: '#10B981', budgetable: true, qol: true },
  // Malleable — planner can show as adjustment candidates in plan UI.
  'Eating Out':            { colour: '#F97316', budgetable: true, qol: false },
  'Transport':             { colour: '#EAB308', budgetable: true, qol: false },
  'Shopping':              { colour: '#EC4899', budgetable: true, qol: false },
  'Entertainment':         { colour: '#A855F7', budgetable: true, qol: false },
  'Business':              { colour: '#14B8A6', budgetable: true, qol: false },
  'Accommodation':         { colour: '#B45309', budgetable: true, qol: false },
  'Travel':                { colour: '#FB923C', budgetable: true, qol: false },
  'Other':                 { colour: '#C084FC', budgetable: true, qol: false },
  // Mandatory (`budgetable: false`) — `qol` field intentionally omitted.
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
