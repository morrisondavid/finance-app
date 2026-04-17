/**
 * Monzo Joint Account CSV Parser
 * 
 * Monzo CSV export format has columns:
 * Transaction ID, Date, Time, Type, Name, Emoji, Category, Amount, Currency,
 * Local amount, Local currency, Notes and #tags, Address, Receipt, Description,
 * Category split, Money Out, Money In
 * 
 * Date format: "DD/MM/YYYY" (e.g., "05/08/2019")
 * Amount is already signed (negative for outgoing, positive for incoming)
 * Transaction types: Faster payment, Card payment, Direct Debit, Monzo-to-Monzo, Bacs (Direct Credit)
 */

import type { BankParser, CSVRow, Transaction, ValidationResult } from '../types.js';

const MONTHS: Record<string, string> = {
  'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04', 'may': '05', 'jun': '06',
  'jul': '07', 'aug': '08', 'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12'
};

function getColumnValue(row: CSVRow, columnName: string): string {
  if (columnName in row) return row[columnName];
  const lowerCol = columnName.toLowerCase();
  const key = Object.keys(row).find(k => k.toLowerCase() === lowerCol);
  return key ? row[key] : '';
}

function parseAmount(amountStr: string | undefined): number {
  if (!amountStr || amountStr === '') return 0;

  const cleaned = amountStr.toString()
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
      parseInt(ddmmyyyy[1], 10)
    );
  }

  const parsed = new Date(dateStr);
  if (!isNaN(parsed.getTime())) {
    return parsed;
  }

  return null;
}

const monzoParser: BankParser = {
  columns: 'auto',

  dateColumn: 'Date',
  amountColumn: 'Amount',
  descriptionColumn: 'Name',

  headers: [
    'Transaction ID', 'Date', 'Time', 'Type', 'Name', 'Emoji', 'Category',
    'Amount', 'Currency', 'Local amount', 'Local currency', 'Notes and #tags',
    'Address', 'Receipt', 'Description', 'Category split', 'Money Out', 'Money In'
  ] as const,

  requiredHeaders: ['Date', 'Amount', 'Name'] as const,

  parseOptions: {
    skip_records_with_empty_values: false
  },

  validateHeaders(headers: string[]): ValidationResult {
    const normalizedHeaders = headers.map(h => h.toLowerCase().trim());
    const missing = this.requiredHeaders.filter(
      req => !normalizedHeaders.includes(req.toLowerCase())
    );
    if (missing.length > 0) {
      return { valid: false, errors: [`Missing required headers: ${missing.join(', ')}`] };
    }
    return { valid: true };
  },

  parseDate(dateStr: string): Date | null {
    if (!dateStr) return null;

    const ddmmyyyy = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (ddmmyyyy) {
      return new Date(
        parseInt(ddmmyyyy[3], 10),
        parseInt(ddmmyyyy[2], 10) - 1,
        parseInt(ddmmyyyy[1], 10)
      );
    }

    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }

    return null;
  },

  /**
   * Extract date from Monzo export filename.
   * Pattern: "MonzoDataExport_1Jan2019-12Apr2026_2026-04-12_083912.csv"
   * Extracts the end date from the range portion (e.g. "12Apr2026" -> 2026-04-12)
   * Also handles the ISO date portion after the range (e.g. "2026-04-12")
   */
  extractFilenameDate(filename: string): string | null {
    // Pattern: DDMonYYYY at end of a date range (e.g. "12Apr2026" from "1Jan2019-12Apr2026")
    const rangeMatch = filename.match(
      /\d{1,2}[A-Za-z]{3}\d{4}-(\d{1,2})([A-Za-z]{3})(\d{4})/
    );
    if (rangeMatch) {
      const monthStr = MONTHS[rangeMatch[2].toLowerCase()];
      if (monthStr) {
        const day = rangeMatch[1].padStart(2, '0');
        return `${rangeMatch[3]}-${monthStr}-${day}`;
      }
    }

    // Pattern: YYYY-MM-DD in filename
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
    const amountStr = getColumnValue(row, 'Amount');
    const amount = parseAmount(amountStr);
    const date = parseDateInternal(getColumnValue(row, 'Date'));

    if (!date) return null;
    if (amount === 0) return null;

    const name = getColumnValue(row, 'Name');
    const description = getColumnValue(row, 'Description');
    const displayDescription = name || description || getColumnValue(row, 'Type') || '';

    return {
      date,
      description: displayDescription,
      amount,
      account,
      type: amount >= 0 ? 'income' : 'expense',
    };
  }
};

export default monzoParser;
