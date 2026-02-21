/**
 * Filename Normalizer
 * 
 * Focused ONLY on normalizing filenames to a standard format: YYYY-MM_statement.ext
 * 
 * All functions are pure for testability - no side effects.
 * File I/O is handled by a thin wrapper layer.
 */

import fs from 'fs';
import path from 'path';
import type { BankParser } from '../types.js';
import { PARSERS } from '../parsers/index.js';

// ============================================
// PURE FUNCTIONS (testable without file system)
// ============================================

/**
 * PURE - Normalize a filename to YYYY-MM_TYPE_ACCOUNT.ext format
 * 
 * @param filename - The filename to normalize
 * @param parser - The parser to use for date extraction (injected for testability)
 * @param account - The account name to include in the filename
 * @returns Normalized filename or original if cannot extract date
 */
export function normalizeFilename(filename: string, parser: BankParser, account: string): string {
  if (isNormalized(filename)) {
    return filename;
  }
  
  const ext = getExtension(filename);
  const nameWithoutExt = removeExtension(filename);
  
  // Clean junk from filename
  const cleaned = cleanJunk(nameWithoutExt);
  
  // Use parser's account-specific date extraction
  const extractedDate = parser.extractFilenameDate(cleaned);
  if (!extractedDate) {
    return filename;  // Return unchanged if can't extract
  }
  
  const yearMonth = extractedDate.substring(0, 7); // YYYY-MM
  
  // Use 'transactions' for CSV, 'statement' for PDF
  const fileType = ext.toLowerCase() === '.csv' ? 'transactions' : 'statement';
  
  return `${yearMonth}_${fileType}_${account}${ext}`;
}

/**
 * PURE - Check if filename is already normalized
 * New format: YYYY-MM_statement_ACCOUNT.pdf or YYYY-MM_transactions_ACCOUNT.csv
 * Also accepts old format for backward compatibility
 */
export function isNormalized(filename: string): boolean {
  return /^\d{4}-\d{2}_(statement|transactions)(_[a-z0-9-]+)?\.(pdf|csv)$/i.test(filename);
}

/**
 * PURE - Remove junk like (1), (copy), [2] from filename
 */
export function cleanJunk(filename: string): string {
  return filename
    .replace(/\s*\([^)]*\)\s*/g, ' ')  // Remove (1), (copy), etc.
    .replace(/\s*\[[^\]]*\]\s*/g, ' ')  // Remove [1], etc.
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * PURE - Get file extension including dot
 */
export function getExtension(filename: string): string {
  const match = filename.match(/\.[^.]+$/);
  return match ? match[0].toLowerCase() : '';
}

/**
 * PURE - Remove extension from filename
 */
export function removeExtension(filename: string): string {
  return filename.replace(/\.[^.]+$/, '');
}

/**
 * PURE - Generate a unique filename if one already exists
 * 
 * @param baseName - Base filename (e.g., "2024-12_statement")
 * @param ext - File extension (e.g., ".csv")
 * @param existingNames - Set of filenames that already exist
 * @returns Unique filename (e.g., "2024-12_statement_2.csv")
 */
export function generateUniqueFilename(
  baseName: string,
  ext: string,
  existingNames: Set<string>
): string {
  let filename = `${baseName}${ext}`;
  let counter = 2;
  
  while (existingNames.has(filename)) {
    filename = `${baseName}_${counter}${ext}`;
    counter++;
  }
  
  return filename;
}

// ============================================
// I/O WRAPPER (thin layer, minimal logic)
// ============================================

export interface NormalizeFileResult {
  original: string;
  normalized: string;
  renamed: boolean;
  newPath?: string;
}

/**
 * I/O WRAPPER - Normalize a file on disk
 * 
 * @param filePath - Path to the file
 * @param account - Account name to get the appropriate parser
 * @returns Result of the normalization
 */
export function normalizeFileOnDisk(filePath: string, account: string): NormalizeFileResult {
  const parser = PARSERS[account];
  const directory = path.dirname(filePath);
  const originalFilename = path.basename(filePath);
  
  if (!parser) {
    return {
      original: originalFilename,
      normalized: originalFilename,
      renamed: false
    };
  }
  
  // Get normalized filename (now includes account)
  const normalizedFilename = normalizeFilename(originalFilename, parser, account);
  
  // If already normalized or couldn't normalize, return as-is
  if (normalizedFilename === originalFilename) {
    return {
      original: originalFilename,
      normalized: originalFilename,
      renamed: false
    };
  }
  
  // Prepare target path with normalized filename
  const newPath = path.join(directory, normalizedFilename);
  
  // If target file already exists, delete it (we're replacing it with the new upload)
  if (fs.existsSync(newPath) && newPath !== filePath) {
    fs.unlinkSync(newPath);
  }
  
  // Rename the file to normalized name
  fs.renameSync(filePath, newPath);
  
  return {
    original: originalFilename,
    normalized: normalizedFilename,
    renamed: true,
    newPath
  };
}

// ============================================
// STARTUP UTILITY
// ============================================

import { ACCOUNTS } from '../types.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STATEMENTS_DIR = path.join(__dirname, '../../statements');

/**
 * Normalize all existing files in the statements directory on startup.
 * 
 * NOTE: This only renames files to normalized format.
 * It does NOT consolidate or deduplicate files (that caused data loss).
 * 
 * @returns Number of files renamed
 */
export function normalizeAllFiles(): number {
  console.log('[FilenameNormalizer] Scanning existing files...');
  
  let totalRenamed = 0;
  
  for (const account of ACCOUNTS) {
    for (const type of ['csv', 'pdf']) {
      const directory = path.join(STATEMENTS_DIR, account, type);
      
      if (!fs.existsSync(directory)) {
        continue;
      }
      
      const files = fs.readdirSync(directory)
        .filter(f => !f.startsWith('.') && !f.startsWith('_'));
      
      for (const filename of files) {
        // Skip if already normalized
        if (isNormalized(filename)) {
          continue;
        }
        
        const filePath = path.join(directory, filename);
        
        // Skip if not a file
        const stat = fs.statSync(filePath);
        if (!stat.isFile()) {
          continue;
        }
        
        try {
          const result = normalizeFileOnDisk(filePath, account);
          if (result.renamed) {
            console.log(`[FilenameNormalizer] Renamed: ${result.original} -> ${result.normalized}`);
            totalRenamed++;
          }
        } catch (err) {
          console.warn(`[FilenameNormalizer] Failed to normalize ${filename}:`, err);
        }
      }
    }
  }
  
  if (totalRenamed > 0) {
    console.log(`[FilenameNormalizer] Renamed ${totalRenamed} file(s)`);
  } else {
    console.log('[FilenameNormalizer] All files already normalized');
  }
  
  return totalRenamed;
}
