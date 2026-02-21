import path from 'path';
import fs from 'fs';
import { getDb, STATEMENTS_DIR } from '../connection.js';
import { ACCOUNTS } from '../../types.js';
import { parseCSVFile } from '../../parsers/index.js';
import { insertTransactions, detectTransfers } from './transactions.js';

/**
 * Record that a file has been processed
 */
export function recordProcessedFile(filename: string, account: string, transactionCount: number): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO processed_files (filename, account, transaction_count)
    VALUES (?, ?, ?)
  `);
  stmt.run(filename, account, transactionCount);
}

/**
 * Get all CSV files from all accounts
 */
export function getAllCSVFiles(): Array<{ account: string; filePath: string; filename: string }> {
  const csvFiles: Array<{ account: string; filePath: string; filename: string }> = [];
  
  for (const account of ACCOUNTS) {
    const csvDir = path.join(STATEMENTS_DIR, account, 'csv');
    
    if (!fs.existsSync(csvDir)) continue;
    
    const files = fs.readdirSync(csvDir)
      .filter(f => f.endsWith('.csv') && !f.startsWith('.'));
    
    for (const file of files) {
      csvFiles.push({
        account,
        filePath: path.join(csvDir, file),
        filename: file
      });
    }
  }
  
  return csvFiles;
}

/**
 * Parse all CSV files and populate the database
 */
export async function populateFromCSVs(): Promise<{ files: number; transactions: number; duplicates: number }> {
  const csvFiles = getAllCSVFiles();
  let totalInserted = 0;
  let totalDuplicates = 0;
  
  for (const { account, filePath, filename } of csvFiles) {
    try {
      const transactions = await parseCSVFile(filePath, account);
      const { inserted, duplicates } = insertTransactions(transactions);
      
      recordProcessedFile(filename, account, inserted);
      totalInserted += inserted;
      totalDuplicates += duplicates;
      
      console.log(`[Database] Processed ${filename}: ${inserted} transactions, ${duplicates} duplicates skipped`);
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[Database] Error processing ${filename}:`, error);
    }
  }
  
  return { files: csvFiles.length, transactions: totalInserted, duplicates: totalDuplicates };
}

/**
 * Get file count
 */
export function getFileCount(): number {
  const db = getDb();
  const result = db.prepare('SELECT COUNT(*) as count FROM processed_files').get() as { count: number };
  return result.count;
}

/**
 * Manually add transactions (e.g., after a new file upload)
 * Also re-runs transfer detection
 */
export async function addTransactionsFromFile(filePath: string, account: string): Promise<{ inserted: number; duplicates: number; transfers: number }> {
  const transactions = await parseCSVFile(filePath, account);
  const result = insertTransactions(transactions);
  
  const filename = path.basename(filePath);
  recordProcessedFile(filename, account, result.inserted);
  
  // Re-run transfer detection for any new matches
  const transfers = detectTransfers();
  
  return { ...result, transfers };
}
