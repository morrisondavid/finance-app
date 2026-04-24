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

/**
 * Format a quarter string for display in ZIP filenames.
 * @example "Q1-2025" => "VAT-Q1-Nov-Jan-2024-25"
 */
export function formatQuarterName(quarter: string): string {
  const match = quarter.match(/^(Q[1-4])-(\d{4})$/);
  if (!match) return quarter;

  const qNum = match[1];
  const year = parseInt(match[2]);
  const prevYear = year - 1;

  const quarterNames: Record<string, string> = {
    Q1: `Nov-Jan-${prevYear}-${year.toString().slice(-2)}`,
    Q2: `Feb-Apr-${year}`,
    Q3: `May-Jul-${year}`,
    Q4: `Aug-Oct-${year}`
  };

  return `VAT-${qNum}-${quarterNames[qNum] || year}`;
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
