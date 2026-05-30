/**
 * Monzo Joint Account CSV Parser
 *
 * Monzo CSV export format has columns:
 * Transaction ID, Date, Time, Type, Name, Emoji, Category, Amount, Currency,
 * Local amount, Local currency, Notes and #tags, Address, Receipt, Description,
 * Category split, Money Out, Money In, Balance, Balance currency
 *
 * Date format: "DD/MM/YYYY" (e.g., "05/08/2019")
 * Amount is already signed (negative for outgoing, positive for incoming)
 * Transaction types: Faster payment, Card payment, Direct Debit, Monzo-to-Monzo, Bacs (Direct Credit)
 */

import type { BankParser, CSVRow, Transaction, ValidationResult } from '../types.js';
import type { InternalFeedTransactions } from '../ingestion/feeds/model.js';
import { buildCsv, formatAmount, isoToDDMMYYYY } from './lib/feed-emitter-helpers.js';

const MONTHS: Record<string, string> = {
  'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04', 'may': '05', 'jun': '06',
  'jul': '07', 'aug': '08', 'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12',
};

export function getMonzoColumnValue(row: CSVRow, columnName: string): string {
  if (columnName in row) return row[columnName];
  const lowerCol = columnName.toLowerCase();
  const key = Object.keys(row).find(k => k.toLowerCase() === lowerCol);
  return key ? row[key] : '';
}

export function parseMonzoAmount(amountStr: string | undefined): number {
  if (!amountStr || amountStr === '') return 0;

  const cleaned = amountStr.toString()
    .replace(/[£$€,]/g, '')
    .replace(/\s/g, '')
    .trim();

  return parseFloat(cleaned) || 0;
}

/** Signed amount from Amount column, falling back to Money In / Money Out split columns. */
export function parseMonzoSignedAmount(row: CSVRow): number {
  const amount = parseMonzoAmount(getMonzoColumnValue(row, 'Amount'));
  if (amount !== 0) return amount;

  const moneyIn = parseMonzoAmount(getMonzoColumnValue(row, 'Money In'));
  if (moneyIn > 0) return moneyIn;

  const moneyOut = parseMonzoAmount(getMonzoColumnValue(row, 'Money Out'));
  if (moneyOut > 0) return -moneyOut;

  return 0;
}

export function parseMonzoDateInternal(dateStr: string | undefined): Date | null {
  if (!dateStr) return null;

  const ddmmyyyy = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ddmmyyyy) {
    return new Date(
      parseInt(ddmmyyyy[3], 10),
      parseInt(ddmmyyyy[2], 10) - 1,
      parseInt(ddmmyyyy[1], 10),
    );
  }

  const parsed = new Date(dateStr);
  if (!isNaN(parsed.getTime())) {
    return parsed;
  }

  return null;
}

export function formatMonzoIsoDate(date: Date): string {
  return `${date.getFullYear().toString()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const monzoParser: BankParser = {
  columns: 'auto',

  dateColumn: 'Date',
  amountColumn: 'Amount',
  descriptionColumn: 'Name',
  externalIdColumn: 'Transaction ID',

  headers: [
    'Transaction ID', 'Date', 'Time', 'Type', 'Name', 'Emoji', 'Category',
    'Amount', 'Currency', 'Local amount', 'Local currency', 'Notes and #tags',
    'Address', 'Receipt', 'Description', 'Category split', 'Money Out', 'Money In',
    'Balance', 'Balance currency',
  ] as const,

  requiredHeaders: ['Date', 'Amount', 'Name'] as const,

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
    return parseMonzoDateInternal(dateStr);
  },

  /**
   * Extract date from Monzo export filename.
   * Pattern: "MonzoDataExport_1Jan2019-12Apr2026_2026-04-12_083912.csv"
   * Extracts the end date from the range portion (e.g. "12Apr2026" -> 2026-04-12)
   * Also handles the ISO date portion after the range (e.g. "2026-04-12")
   */
  extractFilenameDate(filename: string): string | null {
    const rangeMatch = filename.match(
      /\d{1,2}[A-Za-z]{3}\d{4}-(\d{1,2})([A-Za-z]{3})(\d{4})/,
    );
    if (rangeMatch) {
      const monthStr = MONTHS[rangeMatch[2].toLowerCase()];
      if (monthStr) {
        const day = rangeMatch[1].padStart(2, '0');
        return `${rangeMatch[3]}-${monthStr}-${day}`;
      }
    }

    const isoMatch = filename.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
      return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
    }

    return null;
  },

  preprocess(content: string): string {
    return content;
  },

  transform(row: CSVRow, account: string): Transaction | null {
    const amount = parseMonzoSignedAmount(row);
    const date = parseMonzoDateInternal(getMonzoColumnValue(row, 'Date'));

    if (!date) return null;
    if (amount === 0) return null;

    const name = getMonzoColumnValue(row, 'Name');
    const description = getMonzoColumnValue(row, 'Description');
    const displayDescription = name || description || getMonzoColumnValue(row, 'Type') || '';

    const transactionId = getMonzoColumnValue(row, 'Transaction ID').trim();
    const tx: Transaction = {
      date,
      description: displayDescription,
      amount,
      account,
      type: amount >= 0 ? 'income' : 'expense',
    };
    if (transactionId !== '') {
      tx.externalId = transactionId;
    }
    return tx;
  },

  /**
   * Emit Monzo-shaped CSV from provider-neutral feed rows.
   *
   * Sign: Monzo's CSV export already uses inflow-positive (positive
   * = credit, negative = debit), matching the internal convention.
   * The two `Money In` / `Money Out` columns are populated based on the
   * sign so they round-trip with the existing parser logic.
   */
  emitFeedTransactionsAsCsv(tx: InternalFeedTransactions): string {
    const rows = tx.rows.map<Record<string, string>>(row => {
      const moneyIn = row.amount >= 0 ? formatAmount(row.amount) : '';
      const moneyOut = row.amount < 0 ? formatAmount(-row.amount) : '';
      const reference = row.reference?.trim();
      const externalId = row.externalId?.trim();
      const transactionId = (reference !== undefined && reference !== '')
        ? reference
        : (externalId ?? '');
      return {
        'Transaction ID': transactionId,
        Date: isoToDDMMYYYY(row.date),
        Time: '',
        Type: '',
        Name: row.counterparty ?? row.description,
        Emoji: '',
        Category: '',
        Amount: formatAmount(row.amount),
        Currency: row.currency,
        'Local amount': formatAmount(row.amount),
        'Local currency': row.currency,
        'Notes and #tags': '',
        Address: '',
        Receipt: '',
        Description: row.description,
        'Category split': '',
        'Money Out': moneyOut,
        'Money In': moneyIn,
        Balance: row.balance !== undefined ? formatAmount(row.balance) : '',
        'Balance currency': row.balance !== undefined ? row.currency : '',
      };
    });
    return buildCsv(this.headers, rows);
  },
};

export default monzoParser;
