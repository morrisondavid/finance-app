/**
 * Tiny shared helpers for `BankParser.emitFeedTransactionsAsCsv` so each
 * bank parser stays focused on its own column / sign mapping rather than
 * reimplementing CSV escaping or date formatting.
 *
 * Pure functions only — no I/O, no parser imports. Lives under
 * `server/parsers/lib/` so it is co-located with the parsers it serves and
 * cannot leak back into `server/ingestion/feeds/`.
 */

import { escapeCsvField } from '../../utils/csv-helpers.js';

/** Format a positive or zero number to fixed two-decimal `12345.67`. */
export function formatAmount(amount: number): string {
  return amount.toFixed(2);
}

/**
 * Format an ISO `YYYY-MM-DD` as `DD/MM/YYYY` — the most common UK CSV date
 * format used by Barclays / Capital on Tap / Barclaycard / Monzo. Returns
 * the input unchanged if the shape is not recognised so callers can fall
 * back to it for non-ISO inputs without a second branch.
 */
export function isoToDDMMYYYY(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (m === null) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/**
 * Format an ISO `YYYY-MM-DD` as NatWest's `DD MON YYYY` shape (e.g.
 * `30 Dec 2024`) so the resulting CSV's first column matches what
 * `natwestParser.parseDate` accepts on the round trip.
 */
const NATWEST_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

export function isoToNatwestDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (m === null) return iso;
  const monthIdx = parseInt(m[2], 10) - 1;
  const monthName = NATWEST_MONTHS[monthIdx] ?? m[2];
  return `${m[3]} ${monthName} ${m[1]}`;
}

/**
 * Format an ISO `YYYY-MM-DD` as Emirates Islamic's `DD-MM-YYYY` shape so
 * `emiratesIslamicParser.parseDate` accepts the round trip.
 */
export function isoToDDhyphenMMhyphenYYYY(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (m === null) return iso;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/**
 * Build a CSV string from a header tuple and a list of column→value maps.
 *
 * Missing keys serialise as empty fields. Each value is run through
 * {@link escapeCsvField} so commas, quotes, and newlines round-trip.
 */
export function buildCsv(
  headers: readonly string[],
  rows: readonly Record<string, string>[],
): string {
  const lines: string[] = [headers.join(',')];
  for (const row of rows) {
    const cells = headers.map(h => escapeCsvField(row[h] ?? ''));
    lines.push(cells.join(','));
  }
  return lines.join('\n');
}
