/**
 * Barclays-Specific CSV Partitioning Tests
 * 
 * Tests partitioning with Barclays' specific:
 * - Date format: DD/MM/YYYY
 * - Column structure: Number, Date, Account, Amount, Subcategory, Memo
 * - Amount column: 'Amount'
 * - No preprocessing required
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import { partitionCSVFile, FileSystem, parseCSVContent } from './csv-partitioner.js';
import { PARSERS } from '../parsers/index.js';
import type { BankParser } from '../types.js';

describe('Barclays CSV Partitioning', () => {
  let mockFs: FileSystem;
  let writtenFiles: Map<string, string>;
  const barclaysParser = (PARSERS as Record<string, BankParser>)['barclays-current'];

  beforeEach(() => {
    writtenFiles = new Map();
    mockFs = {
      readFile: vi.fn(),
      writeFile: vi.fn((path: string, content: string) => {
        writtenFiles.set(path, content);
      }),
      deleteFile: vi.fn(),
      ensureDir: vi.fn(),
      exists: vi.fn().mockReturnValue(false),
    };
  });

  /**
   * Calculate total amount from CSV content
   */
  function calculateTotalAmount(csvContent: string): number {
    const rows = parseCSVContent(csvContent);
    return rows.reduce((sum, row) => {
      const amount = parseFloat(row[barclaysParser.amountColumn] || '0');
      return sum + (isNaN(amount) ? 0 : amount);
    }, 0);
  }

  it('partitions Barclays CSV with DD/MM/YYYY date format', () => {
    const csvContent = `Number,Date,Account,Amount,Subcategory,Memo
1,15/01/2025,Barclays Current,100.50,Income,Salary
2,20/01/2025,Barclays Current,200.75,Shopping,Groceries
3,05/02/2025,Barclays Current,300.00,Income,Bonus
4,15/03/2025,Barclays Current,150.25,Shopping,Retail`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    const result = partitionCSVFile(path.join('data', 'barclays.csv'), 'barclays-current', mockFs);

    expect(result.totalRows).toBe(4);
    expect(result.filesCreated).toHaveLength(3);
    expect(result.filesCreated).toContain('2025-01_transactions_barclays-current.csv');
    expect(result.filesCreated).toContain('2025-02_transactions_barclays-current.csv');
    expect(result.filesCreated).toContain('2025-03_transactions_barclays-current.csv');

    // Verify amount preservation
    const originalTotal = calculateTotalAmount(csvContent);
    let partitionedTotal = 0;
    for (const [_, content] of writtenFiles) {
      partitionedTotal += calculateTotalAmount(content);
    }
    expect(partitionedTotal).toBeCloseTo(originalTotal, 2);
    expect(originalTotal).toBe(751.50);
  });

  it('preserves Barclays column structure exactly', () => {
    const csvContent = `Number,Date,Account,Amount,Subcategory,Memo
941284,23/01/2025,20-25-19 63648923,-172.99,Direct Debit,EE LIMITED
0,15/02/2025,20-25-19 63648923,-3.06,Debit,GITHUB INC`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    partitionCSVFile(path.join('data', 'barclays.csv'), 'barclays-current', mockFs);

    // Check all columns are preserved in output
    for (const [_, content] of writtenFiles) {
      const rows = parseCSVContent(content);
      for (const row of rows) {
        expect(row).toHaveProperty('Number');
        expect(row).toHaveProperty('Date');
        expect(row).toHaveProperty('Account');
        expect(row).toHaveProperty('Amount');
        expect(row).toHaveProperty('Subcategory');
        expect(row).toHaveProperty('Memo');
      }
    }
  });

  it('handles negative amounts in Barclays format', () => {
    const csvContent = `Number,Date,Account,Amount,Subcategory,Memo
1,15/01/2025,Barclays,1000.00,Income,Salary
2,16/01/2025,Barclays,-500.00,Payment,Rent
3,05/02/2025,Barclays,-50.25,Shopping,Groceries
4,10/02/2025,Barclays,200.00,Income,Freelance`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    partitionCSVFile(path.join('data', 'barclays.csv'), 'barclays-current', mockFs);

    const originalTotal = calculateTotalAmount(csvContent);
    let partitionedTotal = 0;
    for (const [_, content] of writtenFiles) {
      partitionedTotal += calculateTotalAmount(content);
    }

    expect(originalTotal).toBe(649.75); // 1000 - 500 - 50.25 + 200
    expect(partitionedTotal).toBeCloseTo(649.75, 2);
  });

  it('handles Barclays transactions across year boundary', () => {
    const csvContent = `Number,Date,Account,Amount,Subcategory,Memo
1,25/12/2024,Barclays,100.00,Shopping,Christmas
2,31/12/2024,Barclays,200.00,Income,Year End
3,01/01/2025,Barclays,300.00,Income,New Year
4,15/01/2025,Barclays,400.00,Income,January`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    const result = partitionCSVFile(path.join('data', 'barclays.csv'), 'barclays-current', mockFs);

    expect(result.filesCreated).toHaveLength(2);
    expect(result.filesCreated).toContain('2024-12_transactions_barclays-current.csv');
    expect(result.filesCreated).toContain('2025-01_transactions_barclays-current.csv');

    // Verify row distribution
    expect(result.rowsByMonth.get('2024-12')).toBe(2);
    expect(result.rowsByMonth.get('2025-01')).toBe(2);

    let partitionedTotal = 0;
    for (const [, content] of writtenFiles) {
      partitionedTotal += calculateTotalAmount(content);
    }
    expect(partitionedTotal).toBe(1000.00);
  });

  it('preserves Barclays account number format exactly', () => {
    const csvContent = `Number,Date,Account,Amount,Subcategory,Memo
0,15/01/2025,20-25-19 63648923,100.00,Income,Test
1,20/02/2025,20-25-19 63648923,200.00,Income,Test2`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    partitionCSVFile(path.join('data', 'barclays.csv'), 'barclays-current', mockFs);

    // Verify account format is preserved
    for (const [_, content] of writtenFiles) {
      const rows = parseCSVContent(content);
      for (const row of rows) {
        expect(row.Account).toBe('20-25-19 63648923');
      }
    }
  });

  it('handles Barclays subcategory and memo fields with special characters', () => {
    const csvContent = `Number,Date,Account,Amount,Subcategory,Memo
1,15/01/2025,Barclays,100.00,Direct Debit,"EE LIMITED, MOBILE"
2,20/01/2025,Barclays,200.00,Debit,"GITHUB ""PREMIUM"" INC"
3,05/02/2025,Barclays,300.00,Transfer,"DAVID ""DAVE"" MORRISON"`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    partitionCSVFile(path.join('data', 'barclays.csv'), 'barclays-current', mockFs);

    // Verify special characters preserved
    const allRows: Array<Record<string, string>> = [];
    for (const [_, content] of writtenFiles) {
      allRows.push(...parseCSVContent(content));
    }

    const row1 = allRows.find(r => r.Amount === '100.00');
    expect(row1?.Memo).toContain('EE LIMITED');
    
    const row2 = allRows.find(r => r.Amount === '200.00');
    expect(row2?.Memo).toContain('GITHUB');
  });

  it('handles Barclays zero transaction number', () => {
    const csvContent = `Number,Date,Account,Amount,Subcategory,Memo
0,15/01/2025,Barclays,100.00,Debit,Transaction 1
0,20/01/2025,Barclays,200.00,Debit,Transaction 2
0,05/02/2025,Barclays,300.00,Debit,Transaction 3`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    partitionCSVFile(path.join('data', 'barclays.csv'), 'barclays-current', mockFs);

    // All rows should be preserved even with Number = 0
    const allRows: Array<Record<string, string>> = [];
    for (const [_, content] of writtenFiles) {
      allRows.push(...parseCSVContent(content));
    }

    expect(allRows.length).toBe(3);
    expect(allRows.every(r => r.Number === '0')).toBe(true);
  });

  it('partitions real Barclays CSV sample with integrity', () => {
    const samplePath = path.join(__dirname, '../parsers/fixtures/barclays-sample.csv');
    const csvContent = fs.readFileSync(samplePath, 'utf-8');

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    const result = partitionCSVFile(path.join('data', 'barclays-real.csv'), 'barclays-current', mockFs);

    expect(result.totalRows).toBeGreaterThan(0);

    // Calculate expected total from sample
    const expectedTotal = -172.99 + -3.06 + -500.00 + -80.40 + 12000.00;
    
    if (writtenFiles.size > 0) {
      let partitionedTotal = 0;
      for (const [_, content] of writtenFiles) {
        partitionedTotal += calculateTotalAmount(content);
      }
      expect(partitionedTotal).toBeCloseTo(expectedTotal, 2);
    }
  });

  it('handles Barclays file spanning 6+ months', () => {
    const csvContent = `Number,Date,Account,Amount,Subcategory,Memo
1,15/01/2025,Barclays,100.00,Income,Jan
2,15/02/2025,Barclays,200.00,Income,Feb
3,15/03/2025,Barclays,300.00,Income,Mar
4,15/04/2025,Barclays,400.00,Income,Apr
5,15/05/2025,Barclays,500.00,Income,May
6,15/06/2025,Barclays,600.00,Income,Jun
7,15/07/2025,Barclays,700.00,Income,Jul`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    const result = partitionCSVFile(path.join('data', 'barclays.csv'), 'barclays-current', mockFs);

    expect(result.filesCreated).toHaveLength(7);
    expect(result.totalRows).toBe(7);

    const originalTotal = calculateTotalAmount(csvContent);
    let partitionedTotal = 0;
    for (const [_, content] of writtenFiles) {
      partitionedTotal += calculateTotalAmount(content);
    }

    expect(originalTotal).toBe(2800.00);
    expect(partitionedTotal).toBe(2800.00);
  });

  it('preserves Barclays empty memo fields', () => {
    const csvContent = `Number,Date,Account,Amount,Subcategory,Memo
1,15/01/2025,Barclays,100.00,Income,
2,20/01/2025,Barclays,200.00,Shopping,
3,05/02/2025,Barclays,300.00,Transfer,`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    partitionCSVFile(path.join('data', 'barclays.csv'), 'barclays-current', mockFs);

    const allRows: Array<Record<string, string>> = [];
    for (const [_, content] of writtenFiles) {
      allRows.push(...parseCSVContent(content));
    }

    expect(allRows.length).toBe(3);
    expect(allRows.every(r => r.Memo === '')).toBe(true);
  });
});
