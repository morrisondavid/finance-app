/**
 * Shared formatting helpers — pure, stringly-typed, no DOM dependencies.
 * Callable from both server and frontend code. The frontend `public/src/utils/formatting.ts`
 * re-exports these for backwards compatibility with existing call sites.
 */

import type { CurrencyCode } from './api-contracts.js';

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

const CURRENCY_LOCALE: Record<CurrencyCode, string> = {
  GBP: 'en-GB',
  AED: 'en-AE',
};

/**
 * Format a number as currency. Defaults to GBP when no currency code is supplied.
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
 * Format a YYYY-MM string to "Mon YYYY" (e.g. "2024-11" → "Nov 2024").
 */
export function formatMonthYear(dateStr: string): string {
  const [year, month] = dateStr.split('-');
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${monthNames[parseInt(month, 10) - 1]} ${year}`;
}

/** Human label for a missing reporting document slot (warnings, MCP, UI). */
export function formatReportingMissingDocLabel(
  docType: 'pdf' | 'csv',
  monthKey: string,
): string {
  const month = formatMonthYear(monthKey);
  return docType === 'pdf' ? `PDF statement — ${month}` : `Transaction CSV — ${month}`;
}

/**
 * Format an ISO calendar date (YYYY-MM-DD) for UK display (DD/MM/YYYY).
 * Returns the input unchanged when the string is not a plain ISO date or is
 * calendar-invalid (e.g. `2025-02-30`).
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
/**
 * Format a quarter string for accountant ZIP filenames.
 * @example "Q1-2025" => "VAT-Q1-Nov-Jan-2024-25"
 */
export function formatQuarterName(quarter: string): string {
  const match = quarter.match(/^(Q[1-4])-(\d{4})$/);
  if (!match) return quarter;

  const qNum = match[1];
  const year = parseInt(match[2], 10);
  const prevYear = year - 1;

  const quarterNames: Record<string, string> = {
    Q1: `Nov-Jan-${prevYear}-${year.toString().slice(-2)}`,
    Q2: `Feb-Apr-${year}`,
    Q3: `May-Jul-${year}`,
    Q4: `Aug-Oct-${year}`,
  };

  return `VAT-${qNum}-${quarterNames[qNum] ?? year}`;
}

/** Corporation-tax pack ZIP name. @example "2025/26" => "CorporationTax-FY-2025-26" */
export function formatFinancialYearPackName(fyLabel: string): string {
  const m = fyLabel.trim().match(/^(\d{4})[/-](\d{2})$/);
  if (!m) return `CorporationTax-FY-${fyLabel}`;
  return `CorporationTax-FY-${m[1]}-${m[2]}`;
}

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
