/**
 * Santander Everyday Credit Card parser.
 *
 * Santander exports statements as HTML tables wrapped in a file named
 * `Report_*.xls`. The heavy lifting (HTML -> CSV) lives in
 * {@link convertSantanderHtmlToCsv}; this parser is the thin `BankParser`
 * facade on top.
 *
 * Resulting CSV columns: `Date,Card,Description,Amount`. Amounts are already
 * signed by the converter (positive = spend, negative = payment received);
 * `normaliseCreditCardAmounts` in `server/parsers/index.ts` then flips them
 * so credit-card balance accounting works out of the box.
 */

import path from 'path';
import type {
  BankParser,
  CSVRow,
  Transaction,
  TranscodedUpload,
  ValidationResult,
} from '../types.js';
import type { InternalFeedTransactions } from '../ingestion/feeds/model.js';
import { convertSantanderHtmlToCsv, isSantanderHtmlExport } from '../utils/santander-html-converter.js';
import { buildCsv, formatAmount } from './lib/feed-emitter-helpers.js';

function getColumnValue(row: CSVRow, columnName: string): string {
  if (columnName in row) return row[columnName];
  const lower = columnName.toLowerCase();
  const key = Object.keys(row).find(k => k.toLowerCase() === lower);
  return key ? row[key] : '';
}

function parseAmount(value: string | undefined): number {
  if (!value) return 0;
  const cleaned = value.toString().replace(/[£$€,]/g, '').replace(/\s/g, '').trim();
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Scan a CSV emitted by {@link convertSantanderHtmlToCsv} for the earliest
 * transaction date. The converter guarantees ISO dates in column 0, so we can
 * walk the lines cheaply without a full CSV re-parse.
 */
function earliestTransactionDate(csv: string): string | null {
  const lines = csv.split(/\r?\n/);
  let earliest: string | null = null;
  for (let i = 1; i < lines.length; i++) {
    const firstField = lines[i].split(',', 1)[0];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(firstField)) continue;
    if (earliest === null || firstField < earliest) earliest = firstField;
  }
  return earliest;
}

function parseDateInternal(dateStr: string | undefined): Date | null {
  if (!dateStr) return null;

  // Santander's native format (what the HTML converter emits).
  const iso = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    return new Date(parseInt(iso[1], 10), parseInt(iso[2], 10) - 1, parseInt(iso[3], 10));
  }

  // Fallback: DD/MM/YYYY (matches the filename-embedded download date format).
  const dmy = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) {
    return new Date(parseInt(dmy[3], 10), parseInt(dmy[2], 10) - 1, parseInt(dmy[1], 10));
  }

  const parsed = new Date(dateStr);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const santanderEverydayParser: BankParser = {
  columns: 'auto',
  dateColumn: 'Date',
  amountColumn: 'Amount',
  descriptionColumn: 'Description',
  headers: ['Date', 'Card', 'Description', 'Amount'] as const,
  requiredHeaders: ['Date', 'Description', 'Amount'] as const,

  parseOptions: {
    skip_records_with_empty_values: false,
  },

  /**
   * Santander's web UI serves statements as HTML tables with a `.xls` wrapper.
   * Declaring the extension here lets the generic upload route accept the file
   * and delegate conversion to {@link transcodeUpload}, without any
   * account-name branching in `server/routes/upload.ts`.
   */
  acceptedUploadExtensions: ['.xls'] as const,

  /**
   * Convert a raw Santander `.xls` (really HTML) upload into the CSV shape the
   * rest of the pipeline expects, and compute a filename hint that carries
   * the statement's earliest transaction date. The download filename itself
   * only contains the request date (`Report_DDMMYYYY...`), so without this
   * hint every statement would normalise to the same `YYYY-MM_transactions_...`
   * target and collide on disk.
   */
  transcodeUpload(raw: Buffer, originalFilename: string): TranscodedUpload {
    // Santander emits ISO-8859-1 (latin1) bytes, including a literal \xA3
    // pound sign that gets mangled if we decode as UTF-8.
    const html = raw.toString('latin1');
    const csv = convertSantanderHtmlToCsv(html);

    const earliest = earliestTransactionDate(csv);
    const baseName = path.basename(originalFilename, path.extname(originalFilename));
    const filenameHint = earliest ? `${earliest}_${baseName}.csv` : `${baseName}.csv`;

    return { csv, filenameHint };
  },

  validateHeaders(headers: string[]): ValidationResult {
    const lower = headers.map(h => h.toLowerCase().trim());
    const missing = this.requiredHeaders.filter(req => !lower.includes(req.toLowerCase()));
    if (missing.length > 0) {
      return { valid: false, errors: [`Missing required headers: ${missing.join(', ')}`] };
    }
    return { valid: true };
  },

  parseDate(dateStr: string): Date | null {
    return parseDateInternal(dateStr);
  },

  /**
   * Extract a `YYYY-MM-DD` from a Santander filename. The native shape is
   * `Report_DDMYYYY...` or `Report_DDMMYYYY...` where the day is zero-padded
   * (Santander always renders 2-digit days in statement content) but the
   * month may or may not be padded. Examples seen in the wild:
   *
   *   Report_2042026...   -> 20/04/2026
   *   Report_20042026...  -> 20/04/2026
   *
   * The regex `(\d{2})(\d{1,2})(\d{4})` relies on the anchored 4-digit year
   * at the end; the `\d{1,2}` for month backtracks until the year slot is
   * satisfied, so "2042026" parses as day=20, month=4, year=2026.
   *
   * Falls back to an already-normalised `YYYY-MM-DD` prefix (used once files
   * are partitioned into monthly CSVs), then to a YYYY-MM token.
   */
  extractFilenameDate(filename: string): string | null {
    const iso = filename.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (iso) {
      return `${iso[1]}-${iso[2]}-${iso[3]}`;
    }

    const report = filename.match(/Report_(\d{2})(\d{1,2})(\d{4})/i);
    if (report) {
      const day = report[1];
      const month = report[2].padStart(2, '0');
      const year = report[3];
      return `${year}-${month}-${day}`;
    }

    const yearMonth = filename.match(/(\d{4})-(\d{2})/);
    if (yearMonth) {
      return `${yearMonth[1]}-${yearMonth[2]}-01`;
    }

    return null;
  },

  /**
   * If we receive the raw HTML export (e.g. a direct drop into the csv folder
   * that bypassed the upload route's conversion step), transparently convert
   * it so the rest of the CSV pipeline stays unaware of HTML.
   */
  preprocess(content: string): string {
    if (isSantanderHtmlExport(content)) {
      return convertSantanderHtmlToCsv(content);
    }
    return content;
  },

  transform(row: CSVRow, account: string): Transaction | null {
    const date = parseDateInternal(getColumnValue(row, 'Date'));
    if (!date) return null;

    const amount = parseAmount(getColumnValue(row, 'Amount'));
    const description = getColumnValue(row, 'Description').trim();
    if (!description) return null;

    return {
      date,
      description,
      amount,
      account,
      type: amount > 0 ? 'expense' : 'income',
    };
  },

  /**
   * Emit Santander-shaped CSV (`Date,Card,Description,Amount`) from
   * provider-neutral feed rows. Dates emitted as ISO `YYYY-MM-DD`
   * because the converter / parser already accepts that shape natively.
   *
   * Sign: Santander's `Amount` column reports purchases as **positive**
   * and payments as negative — opposite of our internal inflow-positive
   * convention. We invert here so `transform` +
   * `normaliseCreditCardAmounts` round-trips correctly.
   */
  emitFeedTransactionsAsCsv(tx: InternalFeedTransactions): string {
    const rows = tx.rows.map<Record<string, string>>(row => ({
      Date: row.date,
      Card: '',
      Description: row.description,
      Amount: formatAmount(-row.amount),
    }));
    return buildCsv(this.headers, rows);
  },
};

export default santanderEverydayParser;
