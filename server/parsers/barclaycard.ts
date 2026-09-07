/**
 * Barclaycard CSV Parser
 * 
 * Barclaycard CSV format has columns:
 * Cardholder Name, Account Number, Transaction Date, Merchant Name, Amount,
 * Currency, Original Amount, Original Currency, Conversion Rate, Posted Date,
 * Transaction Time, Authorisation Code, Transaction ID, Merchant Category,
 * Transaction Type, MCC Description, Merchant Town/City, Merchant County/State,
 * Merchant Post code/Zipcode, MCC, Statement Cycle
 *
 * Newer portal exports rename Amount → Transaction Amount, Cardholder Name →
 * Card Holder Name, Authorisation → Authorization, County/State → Country.
 * 
 * Amount is typically positive for purchases, negative for payments
 */

import type { BankParser, CSVRow, Transaction, ValidationResult } from '../types.js';
import type { InternalFeedTransactions } from '../ingestion/feeds/model.js';
import { defaultTrueLayerRowMapping } from '../ingestion/feeds/truelayer/truelayer-map-helpers.js';
import { buildCsv, formatAmount, isoToDDMMYYYY } from './lib/feed-emitter-helpers.js';
import { AMOUNT_HEADER_ALIASES, getColumnValue } from './lib/column-value.js';

/**
 * Parse amount string to number
 */
function parseAmount(amountStr: string | undefined): number {
  if (!amountStr || amountStr === '') return 0;
  
  // Remove currency symbols and commas
  const cleaned = amountStr.toString()
    .replace(/[£$€,]/g, '')
    .replace(/\s/g, '')
    .trim();
  
  return parseFloat(cleaned) || 0;
}

/**
 * Internal date parser for transform function
 */
function parseDateInternal(dateStr: string | undefined): Date | null {
  if (!dateStr) return null;
  
  // Try DD/MM/YYYY format (with 1 or 2 digit day/month)
  const ddmmyyyy = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ddmmyyyy) {
    return new Date(
      parseInt(ddmmyyyy[3], 10),
      parseInt(ddmmyyyy[2], 10) - 1,
      parseInt(ddmmyyyy[1], 10)
    );
  }
  
  // Try DD-MM-YYYY format
  const ddmmyyyyDash = dateStr.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (ddmmyyyyDash) {
    return new Date(
      parseInt(ddmmyyyyDash[3], 10),
      parseInt(ddmmyyyyDash[2], 10) - 1,
      parseInt(ddmmyyyyDash[1], 10)
    );
  }
  
  // Try YYYY-MM-DD format
  const yyyymmdd = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (yyyymmdd) {
    return new Date(
      parseInt(yyyymmdd[1], 10),
      parseInt(yyyymmdd[2], 10) - 1,
      parseInt(yyyymmdd[3], 10)
    );
  }
  
  // Try parsing as standard date
  const parsed = new Date(dateStr);
  if (!isNaN(parsed.getTime())) {
    return parsed;
  }
  
  return null;
}

/** Month abbreviations for portal PDF filenames (`Statement12May25…`). */
const MONTH_MAP: Record<string, string> = {
  jan: '01',
  feb: '02',
  mar: '03',
  apr: '04',
  may: '05',
  jun: '06',
  jul: '07',
  aug: '08',
  sep: '09',
  oct: '10',
  nov: '11',
  dec: '12',
};

function expandTwoDigitYear(year: string): string {
  if (year.length === 4) return year;
  const num = parseInt(year, 10);
  return num <= 50 ? `20${year.padStart(2, '0')}` : `19${year}`;
}

const barclaycardParser: BankParser = {
  columns: 'auto',
  
  /** The column name that contains the transaction date */
  dateColumn: 'Transaction Date',
  
  /** The column name that contains the transaction amount */
  amountColumn: 'Amount',
  
  /** The column name that contains the transaction description */
  descriptionColumn: 'Merchant Name',
  
  /** Column headers for output CSVs */
  headers: [
    'Cardholder Name', 'Account Number', 'Transaction Date', 'Merchant Name', 'Amount',
    'Currency', 'Original Amount', 'Original Currency', 'Conversion Rate', 'Posted Date',
    'Transaction Time', 'Authorisation Code', 'Transaction ID', 'Merchant Category',
    'Transaction Type', 'MCC Description', 'Merchant Town/City', 'Merchant County/State',
    'Merchant Post code/Zipcode', 'MCC', 'Statement Cycle'
  ] as const,
  
  /** Minimum required headers for validation */
  requiredHeaders: ['Transaction Date', 'Amount', 'Merchant Name'] as const,
  
  parseOptions: {
    skip_records_with_empty_values: false
  },
  
  /**
   * Validate CSV headers - case-insensitive matching
   */
  validateHeaders(headers: string[]): ValidationResult {
    const normalizedHeaders = headers.map(h => h.toLowerCase().trim());
    const missing: string[] = [];
    if (!normalizedHeaders.includes('transaction date')) {
      missing.push('Transaction Date');
    }
    if (!normalizedHeaders.includes('merchant name')) {
      missing.push('Merchant Name');
    }
    const hasAmount = AMOUNT_HEADER_ALIASES.some(alias =>
      normalizedHeaders.includes(alias.toLowerCase()),
    );
    if (!hasAmount) {
      missing.push('Amount (or Transaction Amount)');
    }
    if (missing.length > 0) {
      return { valid: false, errors: [`Missing required headers: ${missing.join(', ')}`] };
    }
    return { valid: true };
  },
  
  /**
   * Parse a date string from the CSV into a Date object
   */
  parseDate(dateStr: string): Date | null {
    if (!dateStr) return null;
    
    // Try DD/MM/YYYY format (with 1 or 2 digit day/month)
    const ddmmyyyy = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (ddmmyyyy) {
      return new Date(
        parseInt(ddmmyyyy[3], 10),
        parseInt(ddmmyyyy[2], 10) - 1,
        parseInt(ddmmyyyy[1], 10)
      );
    }
    
    // Try DD-MM-YYYY format
    const ddmmyyyyDash = dateStr.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
    if (ddmmyyyyDash) {
      return new Date(
        parseInt(ddmmyyyyDash[3], 10),
        parseInt(ddmmyyyyDash[2], 10) - 1,
        parseInt(ddmmyyyyDash[1], 10)
      );
    }
    
    // Try YYYY-MM-DD format
    const yyyymmdd = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (yyyymmdd) {
      return new Date(
        parseInt(yyyymmdd[1], 10),
        parseInt(yyyymmdd[2], 10) - 1,
        parseInt(yyyymmdd[3], 10)
      );
    }
    
    // Try parsing as standard date
    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }
    
    return null;
  },
  
  /**
   * Extract date from filename for normalization (returns YYYY-MM-DD or null).
   *
   * Portal PDF: `Statement12May25XXXX6719.PDF` → statement date 12 May 2025.
   * Annual CSV: `Barclaycard 2024.csv` → end of calendar year.
   */
  extractFilenameDate(filename: string): string | null {
    const portalPdf = filename.match(/Statement\s*12([A-Za-z]{3})(\d{2})/i);
    if (portalPdf) {
      const month = MONTH_MAP[portalPdf[1].toLowerCase().slice(0, 3)];
      if (month !== undefined) {
        const year = expandTwoDigitYear(portalPdf[2]);
        return `${year}-${month}-12`;
      }
    }

    const annualCsv = filename.match(/Barclaycard\s+(\d{4})/i);
    if (annualCsv) {
      return `${annualCsv[1]}-12-31`;
    }

    const statementWithYear = filename.match(/Statement[_\s].*?(\d{4})/i);
    if (statementWithYear) {
      return `${statementWithYear[1]}-12-31`;
    }

    return null;
  },
  
  /**
   * Preprocess to handle Barclaycard specific formatting
   */
  preprocess(content: string): string {
    const lines = content.split('\n');
    let startIndex = 0;
    
    // Find header row
    for (let i = 0; i < Math.min(lines.length, 10); i++) {
      const line = lines[i].toLowerCase();
      if (line.includes('date') && line.includes('amount')) {
        startIndex = i;
        break;
      }
    }
    
    return lines.slice(startIndex).join('\n');
  },
  
  /**
   * Transform a CSV row to normalized transaction
   */
  transform(row: CSVRow, account: string): Transaction | null {
    // Find date column
    const dateValue = getColumnValue(row, 'Transaction Date') ||
                      getColumnValue(row, 'Date');
    
    const date = parseDateInternal(dateValue);
    if (!date) return null;
    
    const amount = parseAmount(getColumnValue(row, ...AMOUNT_HEADER_ALIASES));
    
    // Get description - Barclaycard uses "Merchant Name"
    let description = getColumnValue(row, 'Merchant Name') ||
                      getColumnValue(row, 'Description') || '';
    
    if (!description) {
      const reference = getColumnValue(row, 'Reference');
      const address = getColumnValue(row, 'Address');
      description = [reference, address].filter(Boolean).join(' - ');
    }
    
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
   * Emit Barclaycard-shaped CSV from provider-neutral feed rows.
   *
   * Sign: Barclaycard exports purchases as **positive** and payments as
   * negative (credit-card convention) — opposite of our inflow-positive
   * internal sign. We invert here so the round trip through
   * `transform` + `normaliseCreditCardAmounts` lands on the correct
   * inflow-positive value internally.
   */
  emitFeedTransactionsAsCsv(tx: InternalFeedTransactions): string {
    const rows = tx.rows.map<Record<string, string>>(row => ({
      'Cardholder Name': '',
      'Account Number': '',
      'Transaction Date': isoToDDMMYYYY(row.date),
      'Merchant Name': row.counterparty ?? row.description,
      Amount: formatAmount(-row.amount),
      Currency: row.currency,
      'Original Amount': formatAmount(-row.amount),
      'Original Currency': row.currency,
      'Conversion Rate': '',
      'Posted Date': isoToDDMMYYYY(row.date),
      'Transaction Time': '',
      'Authorisation Code': '',
      'Transaction ID': row.externalId ?? '',
      'Merchant Category': '',
      'Transaction Type': '',
      'MCC Description': '',
      'Merchant Town/City': '',
      'Merchant County/State': '',
      'Merchant Post code/Zipcode': '',
      MCC: '',
      'Statement Cycle': '',
    }));
    return buildCsv(this.headers, rows);
  },
};

export default barclaycardParser;
