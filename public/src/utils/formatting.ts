/**
 * Formatting utilities for the Bank Statements Dashboard
 */

import { ordinal } from '../../../shared/formatting.js';
import type { CurrencyCode } from '../../../shared/api-contracts.js';

/** Round to 2 decimal places (banker-safe). */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const CURRENCY_LOCALE: Record<CurrencyCode, string> = {
  GBP: 'en-GB',
  AED: 'en-AE',
};

/**
 * Format a number as currency.
 * Defaults to GBP when no currency code is supplied.
 */
export function formatCurrency(amount: number, currency: CurrencyCode = 'GBP'): string {
  return new Intl.NumberFormat(CURRENCY_LOCALE[currency] ?? 'en-GB', {
    style: 'currency',
    currency,
  }).format(amount);
}

/**
 * Return the narrow symbol for a supported currency code.
 */
export function currencySymbol(currency: CurrencyCode = 'GBP'): string {
  const symbols: Record<CurrencyCode, string> = { GBP: '£', AED: 'AED' };
  return symbols[currency] ?? currency;
}

/**
 * Format account name from kebab-case to Title Case
 * @example "barclays-current" => "Barclays Current"
 */
export function formatAccountName(account: string): string {
  return account
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Format a date string (YYYY-MM) to "Mon YYYY" format
 * @example "2024-11" => "Nov 2024"
 */
export function formatMonthYear(dateStr: string): string {
  const [year, month] = dateStr.split('-');
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${monthNames[parseInt(month) - 1]} ${year}`;
}

/**
 * Format an ISO calendar date (YYYY-MM-DD) for UK display (DD/MM/YYYY).
 */
export function formatIsoDateUk(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return isoDate;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const da = Number(m[3]);
  const d = new Date(y, mo - 1, da);
  if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== da) return isoDate;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'numeric', year: 'numeric' });
}

/**
 * Format an ISO calendar date (YYYY-MM-DD) for UK display in long form
 * (`DD Mmm YYYY`, e.g. `07 Jun 2026`). Preferred over the numeric variant
 * on dashboards / obligation surfaces where the extra readability offsets
 * the small width cost (month abbreviation eliminates the `DD/MM` vs
 * `MM/DD` ambiguity US-raised readers bring to a numeric date).
 */
export function formatIsoDateUkLong(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return isoDate;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const da = Number(m[3]);
  const d = new Date(y, mo - 1, da);
  if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== da) return isoDate;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * Format a quarter string for display in ZIP filenames
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
