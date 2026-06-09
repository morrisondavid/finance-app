/**
 * Formatting utilities for the Bank Statements Dashboard.
 *
 * The pure, server-reusable helpers (currency, ISO-date, month-year) have been
 * lifted to {@link ../../../shared/formatting.js} and are re-exported below so
 * existing frontend call sites continue to work unchanged. Only helpers that
 * are genuinely frontend-specific (account-name kebab-casing, VAT quarter
 * filenames, billing-day narratives) remain defined here.
 */

import { ordinal } from '../../../shared/formatting.js';

export {
  formatCurrency,
  currencySymbol,
  formatMonthYear,
  formatIsoDateUk,
  formatIsoDateUkLong,
  formatQuarterName,
  formatReportingMissingDocLabel,
} from '../../../shared/formatting.js';

/** Round to 2 decimal places (banker-safe). */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Format account name from kebab-case to Title Case.
 * @example "barclays-current" => "Barclays Current"
 */
export function formatAccountName(account: string): string {
  return account
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** CSS class for transaction amount: positive inflows use income styling. */
export function transactionAmountClass(type: string, amount: number): string {
  if (type === 'income' || (type === 'transfer' && amount > 0)) return 'income';
  if (type === 'expense' || (type === 'transfer' && amount < 0)) return 'expense';
  return type;
}

/** Prefix for transaction amount display (`+` for inflows). */
export function transactionAmountPrefix(type: string, amount: number): string {
  if (type === 'income' || (type === 'transfer' && amount > 0)) return '+';
  return '';
}

export function formatBillingDay(
  dayOfMonth: number | null,
  month: number | null,
  frequency: 'monthly' | 'annual',
): string | null {
  if (dayOfMonth === null) return null;
  if (frequency === 'annual' && month !== null) {
    const names = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `~${ordinal(dayOfMonth)} ${names[month]}`;
  }
  return `~${ordinal(dayOfMonth)} of each month`;
}
