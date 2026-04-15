import type { CategoryName } from './category-names.js';

/** Categories referenced in business logic (filters, ownership rules). Values must match CategoryName. */
export const SPECIAL_CATEGORY = {
  transfers: 'Transfers',
  income: 'Income',
  debtRepayment: 'Debt Repayment',
  property: 'Property',
  payroll: 'Payroll',
  tax: 'Tax',
} as const satisfies Record<string, CategoryName>;
