/**
 * Canonical category list for classification and insight (QoL vs bills split).
 * Kept in shared so browser and server use identical sets.
 */
export const CATEGORY_NAMES = [
  'Housing',
  'Utilities',
  'Groceries',
  'Eating Out',
  'Transport',
  'Shopping',
  'Entertainment',
  'Childcare & Education',
  'Health & Personal',
  'Insurance',
  'Debt Repayment',
  'Tax',
  'Business',
  'Payroll',
  'Dividends',
  'Property',
  'Transfers',
  'Accommodation',
  'Travel',
  'Income',
  'Other',
  // ── Inter-company classifications (Roadmap 1.1 / Phase 8) ──
  // These never match via merchant-registry patterns — they are
  // only ever applied via the per-transaction override CSV, once
  // the user confirms a detected UK Ltd ↔ UAE FZCO pair.
  'Inter-company Loan',
  'Capital Contribution',
  'Inter-company Service Fee',
  'Inter-company False Positive',
  'Inter-company Other',
] as const;

export type CategoryName = (typeof CATEGORY_NAMES)[number];

/**
 * The subset of {@link CategoryName} values reserved for
 * inter-company money movement classification (Phase 8). A pair is
 * considered "classified" when at least one side's category resolves
 * to one of these. The POST `/classify` endpoint accepts ONLY these
 * values (not general-purpose categories), even though the underlying
 * override CSV is general-purpose.
 */
export const INTER_COMPANY_CATEGORIES = [
  'Inter-company Loan',
  'Capital Contribution',
  'Inter-company Service Fee',
  'Inter-company False Positive',
  'Inter-company Other',
] as const satisfies readonly CategoryName[];

export type InterCompanyCategory = (typeof INTER_COMPANY_CATEGORIES)[number];

export function isInterCompanyCategory(
  category: CategoryName,
): category is InterCompanyCategory {
  return (INTER_COMPANY_CATEGORIES as readonly CategoryName[]).includes(category);
}
