/**
 * MBNA personal credit card CSV parser.
 *
 * Official online-banking export columns (quoted CSV):
 *   Transaction Date, Transaction Cleared Date, Transaction Type,
 *   Transaction Description, Transaction Amount
 *
 * Amounts follow credit-card convention: positive = charge, negative = payment.
 * `normaliseCreditCardAmounts` in `server/parsers/index.ts` inverts for balance.
 *
 * Export filenames: `{cardSuffix}_{DDMMYYYY}.csv` (e.g. `6819_17122025.csv`).
 */

import type { BankParser, CSVRow, Transaction, ValidationResult } from '../types.js';
import type { InternalFeedTransactions } from '../ingestion/feeds/model.js';
import { defaultTrueLayerRowMapping } from '../ingestion/feeds/truelayer/truelayer-map-helpers.js';
import { buildCsv, formatAmount, isoToDDMMYYYY } from './lib/feed-emitter-helpers.js';

function getColumnValue(row: CSVRow, columnName: string): string {
  if (columnName in row) return row[columnName];
  const lowerCol = columnName.toLowerCase();
  const key = Object.keys(row).find(k => k.toLowerCase() === lowerCol);
  return key ? row[key] : '';
}

function parseAmount(amountStr: string | undefined): number {
  if (!amountStr || amountStr === '') return 0;
  const cleaned = amountStr
    .toString()
    .replace(/[£$€,]/g, '')
    .replace(/\s/g, '')
    .trim();
  return parseFloat(cleaned) || 0;
}

function parseDateInternal(dateStr: string | undefined): Date | null {
  if (!dateStr) return null;

  const ddmmyyyy = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ddmmyyyy) {
    return new Date(
      parseInt(ddmmyyyy[3], 10),
      parseInt(ddmmyyyy[2], 10) - 1,
      parseInt(ddmmyyyy[1], 10),
    );
  }

  const ddmmyyyyDash = dateStr.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (ddmmyyyyDash) {
    return new Date(
      parseInt(ddmmyyyyDash[3], 10),
      parseInt(ddmmyyyyDash[2], 10) - 1,
      parseInt(ddmmyyyyDash[1], 10),
    );
  }

  const yyyymmdd = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (yyyymmdd) {
    return new Date(
      parseInt(yyyymmdd[1], 10),
      parseInt(yyyymmdd[2], 10) - 1,
      parseInt(yyyymmdd[3], 10),
    );
  }

  const parsed = new Date(dateStr);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const mbnaParser: BankParser = {
  columns: 'auto',
  dateColumn: 'Transaction Date',
  amountColumn: 'Transaction Amount',
  descriptionColumn: 'Transaction Description',
  headers: [
    'Transaction Date',
    'Transaction Cleared Date',
    'Transaction Type',
    'Transaction Description',
    'Transaction Amount',
  ] as const,
  requiredHeaders: ['Transaction Date', 'Transaction Description', 'Transaction Amount'] as const,
  parseOptions: {
    skip_records_with_empty_values: false,
  },

  validateHeaders(headers: string[]): ValidationResult {
    const normalizedHeaders = headers.map(h => h.toLowerCase().trim());
    const missing = this.requiredHeaders.filter(
      req => !normalizedHeaders.includes(req.toLowerCase()),
    );
    if (missing.length > 0) {
      return { valid: false, errors: [`Missing required headers: ${missing.join(', ')}`] };
    }
    return { valid: true };
  },

  parseDate(dateStr: string): Date | null {
    return parseDateInternal(dateStr);
  },

  extractFilenameDate(filename: string): string | null {
    const exportDate = filename.match(/_(\d{2})(\d{2})(\d{4})\.csv$/i);
    if (exportDate) {
      const [, day, month, year] = exportDate;
      return `${year}-${month}-${day}`;
    }
    const monthly = filename.match(/(\d{4})-(\d{2})_transactions_mbna/i);
    if (monthly) {
      return `${monthly[1]}-${monthly[2]}-01`;
    }
    return null;
  },

  preprocess(content: string): string {
    const lines = content.split('\n');
    let startIndex = 0;
    for (let i = 0; i < Math.min(lines.length, 10); i++) {
      const line = lines[i].toLowerCase();
      if (line.includes('transaction date') && line.includes('transaction amount')) {
        startIndex = i;
        break;
      }
    }
    return lines.slice(startIndex).join('\n');
  },

  transform(row: CSVRow, account: string): Transaction | null {
    const dateValue =
      getColumnValue(row, 'Transaction Date') ||
      getColumnValue(row, 'Date');
    const date = parseDateInternal(dateValue);
    if (!date) return null;

    const amount = parseAmount(
      getColumnValue(row, 'Transaction Amount') || getColumnValue(row, 'Amount'),
    );
    const description =
      getColumnValue(row, 'Transaction Description') ||
      getColumnValue(row, 'Description') ||
      '';

    return {
      date,
      description: description.trim(),
      amount,
      account,
      type: amount > 0 ? 'expense' : 'income',
    };
  },

  mapTrueLayerTransaction(raw, ctx) {
    return defaultTrueLayerRowMapping(raw, ctx);
  },

  /**
   * Emit MBNA-shaped CSV from provider-neutral feed rows. Purchases are
   * positive and payments negative in the export — invert here so
   * `transform` + `normaliseCreditCardAmounts` round-trip correctly.
   */
  emitFeedTransactionsAsCsv(tx: InternalFeedTransactions): string {
    const rows = tx.rows.map<Record<string, string>>(row => ({
      'Transaction Date': isoToDDMMYYYY(row.date),
      'Transaction Cleared Date': isoToDDMMYYYY(row.date),
      'Transaction Type': '',
      'Transaction Description': row.counterparty ?? row.description,
      'Transaction Amount': formatAmount(-row.amount),
    }));
    return buildCsv(this.headers, rows);
  },
};

export default mbnaParser;
