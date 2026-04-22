/**
 * Payroll domain — public barrel.
 *
 * Consumers should import from this module, not from the internal
 * `registry.ts` / `queries.ts` / `schema.ts` files directly.
 */

export {
  buildPayrollRegistry,
  getPayrollRegistry,
  invalidatePayrollRegistry,
  __resetPayrollRegistryForTests,
  personAccountKey,
  DEFAULT_SALARY_TOLERANCE,
  type PayrollRegistry,
  type BuildPayrollRegistryInput,
  type PayrollEntry,
} from './registry.js';

export {
  DirectorPayrollSchema,
  type DirectorPayroll,
} from './schema.js';

export {
  allPayrollEntries,
  getDirectorPayroll,
  matchPayrollEntry,
  resolveExpenseCategoryWithPayroll,
  transactionCategoryWithPayroll,
  type ResolvePayrollCategoryResult,
} from './queries.js';

export {
  makeTestPayrollRegistry,
  type TestPayrollInput,
} from './fixtures.js';
