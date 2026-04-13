import type { CategoryName } from './merchant-registry.js';

/** Categories referenced in business logic (filters, ownership rules). Values must match CategoryName. */
export const SPECIAL_CATEGORY = {
  transfers: 'Transfers',
  income: 'Income',
  debtRepayment: 'Debt Repayment',
} as const satisfies Record<string, CategoryName>;
