/**
 * NatWest CSV Parser
 * 
 * NatWest CSV format has columns:
 * Date, Type, Description, Value, Balance, Account Name, Account Number
 * 
 * Date format: "DD Mon YYYY" (e.g., "30 Dec 2024")
 */

import type { BankParser, CSVRow, Transaction, ValidationResult } from '../types.js';
import type { InternalFeedTransactions } from '../ingestion/feeds/model.js';
import { defaultTrueLayerRowMapping } from '../ingestion/feeds/truelayer/truelayer-map-helpers.js';
import { buildCsv, formatAmount, isoToNatwestDate } from './lib/feed-emitter-helpers.js';

const MONTHS: Record<string, number> = {
  'jan': 0, 'feb': 1, 'mar': 2, 'apr': 3, 'may': 4, 'jun': 5,
  'jul': 6, 'aug': 7, 'sep': 8, 'oct': 9, 'nov': 10, 'dec': 11
};

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
  
  // Try DD/MM/YYYY format
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
  
  // Try DD Mon YYYY format (e.g., "15 Jan 2024")
  const ddMonYyyy = dateStr.match(/^(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})$/i);
  if (ddMonYyyy) {
    const monthNum = MONTHS[ddMonYyyy[2].toLowerCase()];
    if (monthNum !== undefined) {
      return new Date(
        parseInt(ddMonYyyy[3], 10),
        monthNum,
        parseInt(ddMonYyyy[1], 10)
      );
    }
  }
  
  // Try parsing as standard date
  const parsed = new Date(dateStr);
  if (!isNaN(parsed.getTime())) {
    return parsed;
  }
  
  return null;
}

const natwestParser: BankParser = {
  columns: 'auto',
  
  /** The column name that contains the transaction date */
  dateColumn: 'Date',
  
  /** The column name that contains the transaction amount */
  amountColumn: 'Value',
  
  /** The column name that contains the transaction description */
  descriptionColumn: 'Description',
  
  /** Column headers for output CSVs */
  headers: ['Date', 'Type', 'Description', 'Value', 'Balance', 'Account Name', 'Account Number'] as const,
  
  /** Minimum required headers for validation */
  requiredHeaders: ['Date', 'Value', 'Description'] as const,
  
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
   * NatWest uses "DD Mon YYYY" format (e.g., "30 Dec 2024")
   */
  parseDate(dateStr: string): Date | null {
    if (!dateStr) return null;
    
    // Try DD Mon YYYY format (e.g., "30 Dec 2024")
    const ddMonYyyy = dateStr.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
    if (ddMonYyyy) {
      const monthNum = MONTHS[ddMonYyyy[2].toLowerCase()];
      if (monthNum !== undefined) {
        return new Date(
          parseInt(ddMonYyyy[3], 10),
          monthNum,
          parseInt(ddMonYyyy[1], 10)
        );
      }
    }
    
    // Try DD/MM/YYYY format
    const ddmmyyyy = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (ddmmyyyy) {
      return new Date(
        parseInt(ddmmyyyy[3], 10),
        parseInt(ddmmyyyy[2], 10) - 1,
        parseInt(ddmmyyyy[1], 10)
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
   * CSV: "MORRISONDD73193380-20260123" -> YYYYMMDD at end
   * PDF: "Statement--602308-73193380--10-12-2024-09-01-2025" -> DD-MM-YYYY date range
   */
  extractFilenameDate(filename: string): string | null {
    // Pattern: DD-MM-YYYY-DD-MM-YYYY date range (NatWest PDF filenames)
    const rangeMatch = filename.match(
      /(\d{2})-(\d{2})-(\d{4})-(\d{2})-(\d{2})-(\d{4})/
    );
    if (rangeMatch) {
      return `${rangeMatch[6]}-${rangeMatch[5]}-${rangeMatch[4]}`;
    }

    // Pattern: YYYYMMDD at end of filename (NatWest CSV filenames)
    const match = filename.match(/(\d{4})(\d{2})(\d{2})$/);
    if (match) {
      return `${match[1]}-${match[2]}-${match[3]}`;
    }
    return null;
  },
  
  /**
   * Preprocess to handle NatWest specific formatting
   */
  preprocess(content: string): string {
    const lines = content.split('\n');
    let startIndex = 0;
    
    for (let i = 0; i < Math.min(lines.length, 10); i++) {
      const line = lines[i].toLowerCase();
      if (line.includes('date') && (line.includes('value') || line.includes('paid'))) {
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
    // Handle format with Paid In / Paid Out columns
    const paidIn = getColumnValue(row, 'Paid In');
    const paidOut = getColumnValue(row, 'Paid Out');
    
    if (paidIn || paidOut) {
      const paidInAmt = parseAmount(paidIn);
      const paidOutAmt = parseAmount(paidOut);
      const date = parseDateInternal(getColumnValue(row, 'Date'));
      
      if (!date) return null;
      
      const amount = paidInAmt > 0 ? paidInAmt : -paidOutAmt;
      
      return {
        date,
        description: getColumnValue(row, 'Description') || '',
        amount,
        account,
        type: amount >= 0 ? 'income' : 'expense',
      };
    }
    
    // Handle format with Value column (negative = out, positive = in)
    const valueStr = getColumnValue(row, 'Value');
    if (valueStr) {
      const value = parseAmount(valueStr);
      const date = parseDateInternal(getColumnValue(row, 'Date'));
      
      if (!date) return null;
      
      return {
        date,
        description: getColumnValue(row, 'Description') || getColumnValue(row, 'Type') || '',
        amount: value,
        account,
        type: value >= 0 ? 'income' : 'expense',
      };
    }
    
    // Try generic approach
    const dateCol = Object.keys(row).find(k => k.toLowerCase().includes('date'));
    const amountCol = Object.keys(row).find(k => 
      k.toLowerCase().includes('amount') || k.toLowerCase().includes('value')
    );
    const descCol = Object.keys(row).find(k => 
      k.toLowerCase().includes('desc') || k.toLowerCase().includes('type')
    );
    
    if (dateCol && amountCol) {
      const date = parseDateInternal(row[dateCol]);
      const amount = parseAmount(row[amountCol]);
      
      if (!date) return null;
      
      return {
        date,
        description: descCol ? row[descCol] : '',
        amount,
        account,
        type: amount >= 0 ? 'income' : 'expense'
      };
    }
    
    return null;
  },

  mapTrueLayerTransaction(raw, ctx) {
    return defaultTrueLayerRowMapping(raw, ctx);
  },

  /**
   * Emit NatWest-shaped CSV (`Date,Type,Description,Value,Balance,
   * Account Name,Account Number`) from provider-neutral feed rows.
   *
   * Sign: NatWest's `Value` column already uses inflow-positive (positive
   * = credit, negative = debit), matching our internal convention.
   * `Type`, `Account Name`, `Account Number` are not part of the AISP
   * feed payload and emit blank rather than fabricated; `Balance` is
   * passed through when the adapter has it, otherwise blank.
   */
  emitFeedTransactionsAsCsv(tx: InternalFeedTransactions): string {
    const rows = tx.rows.map<Record<string, string>>(row => ({
      Date: isoToNatwestDate(row.date),
      Type: '',
      Description: row.description,
      Value: formatAmount(row.amount),
      Balance: row.balance !== undefined ? formatAmount(row.balance) : '',
      'Account Name': '',
      'Account Number': '',
    }));
    return buildCsv(this.headers, rows);
  },
};

export default natwestParser;
