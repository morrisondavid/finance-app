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
 * Amount is typically positive for purchases, negative for payments
 */

import type { BankParser, CSVRow, Transaction, ValidationResult } from '../types.js';

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
   * Extract date from filename for normalization (returns YYYY-MM-DD or null)
   * Pattern: "Barclaycard 2024" -> extract year
   */
  extractFilenameDate(filename: string): string | null {
    // Pattern: 4-digit year
    const match = filename.match(/(\d{4})/);
    if (match) {
      // Default to December 31st of that year
      return `${match[1]}-12-31`;
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
    // Parse occurrence if present (for split payment tracking)
    const occurrenceStr = getColumnValue(row, '_occurrence');
    const occurrence = occurrenceStr && occurrenceStr !== '' ? parseInt(occurrenceStr, 10) : 1;
    
    // Find date column
    const dateValue = getColumnValue(row, 'Transaction Date') ||
                      getColumnValue(row, 'Date');
    
    const date = parseDateInternal(dateValue);
    if (!date) return null;
    
    // Get amount
    const amount = parseAmount(getColumnValue(row, 'Amount'));
    
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
      occurrence
    };
  }
};

export default barclaycardParser;
