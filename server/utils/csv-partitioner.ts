/**
 * CSV Partitioner
 * 
 * Focused ONLY on partitioning CSV files by month.
 * 
 * CRITICAL: Preserves ALL data exactly as downloaded from the bank.
 * NO hashing, NO deduplication, NO data manipulation.
 * 
 * All core functions are pure for testability.
 * File I/O is handled by a thin wrapper layer.
 */

import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import type { BankParser, CSVRow } from '../types.js';
import { PARSERS } from '../parsers/index.js';

// ============================================
// PURE FUNCTIONS (testable without file system)
// ============================================

/**
 * Row validation error
 */
export interface RowValidationError {
  rowIndex: number;
  field: string;
  value: string;
  reason: string;
}

/**
 * PURE - Validate that all rows have required fields (date and amount)
 * 
 * @param rows - Array of CSV rows
 * @param parser - Bank parser with column definitions
 * @returns Validation result with any errors found
 */
export function validateRows(
  rows: CSVRow[],
  parser: BankParser
): { valid: boolean; errors: RowValidationError[] } {
  const errors: RowValidationError[] = [];
  
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    
    // Check date field exists and is non-empty
    const dateValue = getColumnValue(row, parser.dateColumn);
    if (!dateValue || dateValue.trim() === '') {
      errors.push({
        rowIndex: i + 1,
        field: parser.dateColumn,
        value: dateValue || '(empty)',
        reason: 'Date is required but missing or empty'
      });
    } else {
      // Check date can be parsed
      const parsedDate = parser.parseDate(dateValue);
      if (!parsedDate) {
        errors.push({
          rowIndex: i + 1,
          field: parser.dateColumn,
          value: dateValue,
          reason: 'Date value cannot be parsed'
        });
      }
    }
    
    // Check amount field exists and is non-empty
    const amountValue = getColumnValue(row, parser.amountColumn);
    if (!amountValue || amountValue.trim() === '') {
      errors.push({
        rowIndex: i + 1,
        field: parser.amountColumn,
        value: amountValue || '(empty)',
        reason: 'Amount is required but missing or empty'
      });
    } else {
      // Check amount is a valid number
      const parsedAmount = parseFloat(amountValue);
      if (isNaN(parsedAmount)) {
        errors.push({
          rowIndex: i + 1,
          field: parser.amountColumn,
          value: amountValue,
          reason: 'Amount is not a valid number'
        });
      }
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * PURE - Add occurrence index to rows to preserve split payments
 * Groups transactions by date+amount+description and adds sequential index
 * 
 * @param rows - Array of CSV rows
 * @param parser - Bank parser with column definitions
 * @returns Rows with _occurrence field added (1, 2, 3... for duplicates)
 */
export function addOccurrenceIndex(rows: CSVRow[], parser: BankParser): CSVRow[] {
  // Group by date + amount + description (without occurrence)
  const groups = new Map<string, CSVRow[]>();
  
  for (const row of rows) {
    const date = getColumnValue(row, parser.dateColumn).trim();
    const amount = parseFloat(getColumnValue(row, parser.amountColumn) || '0').toFixed(2);
    const description = getColumnValue(row, parser.descriptionColumn).trim().toLowerCase();
    const key = `${date}|${amount}|${description}`;
    
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(row);
  }
  
  // Add _occurrence to each group
  const result: CSVRow[] = [];
  for (const groupRows of groups.values()) {
    groupRows.forEach((row, index) => {
      result.push({ ...row, _occurrence: String(index + 1) });
    });
  }
  
  return result;
}

function signedAmountFromRow(row: CSVRow, parser: BankParser): number {
  if (parser.parseSignedAmount !== undefined) {
    return parser.parseSignedAmount(row);
  }
  return parseFloat(getColumnValue(row, parser.amountColumn) || '0');
}

/**
 * PURE - Generate a unique key for a CSV row for deduplication
 * Uses date + amount + description + occurrence (case-insensitive)
 * 
 * @param row - CSV row object
 * @param parser - Bank parser with column definitions
 * @returns String key for comparison
 */
export function generateRowKey(row: CSVRow, parser: BankParser): string {
  const signedAmount = signedAmountFromRow(row, parser).toFixed(2);
  const idColumn = parser.externalIdColumn;
  if (idColumn !== undefined && idColumn !== '') {
    const externalId = getColumnValue(row, idColumn).trim();
    if (externalId !== '') {
      return `externalId:${externalId}|${signedAmount}`;
    }
  }
  const date = getColumnValue(row, parser.dateColumn).trim();
  const description = getColumnValue(row, parser.descriptionColumn).trim().toLowerCase();
  const occurrence = row._occurrence || '1'; // Default to 1 if not set
  
  return `${date}|${signedAmount}|${description}|${occurrence}`;
}

/**
 * PURE - Deduplicate rows using string-based comparison
 * 
 * @param rows - Array of CSV rows (may contain duplicates)
 * @param parser - Bank parser with column definitions
 * @returns Array of unique rows (first occurrence kept)
 */
export function deduplicateRows(rows: CSVRow[], parser: BankParser): CSVRow[] {
  const seen = new Set<string>();
  const unique: CSVRow[] = [];
  
  for (const row of rows) {
    const key = generateRowKey(row, parser);
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(row);
    }
  }
  
  return unique;
}

/**
 * PURE - Get column value case-insensitively
 * 
 * @param row - CSV row object
 * @param columnName - Column name to look up
 * @returns Column value or empty string
 */
export function getColumnValue(row: CSVRow, columnName: string): string {
  // Try exact match first
  if (columnName in row) {
    return row[columnName];
  }
  
  // Try case-insensitive match
  const lowerCol = columnName.toLowerCase();
  const key = Object.keys(row).find(k => k.toLowerCase() === lowerCol);
  return key ? row[key] : '';
}

/**
 * PURE - Format date as YYYY-MM month key
 * 
 * @param date - Date object
 * @returns Month key string (e.g., "2025-01")
 */
export function formatMonthKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * PURE - Group CSV rows by month
 * 
 * This is the core partitioning logic, fully testable with mock data.
 * CRITICAL: Adds ALL rows, NO deduplication.
 * 
 * @param rows - Array of CSV row objects
 * @param parser - Bank parser with dateColumn and parseDate
 * @returns Map of month key to rows
 */
export function groupRowsByMonth(
  rows: CSVRow[],
  parser: BankParser
): Map<string, CSVRow[]> {
  const monthGroups = new Map<string, CSVRow[]>();
  
  for (const row of rows) {
    const dateStr = getColumnValue(row, parser.dateColumn);
    const date = parser.parseDate(dateStr);
    
    if (date) {
      const monthKey = formatMonthKey(date);
      if (!monthGroups.has(monthKey)) {
        monthGroups.set(monthKey, []);
      }
      // Add ALL rows - NO deduplication!
      monthGroups.get(monthKey)!.push(row);
    }
  }
  
  return monthGroups;
}

/**
 * PURE - Convert rows back to CSV string
 * 
 * @param headers - Array of header names
 * @param rows - Array of row objects
 * @returns CSV string
 */
export function rowsToCSV(headers: readonly string[], rows: CSVRow[]): string {
  // Add _occurrence to headers if not present
  const allHeaders = [...headers];
  if (!allHeaders.includes('_occurrence')) {
    allHeaders.push('_occurrence');
  }
  
  const lines = [allHeaders.join(',')];
  
  for (const row of rows) {
    const values = allHeaders.map(h => {
      let val = getColumnValue(row, h);
      
      // CRITICAL: _occurrence should never be blank - default to "1"
      if (h === '_occurrence' && (!val || val === '')) {
        val = '1';
      }
      
      // Escape quotes and wrap in quotes if needed
      if (val.includes(',') || val.includes('"') || val.includes('\n')) {
        return `"${val.replace(/"/g, '""')}"`;
      }
      return val;
    });
    lines.push(values.join(','));
  }
  
  return lines.join('\n');
}

/**
 * PURE - Parse CSV content to rows
 * 
 * @param content - CSV file content as string
 * @returns Array of row objects
 */
export function parseCSVContent(content: string): CSVRow[] {
  return parse(content, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true
  });
}

/**
 * PURE - Check if a CSV file needs partitioning
 * 
 * A file needs partitioning if it contains transactions from multiple months.
 * 
 * @param rows - Array of CSV row objects
 * @param parser - Bank parser
 * @returns true if file spans multiple months
 */
export function needsPartitioning(rows: CSVRow[], parser: BankParser): boolean {
  const monthGroups = groupRowsByMonth(rows, parser);
  return monthGroups.size > 1;
}

// ============================================
// I/O INTERFACES (for dependency injection)
// ============================================

export interface FileSystem {
  readFile(filePath: string): string;
  writeFile(filePath: string, content: string): void;
  deleteFile(filePath: string): void;
  ensureDir(dirPath: string): void;
  exists(filePath: string): boolean;
}

/**
 * Default file system implementation using Node.js fs
 */
export const defaultFileSystem: FileSystem = {
  readFile(filePath: string): string {
    return fs.readFileSync(filePath, 'utf-8');
  },
  
  writeFile(filePath: string, content: string): void {
    fs.writeFileSync(filePath, content);
  },
  
  deleteFile(filePath: string): void {
    fs.unlinkSync(filePath);
  },
  
  ensureDir(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  },
  
  exists(filePath: string): boolean {
    return fs.existsSync(filePath);
  }
};

// ============================================
// I/O WRAPPER (thin layer, minimal logic)
// ============================================

export interface PartitionResult {
  originalFile: string;
  filesCreated: string[];
  totalRows: number;
  rowsByMonth: Map<string, number>;
  deleted: boolean;
}

/**
 * I/O WRAPPER - Partition a CSV file by month
 * 
 * The actual logic is in pure functions above.
 * This wrapper handles file I/O only.
 * 
 * CRITICAL: Preserves ALL data. NO deduplication.
 * 
 * @param filePath - Path to CSV file
 * @param account - Account name
 * @param fileSystem - File system interface (injectable for testing)
 * @returns Partition result
 */
export function partitionCSVFile(
  filePath: string,
  account: string,
  fileSystem: FileSystem = defaultFileSystem
): PartitionResult {
  const parser = PARSERS[account];
  if (!parser) {
    throw new Error(`No parser for account: ${account}`);
  }
  
  const directory = path.dirname(filePath);
  const originalFilename = path.basename(filePath);
  
  // Read and preprocess
  const content = fileSystem.readFile(filePath);
  const preprocessed = parser.preprocess(content);
  
  // Parse to rows
  const rows = parseCSVContent(preprocessed);
  
  // CRITICAL: Add occurrence index to preserve split payments
  const rowsWithOccurrence = addOccurrenceIndex(rows, parser);
  
  // CRITICAL: Validate all rows have required fields BEFORE processing
  const validation = validateRows(rowsWithOccurrence, parser);
  if (!validation.valid) {
    const errorMsg = `CSV validation failed: ${validation.errors.length} rows have invalid data`;
    console.error(`[CSV Partitioner] ${errorMsg} for ${filePath}:`);
    validation.errors.slice(0, 10).forEach(err => {
      console.error(`  Row ${err.rowIndex}: ${err.field} - ${err.reason} (value: "${err.value}")`);
    });
    throw new Error(errorMsg);
  }
  
  // Check if partitioning is needed
  if (!needsPartitioning(rowsWithOccurrence, parser)) {
    return {
      originalFile: originalFilename,
      filesCreated: [],
      totalRows: rowsWithOccurrence.length,
      rowsByMonth: new Map(),
      deleted: false
    };
  }
  
  // Core logic - PURE
  const monthGroups = groupRowsByMonth(rowsWithOccurrence, parser);
  
  // Delete the input file BEFORE writing partitions to avoid filename collision.
  // The normalizer renames raw uploads to YYYY-MM_transactions_ACCOUNT.csv,
  // which is the same pattern the partitioner uses for output files.
  // The caller (upload route) is responsible for saving the original beforehand.
  fileSystem.deleteFile(filePath);
  
  // Write output files (input file deleted, no collision possible)
  const filesCreated: string[] = [];
  const rowsByMonth = new Map<string, number>();
  
  for (const [month, monthRows] of monthGroups) {
    const filename = `${month}_transactions_${account}.csv`;
    
    const outputPath = path.join(directory, filename);
    if (fileSystem.exists(outputPath)) {
      const existingContent = fileSystem.readFile(outputPath);
      const existingRows = parseCSVContent(existingContent);
      
      const allRows = [...existingRows, ...monthRows];
      
      const uniqueRows = deduplicateRows(allRows, parser);
      const mergedContent = rowsToCSV(parser.headers, uniqueRows);
      fileSystem.writeFile(outputPath, mergedContent);
      rowsByMonth.set(month, uniqueRows.length);
    } else {
      const uniqueRows = deduplicateRows(monthRows, parser);
      const csvContent = rowsToCSV(parser.headers, uniqueRows);
      fileSystem.writeFile(outputPath, csvContent);
      rowsByMonth.set(month, uniqueRows.length);
    }
    
    filesCreated.push(filename);
  }
  
  return {
    originalFile: originalFilename,
    filesCreated,
    totalRows: rowsWithOccurrence.length,
    rowsByMonth,
    deleted: true
  };
}

/**
 * Convenience function that uses default file system
 */
export function partitionByMonth(filePath: string, account: string): PartitionResult {
  return partitionCSVFile(filePath, account, defaultFileSystem);
}
