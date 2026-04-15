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
] as const;

export type CategoryName = (typeof CATEGORY_NAMES)[number];
