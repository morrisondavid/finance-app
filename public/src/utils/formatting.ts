/**
 * Formatting utilities for the Bank Statements Dashboard
 */

/** Round to 2 decimal places (banker-safe). */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Format a number as GBP currency
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP'
  }).format(amount);
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
