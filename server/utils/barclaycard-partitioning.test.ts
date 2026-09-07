/**
 * Barclaycard-Specific CSV Partitioning Tests
 * 
 * Tests partitioning with Barclaycard's specific:
 * - Date format: DD/MM/YYYY
 * - Negative amounts for payments/refunds (common)
 * - Amount column: 'Amount'
 * - Complex structure with merchant categories, authorization codes
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import { partitionCSVFile, FileSystem, parseCSVContent, getColumnValue } from './csv-partitioner.js';
import { PARSERS } from '../parsers/index.js';
import type { BankParser } from '../types.js';

describe('Barclaycard CSV Partitioning', () => {
  let mockFs: FileSystem;
  let writtenFiles: Map<string, string>;
  const barclaycardParser = (PARSERS as Record<string, BankParser>)['barclaycard'];

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
      const amount = parseFloat(row[barclaycardParser.amountColumn] || '0');
      return sum + (isNaN(amount) ? 0 : amount);
    }, 0);
  }

  it('partitions Barclaycard CSV with negative amounts (payments)', () => {
    const csvContent = `Cardholder Name,Account Number,Transaction Date,Merchant Name,Amount,Currency,Original Amount,Original Currency,Conversion Rate,Posted Date,Transaction Time,Authorisation Code,Transaction ID,Merchant Category,Receipt
John Doe,1234567890,15/01/2025,Amazon,100.50,GBP,100.50,GBP,1.0,16/01/2025,14:30,AUTH123,TXN001,Shopping,No
John Doe,1234567890,20/01/2025,Payment,-500.00,GBP,-500.00,GBP,1.0,21/01/2025,09:00,AUTH124,TXN002,Payment,No
John Doe,1234567890,05/02/2025,Tesco,75.25,GBP,75.25,GBP,1.0,06/02/2025,18:15,AUTH125,TXN003,Groceries,No`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    const result = partitionCSVFile(path.join('data', 'barclaycard.csv'), 'barclaycard', mockFs);

    expect(result.totalRows).toBe(3);
    expect(result.filesCreated).toHaveLength(2);

    const originalTotal = calculateTotalAmount(csvContent);
    let partitionedTotal = 0;
    for (const [_, content] of writtenFiles) {
      partitionedTotal += calculateTotalAmount(content);
    }

    expect(originalTotal).toBe(-324.25); // 100.5 - 500 + 75.25
    expect(partitionedTotal).toBeCloseTo(-324.25, 2);
  });

  it('preserves Barclaycard authorization and transaction IDs', () => {
    const csvContent = `Cardholder Name,Account Number,Transaction Date,Merchant Name,Amount,Currency,Original Amount,Original Currency,Conversion Rate,Posted Date,Transaction Time,Authorisation Code,Transaction ID,Merchant Category,Receipt
John,123,15/01/2025,Shop,100.00,GBP,100.00,GBP,1.0,16/01/2025,10:00,AUTH999,TXN999,Shopping,No
Jane,456,20/02/2025,Store,200.00,GBP,200.00,GBP,1.0,21/02/2025,15:00,AUTH888,TXN888,Retail,No`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    partitionCSVFile(path.join('data', 'barclaycard.csv'), 'barclaycard', mockFs);

    const allRows: Array<Record<string, string>> = [];
    for (const [_, content] of writtenFiles) {
      allRows.push(...parseCSVContent(content));
    }

    const row1 = allRows.find(r => r['Transaction ID'] === 'TXN999');
    expect(row1?.['Authorisation Code']).toBe('AUTH999');
    expect(row1?.['Account Number']).toBe('123');

    const row2 = allRows.find(r => r['Transaction ID'] === 'TXN888');
    expect(row2?.['Authorisation Code']).toBe('AUTH888');
    expect(row2?.['Account Number']).toBe('456');
  });

  it('handles Barclaycard currency conversions', () => {
    const csvContent = `Cardholder Name,Account Number,Transaction Date,Merchant Name,Amount,Currency,Original Amount,Original Currency,Conversion Rate,Posted Date,Transaction Time,Authorisation Code,Transaction ID,Merchant Category,Receipt
John,123,15/01/2025,US Store,85.00,GBP,100.00,USD,1.18,16/01/2025,10:00,AUTH1,TXN1,Shopping,No
John,123,20/01/2025,EU Store,90.00,GBP,100.00,EUR,1.11,21/01/2025,15:00,AUTH2,TXN2,Shopping,No
John,123,05/02/2025,UK Store,50.00,GBP,50.00,GBP,1.0,06/02/2025,12:00,AUTH3,TXN3,Shopping,No`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    partitionCSVFile(path.join('data', 'barclaycard.csv'), 'barclaycard', mockFs);

    const allRows: Array<Record<string, string>> = [];
    for (const [_, content] of writtenFiles) {
      allRows.push(...parseCSVContent(content));
    }

    // Verify conversion fields preserved
    const usdRow = allRows.find(r => r['Original Currency'] === 'USD');
    expect(usdRow?.['Conversion Rate']).toBe('1.18');
    expect(usdRow?.Amount).toBe('85.00');
    expect(usdRow?.['Original Amount']).toBe('100.00');

    // Verify amounts sum correctly (uses converted amounts)
    const totalAmount = allRows.reduce((sum, row) => 
      sum + parseFloat(row.Amount || '0'), 0
    );
    expect(totalAmount).toBe(225.00); // 85 + 90 + 50
  });

  it('handles Barclaycard multiple payments in same month', () => {
    const csvContent = `Cardholder Name,Account Number,Transaction Date,Merchant Name,Amount,Currency,Original Amount,Original Currency,Conversion Rate,Posted Date,Transaction Time,Authorisation Code,Transaction ID,Merchant Category,Receipt
John,123,05/01/2025,Purchase 1,100.00,GBP,100.00,GBP,1.0,06/01/2025,10:00,A1,T1,Shopping,No
John,123,10/01/2025,Payment,-100.00,GBP,-100.00,GBP,1.0,11/01/2025,09:00,A2,T2,Payment,No
John,123,15/01/2025,Purchase 2,200.00,GBP,200.00,GBP,1.0,16/01/2025,14:00,A3,T3,Shopping,No
John,123,20/01/2025,Payment,-200.00,GBP,-200.00,GBP,1.0,21/01/2025,09:00,A4,T4,Payment,No
John,123,05/02/2025,Purchase 3,50.00,GBP,50.00,GBP,1.0,06/02/2025,12:00,A5,T5,Shopping,No`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    const result = partitionCSVFile(path.join('data', 'barclaycard.csv'), 'barclaycard', mockFs);

    expect(result.rowsByMonth.get('2025-01')).toBe(4);
    expect(result.rowsByMonth.get('2025-02')).toBe(1);

    const originalTotal = calculateTotalAmount(csvContent);
    expect(originalTotal).toBe(50.00); // 100 - 100 + 200 - 200 + 50
  });

  it('preserves Barclaycard transaction time and posted date', () => {
    const csvContent = `Cardholder Name,Account Number,Transaction Date,Merchant Name,Amount,Currency,Original Amount,Original Currency,Conversion Rate,Posted Date,Transaction Time,Authorisation Code,Transaction ID,Merchant Category,Receipt
John,123,15/01/2025,Shop,100.00,GBP,100.00,GBP,1.0,16/01/2025,14:30:45,AUTH1,TXN1,Shopping,No
John,123,20/02/2025,Store,200.00,GBP,200.00,GBP,1.0,21/02/2025,09:15:30,AUTH2,TXN2,Retail,No`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    partitionCSVFile(path.join('data', 'barclaycard.csv'), 'barclaycard', mockFs);

    const allRows: Array<Record<string, string>> = [];
    for (const [_, content] of writtenFiles) {
      allRows.push(...parseCSVContent(content));
    }

    const row1 = allRows.find(r => r['Transaction ID'] === 'TXN1');
    expect(row1?.['Transaction Time']).toBe('14:30:45');
    expect(row1?.['Posted Date']).toBe('16/01/2025');

    const row2 = allRows.find(r => r['Transaction ID'] === 'TXN2');
    expect(row2?.['Transaction Time']).toBe('09:15:30');
    expect(row2?.['Posted Date']).toBe('21/02/2025');
  });

  it('handles Barclaycard merchant categories', () => {
    const csvContent = `Cardholder Name,Account Number,Transaction Date,Merchant Name,Amount,Currency,Original Amount,Original Currency,Conversion Rate,Posted Date,Transaction Time,Authorisation Code,Transaction ID,Merchant Category,Receipt
John,123,15/01/2025,HMRC,1020.00,GBP,1020.00,GBP,1.0,16/01/2025,21:13:52,AUTH1,TXN1,Statutory Bodies,No
John,123,20/02/2025,Shell,75.50,GBP,75.50,GBP,1.0,21/02/2025,15:00,AUTH2,TXN2,Fuel,No`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    partitionCSVFile(path.join('data', 'barclaycard.csv'), 'barclaycard', mockFs);

    const allRows: Array<Record<string, string>> = [];
    for (const [_, content] of writtenFiles) {
      allRows.push(...parseCSVContent(content));
    }

    const hmrcRow = allRows.find(r => r['Merchant Category'] === 'Statutory Bodies');
    expect(hmrcRow).toBeDefined();
    expect(hmrcRow?.Amount).toBe('1020.00');

    const fuelRow = allRows.find(r => r['Merchant Category'] === 'Fuel');
    expect(fuelRow).toBeDefined();
    expect(fuelRow?.Amount).toBe('75.50');
  });

  it('partitions newer portal export that uses Transaction Amount', () => {
    const samplePath = path.join(__dirname, '../parsers/fixtures/barclaycard-recent-export-sample.csv');
    const csvContent = fs.readFileSync(samplePath, 'utf-8');

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    const result = partitionCSVFile(path.join('data', 'Recent-07-09-2026.csv'), 'barclaycard', mockFs);

    expect(result.totalRows).toBe(3);
    expect(result.filesCreated.length).toBeGreaterThan(0);

    let partitionedTotal = 0;
    for (const content of writtenFiles.values()) {
      const rows = parseCSVContent(content);
      partitionedTotal += rows.reduce((sum, row) => {
        return sum + parseFloat(getColumnValue(row, barclaycardParser.amountColumn) || '0');
      }, 0);
    }
    expect(partitionedTotal).toBeCloseTo(623.33, 2);
  });

  it('partitions real Barclaycard CSV sample with integrity', () => {
    const samplePath = path.join(__dirname, '../parsers/fixtures/barclaycard-sample.csv');
    const csvContent = fs.readFileSync(samplePath, 'utf-8');

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    const result = partitionCSVFile(path.join('data', 'barclaycard-real.csv'), 'barclaycard', mockFs);

    expect(result.totalRows).toBeGreaterThan(0);

    // Expected from sample: 84.95 + -10.0 + -86.13 + 1020.0 + -13.0
    const expectedTotal = 995.82;
    
    if (writtenFiles.size > 0) {
      let partitionedTotal = 0;
      for (const [_, content] of writtenFiles) {
        partitionedTotal += calculateTotalAmount(content);
      }
      expect(partitionedTotal).toBeCloseTo(expectedTotal, 2);
    }
  });

  it('handles Barclaycard finance charges and fees', () => {
    const csvContent = `Cardholder Name,Account Number,Transaction Date,Merchant Name,Amount,Currency,Original Amount,Original Currency,Conversion Rate,Posted Date,Transaction Time,Authorisation Code,Transaction ID,Merchant Category,Receipt
Company Ltd,****6719,15/01/2025,PURCHASE FINANCE CHARGE,84.95,GBP,84.95,GBP,0.0,15/01/2025,,,,Miscellaneous,No
Company Ltd,****6719,20/01/2025,LATE PAYMENT FEE,35.00,GBP,35.00,GBP,0.0,20/01/2025,,,,Miscellaneous,No
Company Ltd,****6719,05/02/2025,CASH BACK REBATE,-10.00,GBP,-10.00,GBP,0.0,05/02/2025,,,,Miscellaneous,No`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    partitionCSVFile(path.join('data', 'barclaycard.csv'), 'barclaycard', mockFs);

    const originalTotal = calculateTotalAmount(csvContent);
    let partitionedTotal = 0;
    for (const [_, content] of writtenFiles) {
      partitionedTotal += calculateTotalAmount(content);
    }

    expect(originalTotal).toBe(109.95); // 84.95 + 35 - 10
    expect(partitionedTotal).toBeCloseTo(109.95, 2);
  });

  it('handles Barclaycard direct debit payments', () => {
    const csvContent = `Cardholder Name,Account Number,Transaction Date,Merchant Name,Amount,Currency,Original Amount,Original Currency,Conversion Rate,Posted Date,Transaction Time,Authorisation Code,Transaction ID,Merchant Category,Receipt
Company Ltd,****6719,15/01/2025,Shop Purchase,86.13,GBP,86.13,GBP,0.0,15/01/2025,,,,Shopping,No
Company Ltd,****6719,20/01/2025,DIRECT DEBIT PAYMENT THANK YOU,-86.13,GBP,-86.13,GBP,0.0,20/01/2025,,,,Miscellaneous,No
Company Ltd,****6719,05/02/2025,Another Purchase,50.00,GBP,50.00,GBP,0.0,05/02/2025,,,,Shopping,No`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    partitionCSVFile(path.join('data', 'barclaycard.csv'), 'barclaycard', mockFs);

    const allRows: Array<Record<string, string>> = [];
    for (const [_, content] of writtenFiles) {
      allRows.push(...parseCSVContent(content));
    }

    const paymentRow = allRows.find(r => r['Merchant Name'].includes('DIRECT DEBIT'));
    expect(paymentRow).toBeDefined();
    expect(paymentRow?.Amount).toBe('-86.13');
  });

  it('handles Barclaycard masked account numbers', () => {
    const csvContent = `Cardholder Name,Account Number,Transaction Date,Merchant Name,Amount,Currency,Original Amount,Original Currency,Conversion Rate,Posted Date,Transaction Time,Authorisation Code,Transaction ID,Merchant Category,Receipt
User 1,****1234,15/01/2025,Shop,100.00,GBP,100.00,GBP,1.0,16/01/2025,10:00,A1,T1,Shopping,No
User 2,****5678,20/02/2025,Store,200.00,GBP,200.00,GBP,1.0,21/02/2025,15:00,A2,T2,Retail,No`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    partitionCSVFile(path.join('data', 'barclaycard.csv'), 'barclaycard', mockFs);

    const allRows: Array<Record<string, string>> = [];
    for (const [_, content] of writtenFiles) {
      allRows.push(...parseCSVContent(content));
    }

    expect(allRows.find(r => r['Account Number'] === '****1234')).toBeDefined();
    expect(allRows.find(r => r['Account Number'] === '****5678')).toBeDefined();
  });
});
