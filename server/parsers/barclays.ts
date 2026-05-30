/**
 * Barclays CSV Parser
 * 
 * Barclays CSV format typically has columns:
 * Number, Date, Account, Amount, Subcategory, Memo
 * OR
 * Date, Description, Money In, Money Out, Balance
 * 
 * This parser handles both formats.
 */

import type { BankParser, CSVRow, Transaction, ValidationResult } from '../types.js';
import type { InternalFeedTransactions } from '../ingestion/feeds/model.js';
import { defaultTrueLayerRowMapping } from '../ingestion/feeds/truelayer/truelayer-map-helpers.js';
import { buildCsv, formatAmount, isoToDDMMYYYY } from './lib/feed-emitter-helpers.js';

/**
 * Month name to number mapping for filename parsing
 */
const MONTH_MAP: Record<string, string> = {
  'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04', 'may': '05', 'jun': '06',
  'jul': '07', 'aug': '08', 'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12'
};

/**
 * Expand 2-digit year to 4-digit year
 */
function expandYear(year: string): string {
  if (year.length === 4) return year;
  const num = parseInt(year, 10);
  // Assume 00-50 is 2000s, 51-99 is 1900s
  return num <= 50 ? `20${year.padStart(2, '0')}` : `19${year}`;
}

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

const barclaysParser: BankParser = {
  columns: 'auto', // Auto-detect columns from header
  
  /** The column name that contains the transaction date */
  dateColumn: 'Date',
  
  /** The column name that contains the transaction amount */
  amountColumn: 'Amount',
  
  /** The column name that contains the transaction description */
  descriptionColumn: 'Memo',
  
  /** Column headers for output CSVs */
  headers: ['Number', 'Date', 'Account', 'Amount', 'Subcategory', 'Memo'] as const,
  
  /** Minimum required headers for validation */
  requiredHeaders: ['Date', 'Amount'] as const,
  
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
   * Pattern: "Statement 27-DEC-24 AC 63648923"
   */
  extractFilenameDate(filename: string): string | null {
    // Pattern: DD-MMM-YY or DD-MMM-YYYY (e.g., "Statement 27-DEC-24")
    const match = filename.match(/(\d{1,2})-([A-Za-z]{3})-(\d{2,4})/);
    if (match) {
      const day = match[1].padStart(2, '0');
      const month = MONTH_MAP[match[2].toLowerCase()];
      const year = expandYear(match[3]);
      return month ? `${year}-${month}-${day}` : null;
    }
    return null;
  },
  
  /**
   * Preprocess to handle Barclays specific formatting
   * - Remove leading tabs from rows
   * - Find the actual header row
   */
  preprocess(content: string): string {
    // Split into lines and process
    const lines = content.split('\n');
    let startIndex = 0;
    
    // Find the header row
    for (let i = 0; i < Math.min(lines.length, 10); i++) {
      const line = lines[i].toLowerCase();
      if (line.includes('date') && (line.includes('amount') || line.includes('money'))) {
        startIndex = i;
        break;
      }
    }
    
    // Remove leading tabs from each line (Barclays-specific issue)
    return lines.slice(startIndex)
      .map(line => line.replace(/^\t+/, ''))
      .join('\n');
  },
  
  /**
   * Transform a CSV row to normalized transaction
   */
  transform(row: CSVRow, account: string): Transaction | null {
    // Handle format with Money In / Money Out columns
    if ('Money In' in row || 'Money Out' in row || 'money in' in row || 'money out' in row) {
      const moneyIn = parseAmount(getColumnValue(row, 'Money In'));
      const moneyOut = parseAmount(getColumnValue(row, 'Money Out'));
      const date = parseDateInternal(getColumnValue(row, 'Date'));
      
      if (!date) return null;
      
      const amount = moneyIn > 0 ? moneyIn : -moneyOut;
      
      return {
        date,
        description: getColumnValue(row, 'Description') || getColumnValue(row, 'Memo') || '',
        amount,
        account,
        type: amount >= 0 ? 'income' : 'expense',
      };
    }
    
    // Handle format with single Amount column
    if ('Amount' in row || 'amount' in row) {
      const amount = parseAmount(getColumnValue(row, 'Amount'));
      const date = parseDateInternal(getColumnValue(row, 'Date'));
      
      if (!date) return null;
      
      return {
        date,
        description: getColumnValue(row, 'Description') || getColumnValue(row, 'Memo') || '',
        amount,
        account,
        type: amount >= 0 ? 'income' : 'expense',
      };
    }
    
    // Try generic column names
    const dateCol = Object.keys(row).find(k => k.toLowerCase().includes('date'));
    const amountCol = Object.keys(row).find(k => k.toLowerCase().includes('amount'));
    const descCol = Object.keys(row).find(k => 
      k.toLowerCase().includes('desc') || 
      k.toLowerCase().includes('memo') ||
      k.toLowerCase().includes('narrative')
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
        type: amount >= 0 ? 'income' : 'expense',
      };
    }
    
    return null;
  },

  mapTrueLayerTransaction(raw, ctx) {
    return defaultTrueLayerRowMapping(raw, ctx);
  },

  /**
   * Emit Barclays-shaped CSV (`Number,Date,Account,Amount,Subcategory,Memo`)
   * from provider-neutral feed rows.
   *
   * Sign: Barclays' single `Amount` column matches our internal
   * inflow-positive convention (positive = credit, negative = debit), so
   * the value passes through unchanged.
   *
   * `Number`, `Account`, `Subcategory` are bank-side annotations not
   * present on AISP feed rows — emitted blank rather than fabricated.
   */
  emitFeedTransactionsAsCsv(tx: InternalFeedTransactions): string {
    const rows = tx.rows.map<Record<string, string>>(row => ({
      Number: '',
      Date: isoToDDMMYYYY(row.date),
      Account: '',
      Amount: formatAmount(row.amount),
      Subcategory: '',
      Memo: row.description,
    }));
    return buildCsv(this.headers, rows);
  },
};

export default barclaysParser;
