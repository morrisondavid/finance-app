/**
 * CSV Validation Utility
 * 
 * Validates uploaded CSV files match the expected format for each account.
 * If invalid, the file should be deleted to protect data integrity.
 */

import fs from 'fs';
import { parse } from 'csv-parse/sync';
import { PARSERS } from '../parsers/index.js';
import type { ValidationResult } from '../types.js';

/**
 * Validate that a CSV file matches the expected format for an account
 * 
 * @param filePath - Path to the uploaded CSV file
 * @param account - Account name (e.g., 'barclays-current')
 * @returns ValidationResult with valid flag and any errors
 */
export function validateCSV(filePath: string, account: string): ValidationResult {
  const parser = PARSERS[account];
  
  if (!parser) {
    return { valid: false, errors: [`Unknown account: ${account}`] };
  }
  
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const preprocessed = parser.preprocess(content);
    
    // Parse just the header row
    const rows = parse(preprocessed, {
      columns: false,  // Get raw arrays first
      to: 1,           // Only first row (header)
      skip_empty_lines: true
    });
    
    if (rows.length === 0) {
      return { valid: false, errors: ['CSV file is empty or has no headers'] };
    }
    
    const headers = rows[0] as string[];
    return parser.validateHeaders(headers);
    
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { valid: false, errors: [`Failed to parse CSV: ${message}`] };
  }
}

/**
 * Validate and optionally delete invalid CSV
 * 
 * @param filePath - Path to the uploaded CSV file
 * @param account - Account name
 * @param deleteIfInvalid - Whether to delete the file if validation fails
 * @returns ValidationResult
 */
export function validateAndCleanup(
  filePath: string,
  account: string,
  deleteIfInvalid: boolean = true
): ValidationResult {
  const result = validateCSV(filePath, account);
  
  if (!result.valid && deleteIfInvalid) {
    try {
      fs.unlinkSync(filePath);
    } catch (err) {
      // Ignore deletion errors
      console.warn(`Failed to delete invalid CSV file: ${filePath}`);
    }
  }
  
  return result;
}
