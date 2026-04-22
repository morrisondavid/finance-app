/**
 * Shared SQL query condition builders
 * 
 * These functions centralize the logic for building SQL WHERE conditions
 * based on account configuration, avoiding duplication across repositories.
 */

import { getAccountConfig, isValidAccountName } from '../../domain/accounts/index.js';

/**
 * Check if transfers should be included as income for the given account filter
 */
export function shouldIncludeTransfersAsIncome(accountFilter?: string): boolean {
  if (!accountFilter || !isValidAccountName(accountFilter)) {
    // No account filter or invalid account - default to excluding transfers
    return false;
  }
  const config = getAccountConfig(accountFilter);
  return !config.excludeTransfersFromIncome;
}

/**
 * Get SQL condition for income transactions
 * When includeTransfers is true, also includes positive transfers (payments received)
 */
export function getIncomeCondition(includeTransfers: boolean): string {
  return includeTransfers
    ? `(type = 'income' OR (type = 'transfer' AND amount > 0))`
    : `type = 'income'`;
}

/**
 * Get SQL condition for expense transactions
 * When includeTransfers is true, also includes negative transfers (payments out)
 */
export function getExpenseCondition(includeTransfers: boolean): string {
  return includeTransfers
    ? `(type = 'expense' OR (type = 'transfer' AND amount < 0))`
    : `type = 'expense'`;
}

/**
 * Get SQL condition for filtering transaction types
 * Used in WHERE clauses to include/exclude transfers
 */
export function getTypeFilter(includeTransfers: boolean): string {
  return includeTransfers
    ? `1=1`  // Include all types
    : `type != 'transfer'`;
}
