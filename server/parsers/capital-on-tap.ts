/**
 * Capital on Tap CSV Parser
 * 
 * Capital on Tap CSV format has columns:
 * Clearance Date, Authorisation Date, Description, Amount, Original Amount,
 * Original Currency, Merchant Name, Card Ending, Cardholder Name, Card Name,
 * Transaction Type, Category, Has Receipts, Note
 * 
 * Amount is typically positive for purchases (spending on credit)
 */

import type { BankParser, CSVRow, Transaction, ValidationResult } from '../types.js';
import type { InternalFeedTransactions } from '../ingestion/feeds/model.js';
import { defaultTrueLayerRowMapping } from '../ingestion/feeds/truelayer/truelayer-map-helpers.js';
import { buildCsv, formatAmount, isoToDDMMYYYY } from './lib/feed-emitter-helpers.js';

/**
 * Get column value case-insensitively
 */
function getColumnValue(row: CSVRow, columnName: string): string {
  if (columnName in row) return row[columnName];
  const lowerCol = columnName.toLowerCase();
  const key = Object.keys(row).find(k => k.toLowerCase() === lowerCol);
  return key ? row[key] : '';
}

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

const capitalOnTapParser: BankParser = {
  columns: 'auto',
  
  /** The column name that contains the transaction date */
  dateColumn: 'Clearance Date',
  
  /** The column name that contains the transaction amount */
  amountColumn: 'Amount',
  
  /** The column name that contains the transaction description */
  descriptionColumn: 'Description',
  
  /** Column headers for output CSVs */
  headers: [
    'Clearance Date', 'Authorisation Date', 'Description', 'Amount', 'Original Amount',
    'Original Currency', 'Merchant Name', 'Card Ending', 'Cardholder Name', 'Card Name',
    'Transaction Type', 'Category', 'Has Receipts', 'Note'
  ] as const,
  
  /** Minimum required headers for validation */
  requiredHeaders: ['Clearance Date', 'Amount', 'Description'] as const,
  
  parseOptions: {
    skip_records_with_empty_values: false
  },
  
  /**
   * Validate CSV headers - case-insensitive matching
   */
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
   * Extract date from filename for normalization (returns YYYY-MM-DD or null)
   * Uses the START date since the bulk of a mid-month billing cycle falls in the start month.
   */
  extractFilenameDate(filename: string): string | null {
    // Pattern: DD-MM-YYYY <separator> DD-MM-YYYY (date range)
    // Separator can be " - " (CSV filenames) or just space (PDF filenames)
    const rangeMatch = filename.match(/(\d{2})-(\d{2})-(\d{4})\s+(?:-\s+)?(\d{2})-(\d{2})-(\d{4})/);
    if (rangeMatch) {
      // Use start date: DD-MM-YYYY -> YYYY-MM-DD
      return `${rangeMatch[3]}-${rangeMatch[2]}-${rangeMatch[1]}`;
    }
    
    // Pattern: single DD-MM-YYYY
    const singleMatch = filename.match(/(\d{2})-(\d{2})-(\d{4})/);
    if (singleMatch) {
      return `${singleMatch[3]}-${singleMatch[2]}-${singleMatch[1]}`;
    }
    
    return null;
  },
  
  /**
   * Preprocess to handle Capital on Tap specific formatting
   */
  preprocess(content: string): string {
    const lines = content.split('\n');
    let startIndex = 0;
    
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
    // Find date column - Capital on Tap uses "Clearance Date"
    const dateValue = getColumnValue(row, 'Clearance Date') ||
                      getColumnValue(row, 'Transaction Date') ||
                      getColumnValue(row, 'Authorisation Date') ||
                      getColumnValue(row, 'Date') ||
                      getColumnValue(row, 'Post Date');
    
    const date = parseDateInternal(dateValue);
    if (!date) return null;
    
    // Get amount
    const amount = parseAmount(getColumnValue(row, 'Amount'));
    
    // Get description - Capital on Tap has "Description" and "Merchant Name"
    const description = getColumnValue(row, 'Description') ||
                       getColumnValue(row, 'Merchant Name') ||
                       getColumnValue(row, 'Merchant') || '';
    
    return {
      date,
      description,
      amount,
      account,
      type: amount > 0 ? 'expense' : 'income',
    };
  },

  mapTrueLayerTransaction(raw, ctx) {
    return defaultTrueLayerRowMapping(raw, ctx);
  },

  /**
   * Emit Capital on Tap-shaped CSV from provider-neutral feed rows.
   *
   * Sign: Capital on Tap exports purchases as **positive** numbers and
   * payments as negative — the opposite of our internal inflow-positive
   * convention. We invert the sign here so the round trip
   * (`emitFeedTransactionsAsCsv` → `parseCSVFile` →
   * `normaliseCreditCardAmounts`) lands on the same final
   * inflow-positive amount the rest of the app expects for credit cards.
   */
  emitFeedTransactionsAsCsv(tx: InternalFeedTransactions): string {
    const rows = tx.rows.map<Record<string, string>>(row => ({
      'Clearance Date': isoToDDMMYYYY(row.date),
      'Authorisation Date': isoToDDMMYYYY(row.date),
      Description: row.description,
      Amount: formatAmount(-row.amount),
      'Original Amount': formatAmount(-row.amount),
      'Original Currency': row.currency,
      'Merchant Name': row.counterparty ?? row.description,
      'Card Ending': '',
      'Cardholder Name': '',
      'Card Name': '',
      'Transaction Type': '',
      Category: '',
      'Has Receipts': '',
      Note: row.reference ?? '',
    }));
    return buildCsv(this.headers, rows);
  },
};

export default capitalOnTapParser;
