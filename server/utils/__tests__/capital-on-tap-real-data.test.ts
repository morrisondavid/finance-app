/**
 * CRITICAL BUG TEST - Capital on Tap Real Data
 * 
 * Tests the FULL upload pipeline: normalize filename → partition CSV.
 * 
 * ROOT CAUSE: The filename normalizer renames raw CSVs to 
 * `YYYY-MM_transactions_capital-on-tap.csv` using the end-date month.
 * The partitioner outputs files with the SAME naming pattern.
 * When the raw file contains data in the end-date month, the partition
 * output path COLLIDES with the input file path. The input is read as
 * "existing data", merged, overwritten, then archived — removing that
 * month's partition entirely.
 * 
 * Proven: File 4 (Jan-Feb 2026) loses all 14 February rows (£815.09)
 * because the normalizer names it `2026-02_transactions_capital-on-tap.csv`,
 * which is the same name the partitioner generates for the February partition.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { partitionCSVFile, FileSystem, parseCSVContent } from '../csv-partitioner.js';
import { normalizeFilename } from '../filename-normalizer.js';
import { PARSERS } from '../../parsers/index.js';
import type { BankParser } from '../../types.js';
import fs from 'fs';
import path from 'path';

const DOWNLOADS_DIR = '/Users/davidmorrison/Downloads/Capital On Tap/';
const capitalParser = (PARSERS as Record<string, BankParser>)['capital-on-tap'];

function calculateTotal(csvContent: string): number {
  const preprocessed = capitalParser.preprocess(csvContent);
  const rows = parseCSVContent(preprocessed);
  return rows.reduce((sum, row) => {
    const amount = parseFloat(row[capitalParser.amountColumn] || '0');
    return sum + (isNaN(amount) ? 0 : amount);
  }, 0);
}

function countRows(csvContent: string): number {
  const preprocessed = capitalParser.preprocess(csvContent);
  return parseCSVContent(preprocessed).length;
}

describe('Capital on Tap: normalize → partition collision bug', () => {
  const RAW_FILES = [
    'Transactions 01-01-2023 - 01-01-2024.csv',
    'Transactions 01-01-2024 - 01-01-2025 (2).csv',
    'Transactions 02-01-2025 - 01-01-2026.csv',
    'Transactions 02-01-2026 - 20-02-2026.csv',
  ];

  function filesAvailable(): boolean {
    return RAW_FILES.every(f => fs.existsSync(path.join(DOWNLOADS_DIR, f)));
  }

  /**
   * Creates a virtual filesystem backed by a Map, simulating the real
   * file system behavior (reads, writes, deletes all mutate state).
   */
  function createVirtualFs() {
    const store = new Map<string, string>();

    const vfs: FileSystem = {
      readFile(p: string): string {
        const content = store.get(p);
        if (content === undefined) throw new Error(`ENOENT: ${p}`);
        return content;
      },
      writeFile(p: string, content: string): void {
        store.set(p, content);
      },
      deleteFile(p: string): void {
        store.delete(p);
      },
      ensureDir(): void { /* no-op for virtual fs */ },
      exists(p: string): boolean {
        return store.has(p);
      },
    };

    return { vfs, store };
  }

  it('demonstrates the collision: normalized filename matches partition output', () => {
    for (const rawName of RAW_FILES) {
      const normalized = normalizeFilename(rawName, capitalParser, 'capital-on-tap');
      const endDateMonth = normalized.match(/^(\d{4}-\d{2})/)?.[1];
      console.log(`${rawName}`);
      console.log(`  → normalized: ${normalized}`);
      console.log(`  → end-date month: ${endDateMonth}`);
      console.log(`  → partition output for that month: ${endDateMonth}_transactions_capital-on-tap.csv`);
      console.log(`  → COLLISION: ${normalized === `${endDateMonth}_transactions_capital-on-tap.csv`}`);
    }

    // Every file's normalized name collides with its end-date-month partition
    for (const rawName of RAW_FILES) {
      const normalized = normalizeFilename(rawName, capitalParser, 'capital-on-tap');
      const endDateMonth = normalized.match(/^(\d{4}-\d{2})/)?.[1];
      expect(normalized).toBe(`${endDateMonth}_transactions_capital-on-tap.csv`);
    }
  });

  it('CRITICAL BUG: sequential uploads lose the last file\'s end-month data (£815.09)', () => {
    if (!filesAvailable()) {
      console.warn('Real CSV files not found in Downloads, skipping');
      return;
    }

    const { vfs, store } = createVirtualFs();
    const csvDir = '/data/capital-on-tap/csv';

    let totalInputRows = 0;
    let totalInputAmount = 0;

    for (const rawName of RAW_FILES) {
      const rawContent = fs.readFileSync(path.join(DOWNLOADS_DIR, rawName), 'utf-8');
      const inputRows = countRows(rawContent);
      const inputAmount = calculateTotal(rawContent);
      totalInputRows += inputRows;
      totalInputAmount += inputAmount;

      // Step 1: Normalizer renames raw file to YYYY-MM_transactions_capital-on-tap.csv
      const normalizedName = normalizeFilename(rawName, capitalParser, 'capital-on-tap');
      const normalizedPath = path.join(csvDir, normalizedName);

      // Step 2: Normalizer deletes existing file at that path if present
      if (store.has(normalizedPath)) {
        console.log(`  NORMALIZER DELETES existing partition: ${normalizedName}`);
        store.delete(normalizedPath);
      }

      // Step 3: Place raw content at normalized path (simulates fs.renameSync)
      store.set(normalizedPath, rawContent);

      console.log(`Upload: ${rawName} (${inputRows} rows, £${inputAmount.toFixed(2)})`);
      console.log(`  Normalized to: ${normalizedName}`);

      // Step 4: Partition
      partitionCSVFile(normalizedPath, 'capital-on-tap', vfs);
    }

    // Count what survived in the active directory (exclude _originals)
    let finalRows = 0;
    let finalAmount = 0;
    const partitionFiles: string[] = [];

    for (const [filePath, content] of store) {
      if (filePath.includes('_originals')) continue;
      const rows = countRows(content);
      const amount = calculateTotal(content);
      finalRows += rows;
      finalAmount += amount;
      partitionFiles.push(`${path.basename(filePath)}: ${rows} rows, £${amount.toFixed(2)}`);
    }

    partitionFiles.sort();
    console.log('\nFinal partitions:');
    for (const line of partitionFiles) console.log(`  ${line}`);

    console.log(`\nInput total:  ${totalInputRows} rows, £${totalInputAmount.toFixed(2)}`);
    console.log(`Output total: ${finalRows} rows, £${finalAmount.toFixed(2)}`);

    if (Math.abs(finalAmount - totalInputAmount) > 0.01) {
      console.log(`\nBUG: Missing £${(totalInputAmount - finalAmount).toFixed(2)} and ${totalInputRows - finalRows} rows`);
    }

    // These assertions capture the bug — they MUST pass for the data to be correct
    expect(finalAmount).toBeCloseTo(totalInputAmount, 2);
    expect(finalRows).toBe(totalInputRows);
  });

  it('MINIMAL REPRO: single file with 2 months, normalized name collides with last month', () => {
    // No dependency on real files — uses synthetic data
    const csvContent = [
      'Clearance Date,Authorisation Date,Description,Amount,Original Amount,Original Currency,Merchant Name,Card Ending,Cardholder Name,Card Name,Transaction Type,Category,Has Receipts,Note',
      '15/01/2026,15/01/2026,January Purchase,100.00,100.00,GBP,Shop A,1234,David,Main,Purchase,General,No,',
      '20/01/2026,20/01/2026,January Purchase 2,200.00,200.00,GBP,Shop B,1234,David,Main,Purchase,General,No,',
      '05/02/2026,05/02/2026,February Purchase,300.00,300.00,GBP,Shop C,1234,David,Main,Purchase,General,No,',
      '10/02/2026,10/02/2026,February Purchase 2,400.00,400.00,GBP,Shop D,1234,David,Main,Purchase,General,No,',
    ].join('\n');

    const inputRows = countRows(csvContent);
    const inputTotal = calculateTotal(csvContent);

    expect(inputRows).toBe(4);
    expect(inputTotal).toBeCloseTo(1000, 2);

    // Normalizer would name this file after the end date (Feb 2026)
    const normalizedName = '2026-02_transactions_capital-on-tap.csv';
    const csvDir = '/data/csv';
    const normalizedPath = path.join(csvDir, normalizedName);

    const { vfs, store } = createVirtualFs();
    store.set(normalizedPath, csvContent);

    partitionCSVFile(normalizedPath, 'capital-on-tap', vfs);

    // Collect surviving partitions (not in _originals)
    let outputRows = 0;
    let outputTotal = 0;
    for (const [filePath, content] of store) {
      if (filePath.includes('_originals')) continue;
      outputRows += countRows(content);
      outputTotal += calculateTotal(content);
      console.log(`${path.basename(filePath)}: ${countRows(content)} rows, £${calculateTotal(content).toFixed(2)}`);
    }

    console.log(`\nInput:  ${inputRows} rows, £${inputTotal.toFixed(2)}`);
    console.log(`Output: ${outputRows} rows, £${outputTotal.toFixed(2)}`);

    // The collision causes February data to be archived along with the raw file
    // This assertion MUST pass — all input data must survive partitioning
    expect(outputTotal).toBeCloseTo(inputTotal, 2);
    expect(outputRows).toBe(inputRows);
  });
});
