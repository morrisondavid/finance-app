/**
 * Capital on Tap-Specific CSV Partitioning Tests
 * 
 * Tests partitioning with Capital on Tap's specific:
 * - Date format: DD MMM YYYY (e.g., "15 Jan 2025")
 * - Preprocessing: Removes header preamble before CSV data
 * - Amount column: 'Amount'
 * - Complex column structure with receipts, card details
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import { partitionCSVFile, FileSystem, parseCSVContent } from '../csv-partitioner.js';
import { PARSERS } from '../../parsers/index.js';
import type { BankParser } from '../../types.js';

describe('Capital on Tap CSV Partitioning', () => {
  let mockFs: FileSystem;
  let writtenFiles: Map<string, string>;
  const capitalParser = (PARSERS as Record<string, BankParser>)['capital-on-tap'];

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
   * Calculate total amount from preprocessed CSV content
   */
  function calculateTotalAmount(csvContent: string): number {
    const preprocessed = capitalParser.preprocess(csvContent);
    const rows = parseCSVContent(preprocessed);
    return rows.reduce((sum, row) => {
      const amount = parseFloat(row[capitalParser.amountColumn] || '0');
      return sum + (isNaN(amount) ? 0 : amount);
    }, 0);
  }

  it('handles Capital on Tap preprocessing (removes preamble)', () => {
    const csvContent = `Capital on Tap Statement
Generated: 2025-01-25
Account: Business Card

Clearance Date,Authorisation Date,Description,Amount,Original Amount,Original Currency,Merchant Name,Card Ending,Cardholder Name,Card Name,Transaction Type,Category,Has Receipts,Note
15 Jan 2025,15 Jan 2025,Office Supplies,100.50,100.50,GBP,Staples,1234,John Doe,Business Card,Purchase,Office,No,
20 Jan 2025,20 Jan 2025,Fuel,75.25,75.25,GBP,Shell,1234,John Doe,Business Card,Purchase,Travel,No,
05 Feb 2025,05 Feb 2025,Software,200.00,200.00,GBP,Adobe,1234,John Doe,Business Card,Purchase,Software,No,`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    const result = partitionCSVFile(path.join('data', 'capital.csv'), 'capital-on-tap', mockFs);

    expect(result.totalRows).toBe(3);
    expect(result.filesCreated).toHaveLength(2);

    const originalTotal = calculateTotalAmount(csvContent);
    let partitionedTotal = 0;
    for (const [_, content] of writtenFiles) {
      partitionedTotal += calculateTotalAmount(content);
    }

    expect(originalTotal).toBe(375.75);
    expect(partitionedTotal).toBeCloseTo(375.75, 2);
  });

  it('parses Capital on Tap date format (DD MMM YYYY)', () => {
    const csvContent = `Clearance Date,Authorisation Date,Description,Amount,Original Amount,Original Currency,Merchant Name,Card Ending,Cardholder Name,Card Name,Transaction Type,Category,Has Receipts,Note
15 Jan 2025,15 Jan 2025,Test,100.00,100.00,GBP,Merchant,1234,John,Card,Purchase,General,No,
20 Feb 2025,20 Feb 2025,Test,200.00,200.00,GBP,Merchant,1234,John,Card,Purchase,General,No,
05 Mar 2025,05 Mar 2025,Test,300.00,300.00,GBP,Merchant,1234,John,Card,Purchase,General,No,`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    const result = partitionCSVFile(path.join('data', 'capital.csv'), 'capital-on-tap', mockFs);

    expect(result.filesCreated).toHaveLength(3);
    expect(result.filesCreated).toContain('2025-01_transactions_capital-on-tap.csv');
    expect(result.filesCreated).toContain('2025-02_transactions_capital-on-tap.csv');
    expect(result.filesCreated).toContain('2025-03_transactions_capital-on-tap.csv');
  });

  it('preserves Capital on Tap currency conversion fields', () => {
    const csvContent = `Clearance Date,Authorisation Date,Description,Amount,Original Amount,Original Currency,Merchant Name,Card Ending,Cardholder Name,Card Name,Transaction Type,Category,Has Receipts,Note
15 Jan 2025,14 Jan 2025,Foreign Purchase,85.50,100.00,USD,Amazon US,1234,John,Card,Online,Shopping,No,
20 Feb 2025,20 Feb 2025,Local Purchase,50.00,50.00,GBP,Local Shop,1234,John,Card,Chip and PIN,Shopping,No,`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    partitionCSVFile(path.join('data', 'capital.csv'), 'capital-on-tap', mockFs);

    const allRows: Array<Record<string, string>> = [];
    for (const [_, content] of writtenFiles) {
      allRows.push(...parseCSVContent(content));
    }

    // Verify currency fields preserved
    const foreignRow = allRows.find(r => r['Original Currency'] === 'USD');
    expect(foreignRow).toBeDefined();
    expect(foreignRow?.['Original Amount']).toBe('100.00');
    expect(foreignRow?.Amount).toBe('85.50');

    const localRow = allRows.find(r => r['Original Currency'] === 'GBP');
    expect(localRow).toBeDefined();
    expect(localRow?.Amount).toBe('50.00');
  });

  it('handles Capital on Tap payment transactions (negative amounts)', () => {
    const csvContent = `Clearance Date,Authorisation Date,Description,Amount,Original Amount,Original Currency,Merchant Name,Card Ending,Cardholder Name,Card Name,Transaction Type,Category,Has Receipts,Note
15 Jan 2025,15 Jan 2025,Purchase,100.00,100.00,GBP,Shop,1234,John,Card,Purchase,Shopping,No,
20 Jan 2025,20 Jan 2025,Payment made (Direct Debit),-100.00,-100.00,GBP,,,,Card,Other,Inbound payment,No,
05 Feb 2025,05 Feb 2025,Another Purchase,50.00,50.00,GBP,Shop,1234,John,Card,Purchase,Shopping,No,`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    partitionCSVFile(path.join('data', 'capital.csv'), 'capital-on-tap', mockFs);

    const originalTotal = calculateTotalAmount(csvContent);
    let partitionedTotal = 0;
    for (const [_, content] of writtenFiles) {
      partitionedTotal += calculateTotalAmount(content);
    }

    expect(originalTotal).toBe(50.00); // 100 - 100 + 50
    expect(partitionedTotal).toBeCloseTo(50.00, 2);
  });

  it('preserves Capital on Tap card and cardholder details', () => {
    const csvContent = `Clearance Date,Authorisation Date,Description,Amount,Original Amount,Original Currency,Merchant Name,Card Ending,Cardholder Name,Card Name,Transaction Type,Category,Has Receipts,Note
15 Jan 2025,15 Jan 2025,Purchase,100.00,100.00,GBP,Shop,3205,David Morrison,Business Card,Contactless,General,No,
20 Feb 2025,20 Feb 2025,Purchase,200.00,200.00,GBP,Shop,8454,Jane Smith,Personal Card,Chip and PIN,General,No,`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    partitionCSVFile(path.join('data', 'capital.csv'), 'capital-on-tap', mockFs);

    const allRows: Array<Record<string, string>> = [];
    for (const [_, content] of writtenFiles) {
      allRows.push(...parseCSVContent(content));
    }

    const row1 = allRows.find(r => r['Card Ending'] === '3205');
    expect(row1?.['Cardholder Name']).toBe('David Morrison');
    expect(row1?.['Card Name']).toBe('Business Card');

    const row2 = allRows.find(r => r['Card Ending'] === '8454');
    expect(row2?.['Cardholder Name']).toBe('Jane Smith');
  });

  it('handles Capital on Tap receipts flag', () => {
    const csvContent = `Clearance Date,Authorisation Date,Description,Amount,Original Amount,Original Currency,Merchant Name,Card Ending,Cardholder Name,Card Name,Transaction Type,Category,Has Receipts,Note
15 Jan 2025,15 Jan 2025,With Receipt,100.00,100.00,GBP,Shop,1234,John,Card,Purchase,General,Yes,Receipt attached
20 Feb 2025,20 Feb 2025,No Receipt,200.00,200.00,GBP,Shop,1234,John,Card,Purchase,General,No,`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    partitionCSVFile(path.join('data', 'capital.csv'), 'capital-on-tap', mockFs);

    const allRows: Array<Record<string, string>> = [];
    for (const [_, content] of writtenFiles) {
      allRows.push(...parseCSVContent(content));
    }

    const withReceipt = allRows.find(r => r['Has Receipts'] === 'Yes');
    expect(withReceipt).toBeDefined();
    expect(withReceipt?.Note).toBe('Receipt attached');

    const noReceipt = allRows.find(r => r['Has Receipts'] === 'No');
    expect(noReceipt).toBeDefined();
  });

  it('partitions real Capital on Tap CSV sample with integrity', () => {
    const samplePath = path.join(__dirname, '../../parsers/__tests__/fixtures/capital-on-tap-sample.csv');
    const csvContent = fs.readFileSync(samplePath, 'utf-8');

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    const result = partitionCSVFile(path.join('data', 'capital-real.csv'), 'capital-on-tap', mockFs);

    expect(result.totalRows).toBeGreaterThan(0);

    // Expected from sample: 105.00 + 101.00 + 19.50 + 149.80 + -100.00
    const expectedTotal = 275.30;
    
    if (writtenFiles.size > 0) {
      let partitionedTotal = 0;
      for (const [_, content] of writtenFiles) {
        partitionedTotal += calculateTotalAmount(content);
      }
      expect(partitionedTotal).toBeCloseTo(expectedTotal, 2);
    }
  });

  it('handles Capital on Tap transaction categories', () => {
    const csvContent = `Clearance Date,Authorisation Date,Description,Amount,Original Amount,Original Currency,Merchant Name,Card Ending,Cardholder Name,Card Name,Transaction Type,Category,Has Receipts,Note
15 Jan 2025,15 Jan 2025,Office,100.00,100.00,GBP,Staples,1234,John,Card,Purchase,Office,No,
20 Jan 2025,20 Jan 2025,Travel,75.00,75.00,GBP,Shell,1234,John,Card,Purchase,Travel,No,
05 Feb 2025,05 Feb 2025,Software,200.00,200.00,GBP,Adobe,1234,John,Card,Purchase,Software,Yes,Receipt`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    partitionCSVFile(path.join('data', 'capital.csv'), 'capital-on-tap', mockFs);

    const allRows: Array<Record<string, string>> = [];
    for (const [_, content] of writtenFiles) {
      allRows.push(...parseCSVContent(content));
    }

    expect(allRows.find(r => r.Category === 'Office')).toBeDefined();
    expect(allRows.find(r => r.Category === 'Travel')).toBeDefined();
    expect(allRows.find(r => r.Category === 'Software')).toBeDefined();
  });

  it('handles Capital on Tap online vs physical transactions', () => {
    const csvContent = `Clearance Date,Authorisation Date,Description,Amount,Original Amount,Original Currency,Merchant Name,Card Ending,Cardholder Name,Card Name,Transaction Type,Category,Has Receipts,Note
15 Jan 2025,15 Jan 2025,Online Purchase,100.00,100.00,GBP,Amazon,1234,John,Card,Online,Shopping,No,
20 Jan 2025,20 Jan 2025,Store Purchase,75.00,75.00,GBP,Tesco,1234,John,Card,Chip and PIN,Shopping,No,
05 Feb 2025,05 Feb 2025,Contactless Purchase,50.00,50.00,GBP,Cafe,1234,John,Card,Contactless,Food,No,`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    partitionCSVFile(path.join('data', 'capital.csv'), 'capital-on-tap', mockFs);

    const allRows: Array<Record<string, string>> = [];
    for (const [_, content] of writtenFiles) {
      allRows.push(...parseCSVContent(content));
    }

    expect(allRows.find(r => r['Transaction Type'] === 'Online')).toBeDefined();
    expect(allRows.find(r => r['Transaction Type'] === 'Chip and PIN')).toBeDefined();
    expect(allRows.find(r => r['Transaction Type'] === 'Contactless')).toBeDefined();
  });

  it('handles Capital on Tap with empty merchant names (payments)', () => {
    const csvContent = `Clearance Date,Authorisation Date,Description,Amount,Original Amount,Original Currency,Merchant Name,Card Ending,Cardholder Name,Card Name,Transaction Type,Category,Has Receipts,Note
15 Jan 2025,15 Jan 2025,Purchase,100.00,100.00,GBP,Shop Name,1234,John,Card,Purchase,Shopping,No,
20 Jan 2025,20 Jan 2025,Payment made (Direct Debit),-50.00,-50.00,GBP,,,,Card,Other,Inbound payment,No,
05 Feb 2025,05 Feb 2025,Another Purchase,75.00,75.00,GBP,Another Shop,1234,John,Card,Purchase,Shopping,No,`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    partitionCSVFile(path.join('data', 'capital.csv'), 'capital-on-tap', mockFs);

    const allRows: Array<Record<string, string>> = [];
    for (const [_, content] of writtenFiles) {
      allRows.push(...parseCSVContent(content));
    }

    const paymentRow = allRows.find(r => r.Amount === '-50.00');
    expect(paymentRow).toBeDefined();
    expect(paymentRow?.['Merchant Name']).toBe('');
    expect(paymentRow?.['Card Ending']).toBe('');
  });
});
