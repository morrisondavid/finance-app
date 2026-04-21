/**
 * Santander Everyday Credit Card HTML to CSV converter.
 *
 * Santander exports transactions as an HTML table inside a file named
 * `Report_*.xls`. The structure is a single `<table>` where each transaction
 * row uses a fixed ten-slot layout of `<td>` cells (alternating separator
 * `<td />` self-closing tags and data `<td>value</td>` cells):
 *
 *   slot 0  separator
 *   slot 1  Date         (YYYY-MM-DD)
 *   slot 2  separator
 *   slot 3  Card         ("** 3062", may be missing in malformed rows)
 *   slot 4  separator
 *   slot 5  Description  (free text, e.g. "PURCHASE - DOMESTIC ...", "DD PAYMENT RECEIVED D/DEBIT")
 *   slot 6  separator
 *   slot 7  Money In     (currency with a "£ " prefix, empty for outgoings)
 *   slot 8  separator
 *   slot 9  Money Out    (currency with a "£ " prefix, empty for payments received)
 *
 * Direction is derived exclusively from column position (slot 7 vs slot 9),
 * so we do not rely on brittle description matching for the income/expense
 * split. The description is preserved verbatim (with whitespace collapsed) so
 * downstream merchant / category rules keep working.
 *
 * `INITIAL BALANCE` rows are statement-period carry-over summaries, not real
 * transactions, and are dropped so we do not double-count balances when a
 * later statement is ingested.
 */

const CSV_HEADERS = ['Date', 'Card', 'Description', 'Amount'] as const;

/**
 * Escape a CSV field. We double-quote fields containing characters that would
 * otherwise break csv-parse (commas, quotes, newlines) and escape embedded
 * quotes per RFC 4180.
 */
function escapeCsvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Normalise the various forms of "£" the Santander export can produce:
 *  - `\u00A3`: the canonical pound sign
 *  - `\uDCA3`: a lone low surrogate that appears when raw ISO-8859-1 bytes are
 *    decoded as UTF-8 (0xA3 becomes U+DCA3 via the WHATWG replacement policy)
 *  - `&pound;`: the HTML entity
 */
function normalisePoundSigns(value: string): string {
  return value
    .replace(/\uDCA3/g, '£')
    .replace(/&pound;/gi, '£');
}

/**
 * Decode the small set of HTML entities Santander emits. We avoid pulling in a
 * full HTML parser because the export is well-behaved in practice.
 */
function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCharCode(parseInt(code, 10)));
}

/** Strip every tag and collapse whitespace into a single space. */
function stripTags(fragment: string): string {
  const withoutTags = fragment.replace(/<[^>]+>/g, '');
  const decoded = normalisePoundSigns(decodeHtmlEntities(withoutTags));
  return decoded.replace(/\s+/g, ' ').trim();
}

/** Parse a currency cell like `"£ 1,234.56"` or `"£ 0.00"` into a number. */
function parseCurrency(value: string): number | null {
  const cleaned = value.replace(/£/g, '').replace(/,/g, '').replace(/\s+/g, '').trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Heuristic: is this slot-1 value shaped like a date we can parse? */
function looksLikeDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) || /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(value);
}

/**
 * Split a single `<tr>` body into an ordered list of `<td>` cell texts. Both
 * paired (`<td>x</td>`) and self-closing (`<td />`) forms are recognised; for
 * self-closed cells we emit an empty string so slot indexes stay stable.
 */
function extractRowCells(trBody: string): string[] {
  const cells: string[] = [];
  // Match either a self-closing td or a paired one. We use a non-greedy body.
  const cellRegex = /<td\b[^>]*?\/>|<td\b[^>]*>([\s\S]*?)<\/td>/gi;
  let match: RegExpExecArray | null;
  while ((match = cellRegex.exec(trBody)) !== null) {
    const raw = match[0];
    if (raw.endsWith('/>')) {
      cells.push('');
    } else {
      cells.push(stripTags(match[1] ?? ''));
    }
  }
  return cells;
}

interface TransactionRow {
  date: string;
  card: string;
  description: string;
  amount: number;
}

function interpretCells(cells: string[]): TransactionRow | null {
  if (cells.length < 10) return null;

  const date = cells[1];
  const card = cells[3];
  const description = cells[5];
  const moneyIn = cells[7];
  const moneyOut = cells[9];

  if (!looksLikeDate(date)) return null;
  if (!description) return null;
  if (/^INITIAL BALANCE$/i.test(description)) return null;

  const inValue = parseCurrency(moneyIn);
  const outValue = parseCurrency(moneyOut);

  let signedAmount: number | null = null;
  if (inValue !== null) {
    // Money In reduces card debt -> emit as a negative so that
    // normaliseCreditCardAmounts flips it to positive (payment in).
    signedAmount = -Math.abs(inValue);
  } else if (outValue !== null) {
    // Money Out increases card debt -> emit as a positive so that
    // normaliseCreditCardAmounts flips it to negative (expense on the card).
    signedAmount = Math.abs(outValue);
  }

  if (signedAmount === null) return null;

  return {
    date,
    card: card || '** 3062',
    description,
    amount: signedAmount,
  };
}

/**
 * Convert a Santander-Everyday HTML export into a CSV string consumable by the
 * parser pipeline. The output always starts with a header line
 * `Date,Card,Description,Amount` followed by one row per real transaction.
 */
export function convertSantanderHtmlToCsv(html: string): string {
  const rows: string[] = [CSV_HEADERS.join(',')];

  const trRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let match: RegExpExecArray | null;
  while ((match = trRegex.exec(html)) !== null) {
    const cells = extractRowCells(match[1]);
    const tx = interpretCells(cells);
    if (!tx) continue;

    rows.push(
      [
        escapeCsvField(tx.date),
        escapeCsvField(tx.card),
        escapeCsvField(tx.description),
        escapeCsvField(tx.amount.toFixed(2)),
      ].join(','),
    );
  }

  return rows.join('\n') + '\n';
}

/**
 * Best-effort sniff for HTML input. True if the content starts with a DOCTYPE
 * or an `<html>` / `<table>` tag (optionally preceded by whitespace or a BOM).
 */
export function isSantanderHtmlExport(content: string): boolean {
  const head = content.replace(/^\uFEFF/, '').trimStart().slice(0, 200).toLowerCase();
  return head.startsWith('<!doctype') || head.startsWith('<html') || head.startsWith('<table');
}

export const SANTANDER_CSV_HEADERS = CSV_HEADERS;
