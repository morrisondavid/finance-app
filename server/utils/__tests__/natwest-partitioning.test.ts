/**
 * NatWest-Specific CSV Partitioning Tests
 * 
 * Tests partitioning with NatWest's specific:
 * - Date format: DD MMM YYYY (e.g., "30 Dec 2024")
 * - Amount column: 'Value' (not 'Amount')
 * - Column structure: Date, Type, Description, Value, Balance, Account Name, Account Number
 * - Transaction types: D/D, POS, BAC, etc.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import { partitionCSVFile, FileSystem, parseCSVContent } from '../csv-partitioner.js';
import { PARSERS } from '../../parsers/index.js';
import type { BankParser } from '../../types.js';

describe('NatWest CSV Partitioning', () => {
  let mockFs: FileSystem;
  let writtenFiles: Map<string, string>;
  const natwestParser = (PARSERS as Record<string, BankParser>)['natwest'];

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
   * Calculate total amount from CSV content (uses 'Value' column)
   */
  function calculateTotalAmount(csvContent: string): number {
    const rows = parseCSVContent(csvContent);
    return rows.reduce((sum, row) => {
      const amount = parseFloat(row[natwestParser.amountColumn] || '0');
      return sum + (isNaN(amount) ? 0 : amount);
    }, 0);
  }

  it('partitions NatWest CSV with DD MMM YYYY date format', () => {
    const csvContent = `Date,Type,Description,Value,Balance,Account Name,Account Number
15 Jan 2025,DEB,Payment,100.00,1000.00,NatWest Current,12345678
20 Jan 2025,CRE,Deposit,200.00,1200.00,NatWest Current,12345678
05 Feb 2025,DEB,Transfer,50.00,1150.00,NatWest Current,12345678
15 Mar 2025,CRE,Deposit,300.00,1450.00,NatWest Current,12345678`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    const result = partitionCSVFile(path.join('data', 'natwest.csv'), 'natwest', mockFs);

    expect(result.totalRows).toBe(4);
    expect(result.filesCreated).toHaveLength(3);
    expect(result.filesCreated).toContain('2025-01_transactions_natwest.csv');
    expect(result.filesCreated).toContain('2025-02_transactions_natwest.csv');
    expect(result.filesCreated).toContain('2025-03_transactions_natwest.csv');

    const originalTotal = calculateTotalAmount(csvContent);
    let partitionedTotal = 0;
    for (const [_, content] of writtenFiles) {
      partitionedTotal += calculateTotalAmount(content);
    }

    expect(originalTotal).toBe(650.00);
    expect(partitionedTotal).toBe(650.00);
  });

  it('preserves NatWest transaction types (D/D, POS, BAC)', () => {
    const csvContent = `Date,Type,Description,Value,Balance,Account Name,Account Number
15 Jan 2025,D/D,UTILITY COMPANY,-50.00,1000.00,NatWest,12345678
20 Jan 2025,POS,"Shop Purchase",30.00,1030.00,NatWest,12345678
05 Feb 2025,BAC,"Transfer In",100.00,1130.00,NatWest,12345678`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    partitionCSVFile(path.join('data', 'natwest.csv'), 'natwest', mockFs);

    const allRows: Array<Record<string, string>> = [];
    for (const [_, content] of writtenFiles) {
      allRows.push(...parseCSVContent(content));
    }

    expect(allRows.find(r => r.Type === 'D/D')).toBeDefined();
    expect(allRows.find(r => r.Type === 'POS')).toBeDefined();
    expect(allRows.find(r => r.Type === 'BAC')).toBeDefined();
  });

  it('handles NatWest balance tracking across partitions', () => {
    const csvContent = `Date,Type,Description,Value,Balance,Account Name,Account Number
15 Jan 2025,CRE,Deposit,100.00,1100.00,NatWest,12345678
20 Jan 2025,DEB,Payment,-50.00,1050.00,NatWest,12345678
05 Feb 2025,CRE,Deposit,200.00,1250.00,NatWest,12345678`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    partitionCSVFile(path.join('data', 'natwest.csv'), 'natwest', mockFs);

    const allRows: Array<Record<string, string>> = [];
    for (const [_, content] of writtenFiles) {
      allRows.push(...parseCSVContent(content));
    }

    // Verify balance field preserved
    expect(allRows[0]?.Balance).toBe('1100.00');
    expect(allRows.length).toBe(3);
  });

  it('handles NatWest POS descriptions with commas and special chars', () => {
    const csvContent = `Date,Type,Description,Value,Balance,Account Name,Account Number
15 Jan 2025,POS,"5120 27JAN25 , PAYPAL *MERCHANT, 35314369001 GB",-62.50,1000.00,NatWest,12345678
20 Feb 2025,POS,"7114 20FEB25 CD , SHOP NAME, TOWN GB",-21.85,978.15,NatWest,12345678`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    partitionCSVFile(path.join('data', 'natwest.csv'), 'natwest', mockFs);

    const allRows: Array<Record<string, string>> = [];
    for (const [_, content] of writtenFiles) {
      allRows.push(...parseCSVContent(content));
    }

    expect(allRows.length).toBe(2);
    expect(allRows[0]?.Description).toContain('PAYPAL');
    expect(allRows[1]?.Description).toContain('SHOP NAME');
  });

  it('handles NatWest BAC transfers with references', () => {
    const csvContent = `Date,Type,Description,Value,Balance,Account Name,Account Number
15 Jan 2025,BAC,"TRANSFER IN , FP 15/01/25 1250 , REFERENCE123",100.00,1100.00,NatWest,12345678
20 Feb 2025,BAC,"TRANSFER OUT , FP 20/02/25 0900 , REF456",-50.00,1050.00,NatWest,12345678`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    partitionCSVFile(path.join('data', 'natwest.csv'), 'natwest', mockFs);

    const allRows: Array<Record<string, string>> = [];
    for (const [_, content] of writtenFiles) {
      allRows.push(...parseCSVContent(content));
    }

    const transferIn = allRows.find(r => r.Value === '100.00');
    expect(transferIn?.Description).toContain('REFERENCE123');

    const transferOut = allRows.find(r => r.Value === '-50.00');
    expect(transferOut?.Description).toContain('REF456');
  });

  it('handles NatWest account name and number preservation', () => {
    const csvContent = `Date,Type,Description,Value,Balance,Account Name,Account Number
15 Jan 2025,DEB,Payment,100.00,1000.00,PERSONAL ACCOUNT,602308-73193380
20 Feb 2025,CRE,Deposit,200.00,1200.00,PERSONAL ACCOUNT,602308-73193380`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    partitionCSVFile(path.join('data', 'natwest.csv'), 'natwest', mockFs);

    const allRows: Array<Record<string, string>> = [];
    for (const [_, content] of writtenFiles) {
      allRows.push(...parseCSVContent(content));
    }

    expect(allRows.every(r => r['Account Name'] === 'PERSONAL ACCOUNT')).toBe(true);
    expect(allRows.every(r => r['Account Number'] === '602308-73193380')).toBe(true);
  });

  it('partitions NatWest across year boundary (Dec to Jan)', () => {
    const csvContent = `Date,Type,Description,Value,Balance,Account Name,Account Number
25 Dec 2024,POS,Christmas Shopping,-100.00,1000.00,NatWest,12345678
31 Dec 2024,D/D,Utility Bill,-50.00,950.00,NatWest,12345678
01 Jan 2025,CRE,New Year Deposit,200.00,1150.00,NatWest,12345678
15 Jan 2025,POS,January Shopping,-75.00,1075.00,NatWest,12345678`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    const result = partitionCSVFile(path.join('data', 'natwest.csv'), 'natwest', mockFs);

    expect(result.filesCreated).toHaveLength(2);
    expect(result.filesCreated).toContain('2024-12_transactions_natwest.csv');
    expect(result.filesCreated).toContain('2025-01_transactions_natwest.csv');
    expect(result.rowsByMonth.get('2024-12')).toBe(2);
    expect(result.rowsByMonth.get('2025-01')).toBe(2);

    const originalTotal = calculateTotalAmount(csvContent);
    let partitionedTotal = 0;
    for (const [_, content] of writtenFiles) {
      partitionedTotal += calculateTotalAmount(content);
    }

    expect(originalTotal).toBe(-25.00); // -100 - 50 + 200 - 75
    expect(partitionedTotal).toBeCloseTo(-25.00, 2);
  });

  it('partitions real NatWest CSV sample with integrity', () => {
    const samplePath = path.join(__dirname, '../../parsers/__tests__/fixtures/natwest-sample.csv');
    const csvContent = fs.readFileSync(samplePath, 'utf-8');

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    const result = partitionCSVFile(path.join('data', 'natwest-real.csv'), 'natwest', mockFs);

    expect(result.totalRows).toBeGreaterThan(0);

    // Expected from sample: -6.21 + -8.47 + -62.50 + 100.00 + -21.85
    const expectedTotal = 0.97;
    
    if (writtenFiles.size > 0) {
      let partitionedTotal = 0;
      for (const [_, content] of writtenFiles) {
        partitionedTotal += calculateTotalAmount(content);
      }
      expect(partitionedTotal).toBeCloseTo(expectedTotal, 2);
    }
  });

  it('handles NatWest direct debits (D/D) with company names', () => {
    const csvContent = `Date,Type,Description,Value,Balance,Account Name,Account Number
15 Jan 2025,D/D,UTILITY COMPANY,-50.21,1000.00,NatWest,12345678
20 Jan 2025,D/D,INSURANCE COMPANY,-35.47,964.53,NatWest,12345678
05 Feb 2025,D/D,SUBSCRIPTION SERVICE,-9.99,954.54,NatWest,12345678`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    partitionCSVFile(path.join('data', 'natwest.csv'), 'natwest', mockFs);

    const allRows: Array<Record<string, string>> = [];
    for (const [_, content] of writtenFiles) {
      allRows.push(...parseCSVContent(content));
    }

    expect(allRows.every(r => r.Type === 'D/D')).toBe(true);
    expect(allRows.find(r => r.Description === 'UTILITY COMPANY')).toBeDefined();
    expect(allRows.find(r => r.Description === 'INSURANCE COMPANY')).toBeDefined();
    expect(allRows.find(r => r.Description === 'SUBSCRIPTION SERVICE')).toBeDefined();
  });

  it('handles NatWest standing orders (STO)', () => {
    const csvContent = `Date,Type,Description,Value,Balance,Account Name,Account Number
15 Jan 2025,STO,MONTHLY TRANSFER,-100.00,1000.00,NatWest,12345678
15 Feb 2025,STO,MONTHLY TRANSFER,-100.00,900.00,NatWest,12345678
15 Mar 2025,STO,MONTHLY TRANSFER,-100.00,800.00,NatWest,12345678`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    const result = partitionCSVFile(path.join('data', 'natwest.csv'), 'natwest', mockFs);

    expect(result.filesCreated).toHaveLength(3);
    
    const originalTotal = calculateTotalAmount(csvContent);
    expect(originalTotal).toBe(-300.00);
  });
});
