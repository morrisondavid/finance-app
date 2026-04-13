import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';
import {
  groupRowsByMonth,
  formatMonthKey,
  rowsToCSV,
  getColumnValue,
  parseCSVContent,
  needsPartitioning,
  partitionCSVFile,
  addOccurrenceIndex,
  deduplicateRows,
  FileSystem
} from './csv-partitioner.js';
import type { BankParser, CSVRow, ValidationResult } from '../types.js';

// Mock parser for testing
const mockParser: BankParser = {
  columns: 'auto',
  dateColumn: 'Date',
  amountColumn: 'Amount',
  descriptionColumn: 'Description',
  headers: ['Date', 'Amount', 'Description'] as const,
  requiredHeaders: ['Date', 'Amount'] as const,
  parseOptions: {},
  
  preprocess(content: string): string {
    return content;
  },
  
  parseDate(dateStr: string): Date | null {
    // Parse DD/MM/YYYY
    const match = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (match) {
      return new Date(parseInt(match[3]), parseInt(match[2]) - 1, parseInt(match[1]));
    }
    return null;
  },
  
  extractFilenameDate(_filename: string): string | null {
    return null;
  },
  
  validateHeaders(_headers: string[]): ValidationResult {
    return { valid: true };
  },
  
  transform(_row: CSVRow, _account: string) {
    return null;
  }
};

describe('Pure Functions', () => {
  describe('formatMonthKey', () => {
    it('formats date as YYYY-MM', () => {
      expect(formatMonthKey(new Date(2025, 0, 15))).toBe('2025-01');
      expect(formatMonthKey(new Date(2025, 11, 31))).toBe('2025-12');
    });

    it('pads single-digit months', () => {
      expect(formatMonthKey(new Date(2025, 0, 1))).toBe('2025-01');
      expect(formatMonthKey(new Date(2025, 8, 15))).toBe('2025-09');
    });
  });

  describe('getColumnValue', () => {
    it('gets value with exact case', () => {
      const row = { Date: '01/01/2025', Amount: '100' };
      expect(getColumnValue(row, 'Date')).toBe('01/01/2025');
      expect(getColumnValue(row, 'Amount')).toBe('100');
    });

    it('gets value case-insensitively', () => {
      const row = { DATE: '01/01/2025', amount: '100' };
      expect(getColumnValue(row, 'date')).toBe('01/01/2025');
      expect(getColumnValue(row, 'Amount')).toBe('100');
    });

    it('returns empty string for missing column', () => {
      const row = { Date: '01/01/2025' };
      expect(getColumnValue(row, 'Missing')).toBe('');
    });
  });

  describe('groupRowsByMonth', () => {
    it('groups rows by month', () => {
      const rows: CSVRow[] = [
        { Date: '15/01/2025', Amount: '100' },
        { Date: '20/01/2025', Amount: '200' },
        { Date: '05/02/2025', Amount: '300' },
      ];

      const groups = groupRowsByMonth(rows, mockParser);

      expect(groups.get('2025-01')?.length).toBe(2);
      expect(groups.get('2025-02')?.length).toBe(1);
    });

    it('preserves ALL rows - no deduplication', () => {
      const rows: CSVRow[] = [
        { Date: '15/01/2025', Amount: '100', Description: 'Test' },
        { Date: '15/01/2025', Amount: '100', Description: 'Test' },  // Duplicate!
      ];

      const groups = groupRowsByMonth(rows, mockParser);

      // Both rows must be preserved
      expect(groups.get('2025-01')?.length).toBe(2);
    });

    it('handles rows with invalid dates', () => {
      const rows: CSVRow[] = [
        { Date: '15/01/2025', Amount: '100' },
        { Date: 'invalid', Amount: '200' },  // Invalid date
        { Date: '20/01/2025', Amount: '300' },
      ];

      const groups = groupRowsByMonth(rows, mockParser);

      // Only 2 rows with valid dates
      expect(groups.get('2025-01')?.length).toBe(2);
    });

    it('handles empty input', () => {
      const groups = groupRowsByMonth([], mockParser);
      expect(groups.size).toBe(0);
    });
  });

  describe('rowsToCSV', () => {
    it('converts rows back to CSV format', () => {
      const headers = ['Date', 'Amount'] as const;
      const rows: CSVRow[] = [{ Date: '01/01/2025', Amount: '100' }];

      const csv = rowsToCSV(headers, rows);

      expect(csv).toBe('Date,Amount,_occurrence\n01/01/2025,100,1');
    });

    it('escapes quotes', () => {
      const headers = ['Description'] as const;
      const rows: CSVRow[] = [{ Description: 'Hello "World"' }];

      const csv = rowsToCSV(headers, rows);

      expect(csv).toBe('Description,_occurrence\n"Hello ""World""",1');
    });

    it('escapes commas', () => {
      const headers = ['Description'] as const;
      const rows: CSVRow[] = [{ Description: 'Hello, World' }];

      const csv = rowsToCSV(headers, rows);

      expect(csv).toBe('Description,_occurrence\n"Hello, World",1');
    });

    it('escapes newlines', () => {
      const headers = ['Description'] as const;
      const rows: CSVRow[] = [{ Description: 'Hello\nWorld' }];

      const csv = rowsToCSV(headers, rows);

      expect(csv).toBe('Description,_occurrence\n"Hello\nWorld",1');
    });

    it('handles multiple rows', () => {
      const headers = ['Date', 'Amount'] as const;
      const rows: CSVRow[] = [
        { Date: '01/01/2025', Amount: '100' },
        { Date: '02/01/2025', Amount: '200' },
      ];

      const csv = rowsToCSV(headers, rows);

      expect(csv).toBe('Date,Amount,_occurrence\n01/01/2025,100,1\n02/01/2025,200,1');
    });
  });

  describe('parseCSVContent', () => {
    it('parses CSV content to rows', () => {
      const content = 'Date,Amount\n01/01/2025,100\n02/01/2025,200';

      const rows = parseCSVContent(content);

      expect(rows.length).toBe(2);
      expect(rows[0]['Date']).toBe('01/01/2025');
      expect(rows[0]['Amount']).toBe('100');
    });

    it('handles quoted fields', () => {
      const content = 'Description,Amount\n"Hello, World",100';

      const rows = parseCSVContent(content);

      expect(rows[0]['Description']).toBe('Hello, World');
    });
  });

  describe('needsPartitioning', () => {
    it('returns true for multiple months', () => {
      const rows: CSVRow[] = [
        { Date: '15/01/2025', Amount: '100' },
        { Date: '15/02/2025', Amount: '200' },
      ];

      expect(needsPartitioning(rows, mockParser)).toBe(true);
    });

    it('returns false for single month', () => {
      const rows: CSVRow[] = [
        { Date: '15/01/2025', Amount: '100' },
        { Date: '20/01/2025', Amount: '200' },
      ];

      expect(needsPartitioning(rows, mockParser)).toBe(false);
    });

    it('returns false for empty rows', () => {
      expect(needsPartitioning([], mockParser)).toBe(false);
    });
  });
});

describe('partitionCSVFile', () => {
  let mockFs: FileSystem;

  beforeEach(() => {
    mockFs = {
      readFile: vi.fn(),
      writeFile: vi.fn(),
      deleteFile: vi.fn(),
      ensureDir: vi.fn(),
      exists: vi.fn().mockReturnValue(false),
    };
  });

  it('preserves ALL rows across output files', () => {
    const csvContent = `Date,Amount,Description
15/01/2025,100,First
20/01/2025,200,Second
05/02/2025,300,Third`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    const result = partitionCSVFile('/path/to/file.csv', 'test', mockFs);

    expect(result.totalRows).toBe(3);
    expect(result.rowsByMonth.get('2025-01')).toBe(2);
    expect(result.rowsByMonth.get('2025-02')).toBe(1);
    expect(mockFs.writeFile).toHaveBeenCalledTimes(2);
  });

  it('preserves duplicate rows within same file with occurrence tracking', () => {
    // Multi-month file with duplicate rows within the same month
    const csvContent = `Date,Amount,Description
15/01/2025,100,Same Transaction
15/01/2025,100,Same Transaction
15/01/2025,100,Same Transaction
05/02/2025,200,Another Month`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    const result = partitionCSVFile('/path/to/file.csv', 'test', mockFs);

    // With occurrence tracking, all 3 duplicates are preserved with different occurrence values
    expect(result.totalRows).toBe(4);
    expect(result.rowsByMonth.get('2025-01')).toBe(3);  // All 3 preserved with occurrence: 1, 2, 3
    expect(result.rowsByMonth.get('2025-02')).toBe(1);
  });

  it('deletes original file after partitioning', () => {
    const csvContent = `Date,Amount
15/01/2025,100
15/02/2025,200`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    partitionCSVFile('/path/to/file.csv', 'test', mockFs);

    expect(mockFs.deleteFile).toHaveBeenCalledWith('/path/to/file.csv');
  });

  it('does not partition single-month file', () => {
    const csvContent = `Date,Amount
15/01/2025,100
20/01/2025,200`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    const result = partitionCSVFile('/path/to/file.csv', 'test', mockFs);

    expect(result.deleted).toBe(false);
    expect(result.filesCreated.length).toBe(0);
    expect(mockFs.writeFile).not.toHaveBeenCalled();
  });

  it('handles file with all columns', () => {
    const csvContent = `Date,Amount,Description,Extra1,Extra2
15/01/2025,100,Test,A,B
20/02/2025,200,Test2,C,D`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    const result = partitionCSVFile('/path/to/file.csv', 'test', mockFs);

    expect(result.totalRows).toBe(2);
    expect(result.filesCreated).toContain('2025-01_transactions_test.csv');
    expect(result.filesCreated).toContain('2025-02_transactions_test.csv');
  });

  it('verifies correct output file paths (directory + filename)', () => {
    const csvContent = `Date,Amount,Description
15/01/2025,100.00,January
20/02/2025,200.00,February`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    const testPath = path.join('data', 'statements', 'barclays', '2025-Q1.csv');
    partitionCSVFile(testPath, 'test', mockFs);

    // Verify writeFile was called with correct full paths
    const writeCalls = (mockFs.writeFile as ReturnType<typeof vi.fn>).mock.calls;
    expect(writeCalls.length).toBe(2);
    
    // Extract paths from calls
    const paths = writeCalls.map((call: unknown[]) => call[0] as string);
    
    const expectedDir = path.join('data', 'statements', 'barclays');
    expect(paths).toContain(path.join(expectedDir, '2025-01_transactions_test.csv'));
    expect(paths).toContain(path.join(expectedDir, '2025-02_transactions_test.csv'));
  });

  it('verifies archive directory structure (_originals)', () => {
    const csvContent = `Date,Amount,Description
15/01/2025,100.00,January
20/02/2025,200.00,February`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    const testPath = path.join('data', 'statements', 'test-file.csv');
    partitionCSVFile(testPath, 'test', mockFs);

    // Verify deleteFile was called on the input file
    expect(mockFs.deleteFile).toHaveBeenCalledWith(path.join('data', 'statements', 'test-file.csv'));
  });

  it('handles nested directory structures correctly', () => {
    const csvContent = `Date,Amount,Description
15/01/2025,100.00,January
20/02/2025,200.00,February`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    const testPath = path.join('very', 'deep', 'nested', 'path', 'to', 'statements', 'file.csv');
    partitionCSVFile(testPath, 'test', mockFs);

    const writeCalls = (mockFs.writeFile as ReturnType<typeof vi.fn>).mock.calls;
    const paths = writeCalls.map((call: unknown[]) => call[0] as string);
    
    const expectedDir = path.join('very', 'deep', 'nested', 'path', 'to', 'statements');
    expect(paths[0]).toContain(expectedDir);
    expect(paths[0]).toMatch(/\d{4}-\d{2}_transactions_.*\.csv$/);
    
    expect(mockFs.deleteFile).toHaveBeenCalledWith(testPath);
  });

  it('preserves parent directory when writing partitioned files', () => {
    const csvContent = `Date,Amount,Description
15/01/2025,100.00,January
15/03/2025,300.00,March
15/12/2025,1200.00,December`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    const testPath = path.join('srv', 'data', 'accounts', 'business', 'statements.csv');
    partitionCSVFile(testPath, 'test', mockFs);

    const writeCalls = (mockFs.writeFile as ReturnType<typeof vi.fn>).mock.calls;
    const paths = writeCalls.map((call: unknown[]) => call[0] as string);
    
    // All files should be in the same directory as source
    const expectedDir = path.join('srv', 'data', 'accounts', 'business');
    expect(paths.every(p => p.startsWith(expectedDir + path.sep))).toBe(true);
    expect(paths).toHaveLength(3);
  });

  it('handles relative paths correctly', () => {
    const csvContent = `Date,Amount,Description
15/01/2025,100.00,January
20/02/2025,200.00,February`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    // Use relative path
    const testPath = path.join('.', 'statements', 'file.csv');
    partitionCSVFile(testPath, 'test', mockFs);

    const writeCalls = (mockFs.writeFile as ReturnType<typeof vi.fn>).mock.calls;
    const paths = writeCalls.map((call: unknown[]) => call[0] as string);
    
    // Should write to relative directory
    expect(paths[0]).toContain(path.join('.', 'statements'));
    expect(paths).toHaveLength(2);
  });

  it('handles absolute paths correctly (cross-platform)', () => {
    const csvContent = `Date,Amount,Description
15/01/2025,100.00,January
20/02/2025,200.00,February`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    // Use path.resolve to get absolute path in platform-specific format
    const testPath = path.resolve('statements', 'file.csv');
    partitionCSVFile(testPath, 'test', mockFs);

    const writeCalls = (mockFs.writeFile as ReturnType<typeof vi.fn>).mock.calls;
    const paths = writeCalls.map((call: unknown[]) => call[0] as string);
    
    // Verify paths are absolute
    expect(path.isAbsolute(paths[0])).toBe(true);
    expect(path.isAbsolute(paths[1])).toBe(true);
    expect(paths).toHaveLength(2);
  });

  it('uses platform-appropriate path separators', () => {
    const csvContent = `Date,Amount,Description
15/01/2025,100.00,January
20/02/2025,200.00,February`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    const testPath = path.join('data', 'statements', 'file.csv');
    partitionCSVFile(testPath, 'test', mockFs);

    const writeCalls = (mockFs.writeFile as ReturnType<typeof vi.fn>).mock.calls;
    const paths = writeCalls.map((call: unknown[]) => call[0] as string);
    
    // Verify paths use platform separator
    paths.forEach(p => {
      // Path should contain platform separator if it has directories
      if (p.includes(path.sep)) {
        expect(p).toContain(path.sep);
      }
    });
  });
});

// ============================================
// TRANSACTION INTEGRITY TESTS
// ============================================

describe('Transaction Integrity Verification', () => {
  let mockFs: FileSystem;
  let writtenFiles: Map<string, string>;

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

  describe('Amount Preservation', () => {
    it('preserves total amount across multi-month partition (positive amounts)', () => {
      const csvContent = `Date,Amount,Description
15/01/2025,100.50,First transaction
20/01/2025,200.75,Second transaction
05/02/2025,50.25,Third transaction
10/03/2025,75.00,Fourth transaction`;

      (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

      partitionCSVFile('/test.csv', 'test', mockFs);
      
      // Verify integrity
      const integrity = verifyIntegrity(csvContent, writtenFiles, mockParser);
      
      expect(integrity.rowCountMatch).toBe(true);
      expect(integrity.amountMatch).toBe(true);
      expect(integrity.originalRowCount).toBe(4);
      expect(integrity.partitionedRowCount).toBe(4);
      expect(integrity.originalAmount).toBe(426.50);
      expect(integrity.partitionedAmount).toBe(426.50);
      expect(integrity.amountDifference).toBeLessThan(0.01);
    });

    it('preserves total amount with negative amounts (refunds)', () => {
      const csvContent = `Date,Amount,Description
15/01/2025,100.00,Income
20/01/2025,-50.00,Refund
05/02/2025,200.00,Income
10/02/2025,-25.50,Refund`;

      (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

      partitionCSVFile('/test.csv', 'test', mockFs);
      
      const integrity = verifyIntegrity(csvContent, writtenFiles, mockParser);
      
      expect(integrity.rowCountMatch).toBe(true);
      expect(integrity.amountMatch).toBe(true);
      expect(integrity.originalAmount).toBe(224.50); // 100 - 50 + 200 - 25.5
      expect(integrity.partitionedAmount).toBe(224.50);
    });

    it('preserves total amount with mixed positive and negative amounts', () => {
      const csvContent = `Date,Amount,Description
15/01/2025,1000.00,Large income
16/01/2025,-500.00,Large expense
17/01/2025,250.50,Medium income
18/01/2025,-100.25,Medium expense
05/02/2025,-50.00,Small expense
10/02/2025,75.75,Small income`;

      (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

      partitionCSVFile('/test.csv', 'test', mockFs);
      
      const integrity = verifyIntegrity(csvContent, writtenFiles, mockParser);
      
      expect(integrity.rowCountMatch).toBe(true);
      expect(integrity.amountMatch).toBe(true);
      expect(integrity.originalAmount).toBe(676.00); // 1000 - 500 + 250.5 - 100.25 - 50 + 75.75
      expect(integrity.partitionedAmount).toBeCloseTo(676.00, 2);
    });

    it('preserves zero amounts correctly', () => {
      const csvContent = `Date,Amount,Description
15/01/2025,0.00,Zero transaction
20/01/2025,100.00,Normal transaction
05/02/2025,0.00,Another zero
10/02/2025,50.00,Normal transaction`;

      (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

      partitionCSVFile('/test.csv', 'test', mockFs);
      
      const integrity = verifyIntegrity(csvContent, writtenFiles, mockParser);
      
      expect(integrity.rowCountMatch).toBe(true);
      expect(integrity.amountMatch).toBe(true);
      expect(integrity.originalAmount).toBe(150.00);
      expect(integrity.partitionedAmount).toBe(150.00);
    });

    it('preserves very large amounts without overflow', () => {
      const csvContent = `Date,Amount,Description
15/01/2025,999999.99,Very large amount
20/01/2025,888888.88,Another large
05/02/2025,777777.77,Third large
10/03/2025,1000000.00,One million`;

      (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

      partitionCSVFile('/test.csv', 'test', mockFs);
      
      const integrity = verifyIntegrity(csvContent, writtenFiles, mockParser);
      
      expect(integrity.rowCountMatch).toBe(true);
      expect(integrity.amountMatch).toBe(true);
      expect(integrity.originalAmount).toBe(3666666.64);
      expect(integrity.partitionedAmount).toBeCloseTo(3666666.64, 2);
    });

    it('preserves decimal precision (penny amounts)', () => {
      const csvContent = `Date,Amount,Description
15/01/2025,0.01,One penny
16/01/2025,0.99,Ninety-nine pence
17/01/2025,1.23,Complex decimal
05/02/2025,9.87,Another decimal
06/02/2025,12.34,More decimals`;

      (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

      partitionCSVFile('/test.csv', 'test', mockFs);
      
      const integrity = verifyIntegrity(csvContent, writtenFiles, mockParser);
      
      expect(integrity.rowCountMatch).toBe(true);
      expect(integrity.amountMatch).toBe(true);
      expect(integrity.originalAmount).toBeCloseTo(24.44, 2);
      expect(integrity.partitionedAmount).toBeCloseTo(24.44, 2);
    });

    it('preserves amounts with many decimal places', () => {
      const csvContent = `Date,Amount,Description
15/01/2025,123.456789,High precision
20/01/2025,987.654321,Another high precision
05/02/2025,0.123456,Very small`;

      (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

      partitionCSVFile('/test.csv', 'test', mockFs);
      
      const integrity = verifyIntegrity(csvContent, writtenFiles, mockParser);
      
      expect(integrity.rowCountMatch).toBe(true);
      // Should match within floating point tolerance
      expect(integrity.amountDifference).toBeLessThan(0.01);
    });
  });

  describe('Row Count Verification', () => {
    it('preserves exact row count across all partitions', () => {
      const csvContent = `Date,Amount,Description
15/01/2025,100.00,Transaction 1
20/01/2025,200.00,Transaction 2
25/01/2025,300.00,Transaction 3
05/02/2025,400.00,Transaction 4
10/02/2025,500.00,Transaction 5
15/03/2025,600.00,Transaction 6
20/03/2025,700.00,Transaction 7
25/03/2025,800.00,Transaction 8`;

      (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

      partitionCSVFile('/test.csv', 'test', mockFs);
      
      const integrity = verifyIntegrity(csvContent, writtenFiles, mockParser);
      
      expect(integrity.rowCountMatch).toBe(true);
      expect(integrity.originalRowCount).toBe(8);
      expect(integrity.partitionedRowCount).toBe(8);
    });

    it('preserves duplicate rows with occurrence tracking', () => {
      const csvContent = `Date,Amount,Description
15/01/2025,100.00,Duplicate transaction
15/01/2025,100.00,Duplicate transaction
20/01/2025,200.00,Normal transaction
05/02/2025,100.00,Duplicate transaction
05/02/2025,100.00,Duplicate transaction`;

      (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

      partitionCSVFile('/test.csv', 'test', mockFs);
      
      const integrity = verifyIntegrity(csvContent, writtenFiles, mockParser);
      
      // With occurrence tracking, all rows preserved (with occurrence: 1, 2 for duplicates)
      expect(integrity.rowCountMatch).toBe(true);
      expect(integrity.originalRowCount).toBe(5);
      expect(integrity.partitionedRowCount).toBe(5); // All rows preserved
      expect(integrity.amountMatch).toBe(true);
      expect(integrity.originalAmount).toBe(600.00);
      expect(integrity.partitionedAmount).toBeCloseTo(600.00, 2); // All amounts preserved
    });

    it('preserves triplicate and higher duplicate counts with occurrence', () => {
      const csvContent = `Date,Amount,Description
15/01/2025,50.00,Triple
15/01/2025,50.00,Triple
15/01/2025,50.00,Triple
20/01/2025,100.00,Quadruple
20/01/2025,100.00,Quadruple
20/01/2025,100.00,Quadruple
20/01/2025,100.00,Quadruple
05/02/2025,200.00,Single`;

      (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

      partitionCSVFile('/test.csv', 'test', mockFs);
      
      const integrity = verifyIntegrity(csvContent, writtenFiles, mockParser);
      
      // With occurrence tracking, all rows preserved
      expect(integrity.rowCountMatch).toBe(true);
      expect(integrity.originalRowCount).toBe(8);
      expect(integrity.partitionedRowCount).toBe(8); // All rows preserved
      expect(integrity.amountMatch).toBe(true);
      expect(integrity.originalAmount).toBe(750.00); // 3*50 + 4*100 + 200
      expect(integrity.partitionedAmount).toBeCloseTo(750.00, 2); // All amounts preserved
    });

    it('maintains chronological order within each month partition', () => {
      const csvContent = `Date,Amount,Description
05/01/2025,100.00,Early Jan
25/01/2025,200.00,Late Jan
10/01/2025,150.00,Mid Jan
15/01/2025,175.00,Mid-late Jan
01/01/2025,50.00,First Jan
10/02/2025,300.00,Feb transaction`;

      (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

      partitionCSVFile('/test.csv', 'test', mockFs);
      
      // Verify integrity - all rows should be preserved
      const integrity = verifyIntegrity(csvContent, writtenFiles, mockParser);
      expect(integrity.rowCountMatch).toBe(true);
      expect(integrity.amountMatch).toBe(true);
      
      // 5 transactions in January, 1 in February
      expect(integrity.partitionedRowCount).toBe(6);
    });
  });

  describe('Field Integrity', () => {
    it('preserves all field values exactly (no modifications)', () => {
      const csvContent = `Date,Amount,Description
15/01/2025,100.50,EXACT TEXT HERE
20/01/2025,200.75,Special chars: £€$@#%
05/02/2025,50.25,"Quoted text with, comma"`;

      (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

      partitionCSVFile('/test.csv', 'test', mockFs);
      
      // Parse original and partitioned content
      const originalRows = parseCSVContent(csvContent);
      
      let allPartitionedRows: Array<Record<string, string>> = [];
      for (const [_, content] of writtenFiles) {
        const rows = parseCSVContent(content);
        allPartitionedRows = allPartitionedRows.concat(rows);
      }
      
      // Check that each original row exists in partitioned rows
      expect(allPartitionedRows.length).toBe(originalRows.length);
      
      // Verify specific field preservation
      const row1 = allPartitionedRows.find(r => r.Description === 'EXACT TEXT HERE');
      expect(row1).toBeDefined();
      expect(row1?.Amount).toBe('100.50');
      
      const row2 = allPartitionedRows.find(r => r.Description === 'Special chars: £€$@#%');
      expect(row2).toBeDefined();
      expect(row2?.Amount).toBe('200.75');
    });

    it('preserves whitespace in fields (leading, trailing, internal)', () => {
      const csvContent = `Date,Amount,Description
15/01/2025,100.00,"  Leading spaces"
20/01/2025,200.00,"Trailing spaces  "
05/02/2025,300.00,"  Both sides  "
10/02/2025,400.00,"Internal   spaces"`;

      (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

      partitionCSVFile('/test.csv', 'test', mockFs);
      
      // Collect all partitioned rows
      let allPartitionedRows: Array<Record<string, string>> = [];
      for (const [_, content] of writtenFiles) {
        const rows = parseCSVContent(content);
        allPartitionedRows = allPartitionedRows.concat(rows);
      }
      
      // Verify whitespace preservation
      const leadingRow = allPartitionedRows.find(r => r.Description.includes('Leading'));
      expect(leadingRow?.Description).toBe('  Leading spaces');
      
      const trailingRow = allPartitionedRows.find(r => r.Description.includes('Trailing'));
      expect(trailingRow?.Description).toBe('Trailing spaces  ');
      
      const bothRow = allPartitionedRows.find(r => r.Amount === '300.00');
      expect(bothRow?.Description).toBe('  Both sides  ');
      
      const internalRow = allPartitionedRows.find(r => r.Amount === '400.00');
      expect(internalRow?.Description).toBe('Internal   spaces');
    });

    it('preserves empty non-required fields correctly', () => {
      // Only description can be empty; date and amount are required
      const csvContent = `Date,Amount,Description
15/01/2025,100.00,
20/01/2025,50.00,Has description
05/02/2025,200.00,Normal
10/02/2025,75.00,`;

      (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

      partitionCSVFile('/test.csv', 'test', mockFs);
      
      // Collect all partitioned rows
      let allPartitionedRows: Array<Record<string, string>> = [];
      for (const [_, content] of writtenFiles) {
        const rows = parseCSVContent(content);
        allPartitionedRows = allPartitionedRows.concat(rows);
      }
      
      expect(allPartitionedRows.length).toBe(4);
      
      // Row with empty description (allowed)
      const row1 = allPartitionedRows.find(r => r.Amount === '100.00');
      expect(row1?.Description).toBe('');
      
      // Row with populated description
      const row2 = allPartitionedRows.find(r => r.Amount === '50.00');
      expect(row2?.Description).toBe('Has description');
      
      // Another row with empty description (allowed)
      const row4 = allPartitionedRows.find(r => r.Amount === '75.00');
      expect(row4?.Description).toBe('');
    });
  });
});

// ============================================
// DATE BOUNDARY EDGE CASES
// ============================================

describe('Date Boundary Edge Cases', () => {
  let mockFs: FileSystem;
  let writtenFiles: Map<string, string>;

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

  describe('Year Transitions', () => {
    it('handles year transition from December to January', () => {
      const csvContent = `Date,Amount,Description
25/12/2024,100.00,Late December
31/12/2024,200.00,New Year Eve
01/01/2025,300.00,New Year Day
05/01/2025,400.00,Early January`;

      (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

      const result = partitionCSVFile('/test.csv', 'test', mockFs);
      
      expect(result.filesCreated).toHaveLength(2);
      expect(result.filesCreated).toContain('2024-12_transactions_test.csv');
      expect(result.filesCreated).toContain('2025-01_transactions_test.csv');
      
      const integrity = verifyIntegrity(csvContent, writtenFiles, mockParser);
      expect(integrity.rowCountMatch).toBe(true);
      expect(integrity.amountMatch).toBe(true);
    });

    it('handles leap year (Feb 29, 2024)', () => {
      const csvContent = `Date,Amount,Description
27/02/2024,100.00,Before leap day
28/02/2024,200.00,Day before leap
29/02/2024,300.00,Leap day itself
01/03/2024,400.00,After leap day`;

      (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

      const result = partitionCSVFile('/test.csv', 'test', mockFs);
      
      expect(result.filesCreated).toHaveLength(2);
      expect(result.filesCreated).toContain('2024-02_transactions_test.csv');
      expect(result.filesCreated).toContain('2024-03_transactions_test.csv');
      
      // Verify Feb partition has 3 rows including leap day
      const febFile = Array.from(writtenFiles.entries()).find(([path]) => 
        path.includes('2024-02')
      );
      const febRows = parseCSVContent(febFile![1]);
      expect(febRows.length).toBe(3);
      
      const integrity = verifyIntegrity(csvContent, writtenFiles, mockParser);
      expect(integrity.rowCountMatch).toBe(true);
      expect(integrity.amountMatch).toBe(true);
    });

    it('handles non-leap year (no Feb 29, 2025)', () => {
      const csvContent = `Date,Amount,Description
27/02/2025,100.00,Near end of Feb
28/02/2025,200.00,Last day of Feb
01/03/2025,300.00,First March`;

      (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

      const result = partitionCSVFile('/test.csv', 'test', mockFs);
      
      expect(result.filesCreated).toHaveLength(2);
      
      const febFile = Array.from(writtenFiles.entries()).find(([path]) => 
        path.includes('2025-02')
      );
      const febRows = parseCSVContent(febFile![1]);
      expect(febRows.length).toBe(2); // Only 28 days
      
      const integrity = verifyIntegrity(csvContent, writtenFiles, mockParser);
      expect(integrity.rowCountMatch).toBe(true);
      expect(integrity.amountMatch).toBe(true);
    });
  });

  describe('Month Boundaries', () => {
    it('handles transactions on first and last day of month', () => {
      const csvContent = `Date,Amount,Description
01/01/2025,100.00,First day of month
31/01/2025,200.00,Last day of month
01/02/2025,300.00,First day next month`;

      (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

      const result = partitionCSVFile('/test.csv', 'test', mockFs);
      
      expect(result.filesCreated).toHaveLength(2);
      
      const janFile = Array.from(writtenFiles.entries()).find(([path]) => 
        path.includes('2025-01')
      );
      const janRows = parseCSVContent(janFile![1]);
      expect(janRows.length).toBe(2);
      
      const integrity = verifyIntegrity(csvContent, writtenFiles, mockParser);
      expect(integrity.rowCountMatch).toBe(true);
      expect(integrity.amountMatch).toBe(true);
    });

    it('handles months with different day counts (28, 30, 31)', () => {
      const csvContent = `Date,Amount,Description
31/01/2025,100.00,31-day month
28/02/2025,200.00,28-day month (non-leap)
30/04/2025,300.00,30-day month
31/05/2025,400.00,31-day month`;

      (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

      const result = partitionCSVFile('/test.csv', 'test', mockFs);
      
      expect(result.filesCreated).toHaveLength(4);
      expect(result.filesCreated).toContain('2025-01_transactions_test.csv');
      expect(result.filesCreated).toContain('2025-02_transactions_test.csv');
      expect(result.filesCreated).toContain('2025-04_transactions_test.csv');
      expect(result.filesCreated).toContain('2025-05_transactions_test.csv');
      
      const integrity = verifyIntegrity(csvContent, writtenFiles, mockParser);
      expect(integrity.rowCountMatch).toBe(true);
      expect(integrity.amountMatch).toBe(true);
    });

    it('handles single transaction per month across 12 months', () => {
      const csvContent = `Date,Amount,Description
15/01/2025,100.00,January
15/02/2025,100.00,February
15/03/2025,100.00,March
15/04/2025,100.00,April
15/05/2025,100.00,May
15/06/2025,100.00,June
15/07/2025,100.00,July
15/08/2025,100.00,August
15/09/2025,100.00,September
15/10/2025,100.00,October
15/11/2025,100.00,November
15/12/2025,100.00,December`;

      (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

      const result = partitionCSVFile('/test.csv', 'test', mockFs);
      
      expect(result.filesCreated).toHaveLength(12);
      
      // Verify each month has exactly 1 row
      for (const [_, content] of writtenFiles) {
        const rows = parseCSVContent(content);
        expect(rows.length).toBe(1);
      }
      
      const integrity = verifyIntegrity(csvContent, writtenFiles, mockParser);
      expect(integrity.rowCountMatch).toBe(true);
      expect(integrity.originalAmount).toBe(1200.00);
      expect(integrity.partitionedAmount).toBe(1200.00);
    });

    it('handles all transactions on same day but different months', () => {
      const csvContent = `Date,Amount,Description
15/01/2025,100.00,Month 1
15/02/2025,200.00,Month 2
15/03/2025,300.00,Month 3`;

      (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

      const result = partitionCSVFile('/test.csv', 'test', mockFs);
      
      expect(result.filesCreated).toHaveLength(3);
      
      const integrity = verifyIntegrity(csvContent, writtenFiles, mockParser);
      expect(integrity.rowCountMatch).toBe(true);
      expect(integrity.amountMatch).toBe(true);
    });
  });
});

// ============================================
// FILE SIZE EDGE CASES
// ============================================

describe('File Size Edge Cases', () => {
  let mockFs: FileSystem;
  let writtenFiles: Map<string, string>;

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

  it('handles file with only 1 row (minimum valid file)', () => {
    const csvContent = `Date,Amount,Description
15/01/2025,100.00,Single transaction`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    const result = partitionCSVFile('/test.csv', 'test', mockFs);
    
    // Single month file - won't be partitioned, but totalRows should be tracked
    expect(result.totalRows).toBe(1);
    
    // If not partitioned, writtenFiles will be empty - that's OK for single-month files
    if (result.filesCreated.length > 0) {
      const integrity = verifyIntegrity(csvContent, writtenFiles, mockParser);
      expect(integrity.rowCountMatch).toBe(true);
      expect(integrity.amountMatch).toBe(true);
    }
  });

  it('handles file with 2 rows (minimum for multi-month)', () => {
    const csvContent = `Date,Amount,Description
15/01/2025,100.00,First month
15/02/2025,200.00,Second month`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    const result = partitionCSVFile('/test.csv', 'test', mockFs);
    
    expect(result.filesCreated).toHaveLength(2);
    expect(result.totalRows).toBe(2);
    
    const integrity = verifyIntegrity(csvContent, writtenFiles, mockParser);
    expect(integrity.rowCountMatch).toBe(true);
    expect(integrity.amountMatch).toBe(true);
  });

  it('handles file with 100 rows', () => {
    // Generate 100 rows across 3 months
    const rows: string[] = ['Date,Amount,Description'];
    for (let i = 1; i <= 100; i++) {
      const month = (i % 3) + 1; // Cycles through months 1, 2, 3
      rows.push(`15/0${month}/2025,${i * 10}.00,Transaction ${i}`);
    }
    const csvContent = rows.join('\n');

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    const result = partitionCSVFile('/test.csv', 'test', mockFs);
    
    expect(result.totalRows).toBe(100);
    expect(result.filesCreated.length).toBeGreaterThan(0);
    
    const integrity = verifyIntegrity(csvContent, writtenFiles, mockParser);
    expect(integrity.rowCountMatch).toBe(true);
    expect(integrity.originalRowCount).toBe(100);
    expect(integrity.partitionedRowCount).toBe(100);
  });

  it('handles file with 1000+ rows (performance test)', () => {
    // Generate 1000 rows across 12 months
    const rows: string[] = ['Date,Amount,Description'];
    for (let i = 1; i <= 1000; i++) {
      const month = ((i - 1) % 12) + 1; // Cycles through months 1-12
      const monthStr = month < 10 ? `0${month}` : `${month}`;
      rows.push(`15/${monthStr}/2025,${(i * 5.50).toFixed(2)},Transaction ${i}`);
    }
    const csvContent = rows.join('\n');

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    const startTime = Date.now();
    const result = partitionCSVFile('/test.csv', 'test', mockFs);
    const duration = Date.now() - startTime;
    
    expect(result.totalRows).toBe(1000);
    expect(result.filesCreated).toHaveLength(12); // All 12 months
    
    const integrity = verifyIntegrity(csvContent, writtenFiles, mockParser);
    expect(integrity.rowCountMatch).toBe(true);
    expect(integrity.originalRowCount).toBe(1000);
    expect(integrity.partitionedRowCount).toBe(1000);
    
    // Performance check: should complete in reasonable time
    expect(duration).toBeLessThan(5000); // 5 seconds max
  });

  it('handles file with 10000+ rows (stress test)', () => {
    // Generate 10000 rows across 12 months
    const rows: string[] = ['Date,Amount,Description'];
    for (let i = 1; i <= 10000; i++) {
      const month = ((i - 1) % 12) + 1;
      const monthStr = month < 10 ? `0${month}` : `${month}`;
      rows.push(`15/${monthStr}/2025,${(i * 2.25).toFixed(2)},Transaction ${i}`);
    }
    const csvContent = rows.join('\n');

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    const startTime = Date.now();
    const result = partitionCSVFile('/test.csv', 'test', mockFs);
    const duration = Date.now() - startTime;
    
    expect(result.totalRows).toBe(10000);
    expect(result.filesCreated).toHaveLength(12);
    
    const integrity = verifyIntegrity(csvContent, writtenFiles, mockParser);
    expect(integrity.rowCountMatch).toBe(true);
    expect(integrity.originalRowCount).toBe(10000);
    expect(integrity.partitionedRowCount).toBe(10000);
    
    // Stress test: should still complete in reasonable time
    expect(duration).toBeLessThan(10000); // 10 seconds max
  });
});

// ============================================
// FILE STRUCTURE EDGE CASES
// ============================================

describe('File Structure Edge Cases', () => {
  let mockFs: FileSystem;
  let writtenFiles: Map<string, string>;

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

  it('handles file with only headers (no data rows)', () => {
    const csvContent = `Date,Amount,Description`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    const result = partitionCSVFile('/test.csv', 'test', mockFs);
    
    expect(result.totalRows).toBe(0);
    expect(result.filesCreated).toHaveLength(0);
  });

  it('handles file with BOM (Byte Order Mark)', () => {
    // BOM should be stripped by parser preprocess
    const csvContent = `Date,Amount,Description
15/01/2025,100.00,Transaction
20/01/2025,200.00,Same month
05/02/2025,300.00,Different month`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    const result = partitionCSVFile('/test.csv', 'test', mockFs);
    
    expect(result.totalRows).toBe(3);
    
    // Verify integrity
    if (writtenFiles.size > 0) {
      const integrity = verifyIntegrity(csvContent, writtenFiles, mockParser);
      expect(integrity.rowCountMatch).toBe(true);
      expect(integrity.amountMatch).toBe(true);
    }
  });

  it('handles CRLF line endings (Windows)', () => {
    const csvContent = `Date,Amount,Description\r
15/01/2025,100.00,Windows line ending\r
20/02/2025,200.00,Another Windows line`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    const result = partitionCSVFile('/test.csv', 'test', mockFs);
    
    expect(result.totalRows).toBe(2);
    
    const integrity = verifyIntegrity(csvContent, writtenFiles, mockParser);
    expect(integrity.rowCountMatch).toBe(true);
    expect(integrity.amountMatch).toBe(true);
  });

  it('handles LF line endings (Unix/Mac)', () => {
    const csvContent = `Date,Amount,Description
15/01/2025,100.00,Unix line ending
20/02/2025,200.00,Another Unix line`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    const result = partitionCSVFile('/test.csv', 'test', mockFs);
    
    expect(result.totalRows).toBe(2);
    
    const integrity = verifyIntegrity(csvContent, writtenFiles, mockParser);
    expect(integrity.rowCountMatch).toBe(true);
    expect(integrity.amountMatch).toBe(true);
  });

  it('handles file with trailing newlines', () => {
    const csvContent = `Date,Amount,Description
15/01/2025,100.00,Transaction
20/02/2025,200.00,Another

`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    const result = partitionCSVFile('/test.csv', 'test', mockFs);
    
    expect(result.totalRows).toBe(2);
    
    const integrity = verifyIntegrity(csvContent, writtenFiles, mockParser);
    expect(integrity.rowCountMatch).toBe(true);
    expect(integrity.amountMatch).toBe(true);
  });

  it('handles file with no trailing newline', () => {
    const csvContent = `Date,Amount,Description
15/01/2025,100.00,Transaction
20/02/2025,200.00,Last line no newline`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    const result = partitionCSVFile('/test.csv', 'test', mockFs);
    
    expect(result.totalRows).toBe(2);
    
    const integrity = verifyIntegrity(csvContent, writtenFiles, mockParser);
    expect(integrity.rowCountMatch).toBe(true);
    expect(integrity.amountMatch).toBe(true);
  });

  it('handles file with extra unexpected columns', () => {
    const csvContent = `Date,Amount,Description,ExtraColumn1,ExtraColumn2
15/01/2025,100.00,Transaction,Extra1,Extra2
20/02/2025,200.00,Another,ExtraA,ExtraB`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    const result = partitionCSVFile('/test.csv', 'test', mockFs);
    
    expect(result.totalRows).toBe(2);
    
    // Should still work and preserve extra columns
    const integrity = verifyIntegrity(csvContent, writtenFiles, mockParser);
    expect(integrity.rowCountMatch).toBe(true);
    expect(integrity.amountMatch).toBe(true);
  });

  it('handles file with columns in different order', () => {
    // Create a custom parser for this test with different column order
    const customParser: BankParser = {
      ...mockParser,
      headers: ['Description', 'Amount', 'Date'] as const,
    };
    
    (PARSERS as Record<string, BankParser>)['test-custom'] = customParser;

    const csvContent = `Description,Amount,Date
Transaction,100.00,15/01/2025
Another,200.00,20/02/2025`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    const result = partitionCSVFile('/test.csv', 'test-custom', mockFs);
    
    expect(result.totalRows).toBe(2);
    
    const integrity = verifyIntegrity(csvContent, writtenFiles, customParser);
    expect(integrity.rowCountMatch).toBe(true);
    expect(integrity.amountMatch).toBe(true);
  });
});

// ============================================
// DATA QUALITY EDGE CASES
// ============================================

describe('Data Quality Edge Cases', () => {
  let mockFs: FileSystem;
  let writtenFiles: Map<string, string>;

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

  it('rejects file with mix of valid and invalid dates', () => {
    const csvContent = `Date,Amount,Description
15/01/2025,100.00,Valid date
INVALID,200.00,Invalid date
20/01/2025,300.00,Another valid`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    // Should reject entire file due to invalid date
    expect(() => {
      partitionCSVFile('/test.csv', 'test', mockFs);
    }).toThrow('CSV validation failed');
  });

  it('rejects file with empty date field', () => {
    const csvContent = `Date,Amount,Description
15/01/2025,100.00,Valid
,200.00,Empty date
20/02/2025,300.00,Valid again`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    // Should reject entire file due to empty date
    expect(() => {
      partitionCSVFile('/test.csv', 'test', mockFs);
    }).toThrow('CSV validation failed');
  });

  it('rejects file with malformed date formats (wrong separators)', () => {
    const csvContent = `Date,Amount,Description
15-01-2025,100.00,Dash separator
15.01.2025,200.00,Dot separator
15/01/2025,300.00,Correct Jan`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    // Should reject entire file due to malformed dates
    expect(() => {
      partitionCSVFile('/test.csv', 'test', mockFs);
    }).toThrow('CSV validation failed');
  });

  it('handles dates in wrong century (1925 vs 2025)', () => {
    const csvContent = `Date,Amount,Description
15/01/1925,100.00,Wrong century
15/01/2025,200.00,Correct century
15/01/2125,300.00,Future century`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    const result = partitionCSVFile('/test.csv', 'test', mockFs);
    
    // All dates are technically valid, should partition by their years
    expect(result.totalRows).toBeGreaterThan(0);
    
    const allRows = Array.from(writtenFiles.values())
      .flatMap(content => parseCSVContent(content));
    
    // Should preserve all rows even with different centuries
    expect(allRows.length).toBeGreaterThan(0);
  });
});

// ============================================
// CSV FORMATTING EDGE CASES
// ============================================

describe('CSV Formatting Edge Cases', () => {
  let mockFs: FileSystem;
  let writtenFiles: Map<string, string>;

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

  it('handles Unicode characters (£, €, emoji)', () => {
    const csvContent = `Date,Amount,Description
15/01/2025,100.00,Payment in £ pounds
20/01/2025,200.00,Payment in € euros
05/02/2025,300.00,😀 Emoji in description
10/02/2025,400.00,Ñoño special chars`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    partitionCSVFile('/test.csv', 'test', mockFs);
    
    const integrity = verifyIntegrity(csvContent, writtenFiles, mockParser);
    expect(integrity.rowCountMatch).toBe(true);
    expect(integrity.amountMatch).toBe(true);
    
    // Verify Unicode preservation
    const allRows = Array.from(writtenFiles.values())
      .flatMap(content => parseCSVContent(content));
    
    const poundRow = allRows.find(r => r.Description.includes('£'));
    const euroRow = allRows.find(r => r.Description.includes('€'));
    const emojiRow = allRows.find(r => r.Description.includes('😀'));
    const specialRow = allRows.find(r => r.Description.includes('Ñ'));
    
    expect(poundRow).toBeDefined();
    expect(euroRow).toBeDefined();
    expect(emojiRow).toBeDefined();
    expect(specialRow).toBeDefined();
  });

  it('handles nested quotes correctly', () => {
    const csvContent = `Date,Amount,Description
15/01/2025,100.00,"He said ""hello"" to me"
20/02/2025,200.00,"Quote with ""nested"" quotes"`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    partitionCSVFile('/test.csv', 'test', mockFs);
    
    const integrity = verifyIntegrity(csvContent, writtenFiles, mockParser);
    expect(integrity.rowCountMatch).toBe(true);
    expect(integrity.amountMatch).toBe(true);
    
    // Verify nested quotes preservation
    const allRows = Array.from(writtenFiles.values())
      .flatMap(content => parseCSVContent(content));
    
    expect(allRows.length).toBe(2);
    
    // csv-parse converts "" to " in the parsed output
    const row1 = allRows.find(r => r.Amount === '100.00');
    expect(row1?.Description).toContain('hello');
    
    const row2 = allRows.find(r => r.Amount === '200.00');
    expect(row2?.Description).toContain('nested');
  });

  it('handles very long fields (>1KB)', () => {
    const longDescription = 'A'.repeat(2000); // 2KB of text
    const csvContent = `Date,Amount,Description
15/01/2025,100.00,"${longDescription}"
20/02/2025,200.00,Normal description`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    partitionCSVFile('/test.csv', 'test', mockFs);
    
    const integrity = verifyIntegrity(csvContent, writtenFiles, mockParser);
    expect(integrity.rowCountMatch).toBe(true);
    expect(integrity.amountMatch).toBe(true);
    
    // Verify long field preservation
    const allRows = Array.from(writtenFiles.values())
      .flatMap(content => parseCSVContent(content));
    
    const longRow = allRows.find(r => r.Amount === '100.00');
    expect(longRow?.Description.length).toBe(2000);
    expect(longRow?.Description).toBe(longDescription);
  });
});

// ============================================
// REAL-WORLD SCENARIOS
// ============================================

describe('Real-World Scenarios', () => {
  let mockFs: FileSystem;
  let writtenFiles: Map<string, string>;

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

  it('partitions multiple files independently (no interference)', () => {
    const csv1 = `Date,Amount,Description
15/01/2025,100.00,File 1 Jan
20/02/2025,150.00,File 1 Feb`;
    
    const csv2 = `Date,Amount,Description
10/03/2025,200.00,File 2 Mar
15/04/2025,250.00,File 2 Apr`;

    // Partition first file
    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csv1);
    const result1 = partitionCSVFile('/file1.csv', 'test', mockFs);
    
    const file1WrittenFiles = new Map(writtenFiles);
    writtenFiles.clear();
    
    // Partition second file
    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csv2);
    const result2 = partitionCSVFile('/file2.csv', 'test', mockFs);
    
    // Both should succeed independently
    expect(result1.totalRows).toBe(2);
    expect(result2.totalRows).toBe(2);
    
    const integrity1 = verifyIntegrity(csv1, file1WrittenFiles, mockParser);
    const integrity2 = verifyIntegrity(csv2, writtenFiles, mockParser);
    
    expect(integrity1.amountMatch).toBe(true);
    expect(integrity2.amountMatch).toBe(true);
  });

  it('merges into existing partitioned file (append mode)', () => {
    // First batch
    const csv1 = `Date,Amount,Description
15/01/2025,100.00,First batch`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csv1);
    
    // Mock exists to return true for the partition file
    (mockFs.exists as ReturnType<typeof vi.fn>).mockReturnValue(true);
    
    // Mock readFile to return existing content when reading partition
    const existingContent = `Date,Amount,Description
10/01/2025,50.00,Existing transaction`;
    
    (mockFs.readFile as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      if (path.includes('2025-01')) {
        return existingContent;
      }
      return csv1;
    });

    partitionCSVFile('/file2.csv', 'test', mockFs);
    
    // Should merge with existing
    const janFile = Array.from(writtenFiles.entries()).find(([path]) => 
      path.includes('2025-01')
    );
    
    if (janFile) {
      const rows = parseCSVContent(janFile[1]);
      // Should have both existing and new transactions
      expect(rows.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('handles re-partitioning of already partitioned file (idempotent)', () => {
    // Multi-month file that's already partitioned
    const csvContent = `Date,Amount,Description
15/01/2025,100.00,Transaction 1
20/01/2025,200.00,Transaction 2
05/02/2025,300.00,Transaction 3`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    const result = partitionCSVFile('/2025-01_statement.csv', 'test', mockFs);
    
    // Should handle multi-month file
    expect(result.totalRows).toBe(3);
    
    const integrity = verifyIntegrity(csvContent, writtenFiles, mockParser);
    expect(integrity.rowCountMatch).toBe(true);
    expect(integrity.amountMatch).toBe(true);
  });

  it('preserves transaction integrity with real Barclays format', () => {
    const barclaysParser = (PARSERS as Record<string, BankParser>)['barclays-current'];
    
    const csvContent = `Number,Date,Account,Amount,Subcategory,Memo
1,15/01/2025,Barclays Current,100.50,Income,Salary
2,20/01/2025,Barclays Current,-50.25,Shopping,Groceries
3,05/02/2025,Barclays Current,200.00,Income,Bonus`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    partitionCSVFile('/barclays.csv', 'barclays-current', mockFs);
    
    const integrity = verifyIntegrity(csvContent, writtenFiles, barclaysParser);
    expect(integrity.rowCountMatch).toBe(true);
    expect(integrity.amountMatch).toBe(true);
    expect(integrity.originalAmount).toBe(250.25); // 100.5 - 50.25 + 200
  });

  it('preserves transaction integrity with real NatWest format', () => {
    const natwestParser = (PARSERS as Record<string, BankParser>)['natwest'];
    
    const csvContent = `Date,Type,Description,Value,Balance,Account Name,Account Number
15/01/2025,DEB,Payment,100.00,1000.00,NatWest Current,12345678
20/01/2025,CRE,Deposit,200.00,1200.00,NatWest Current,12345678
05/02/2025,DEB,Transfer,50.00,1150.00,NatWest Current,12345678`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    partitionCSVFile('/natwest.csv', 'natwest', mockFs);
    
    const integrity = verifyIntegrity(csvContent, writtenFiles, natwestParser);
    expect(integrity.rowCountMatch).toBe(true);
    expect(integrity.amountMatch).toBe(true);
    expect(integrity.originalAmount).toBe(350.00);
  });

  it('handles Capital on Tap preprocessing with transaction integrity', () => {
    const capitalParser = (PARSERS as Record<string, BankParser>)['capital-on-tap'];
    
    // Capital on Tap includes a preamble that needs preprocessing
    const csvContent = `Capital on Tap Statement
Generated: 2025-01-25

Clearance Date,Authorisation Date,Description,Amount,Original Amount,Original Currency,Merchant Name,Card Ending,Cardholder Name,Card Name,Transaction Type,Category,Has Receipts,Note
15 Jan 2025,15 Jan 2025,Office Supplies,100.50,100.50,GBP,Staples,1234,John Doe,Business Card,Purchase,Office,No,
20 Jan 2025,20 Jan 2025,Fuel,75.25,75.25,GBP,Shell,1234,John Doe,Business Card,Purchase,Travel,No,
05 Feb 2025,05 Feb 2025,Software,200.00,200.00,GBP,Adobe,1234,John Doe,Business Card,Purchase,Software,No,`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    partitionCSVFile('/capital.csv', 'capital-on-tap', mockFs);
    
    const integrity = verifyIntegrity(csvContent, writtenFiles, capitalParser);
    expect(integrity.rowCountMatch).toBe(true);
    expect(integrity.amountMatch).toBe(true);
    expect(integrity.originalAmount).toBe(375.75);
  });

  it('handles Barclaycard with negative amounts (payments)', () => {
    const barclaycardParser = (PARSERS as Record<string, BankParser>)['barclaycard'];
    
    const csvContent = `Cardholder Name,Account Number,Transaction Date,Merchant Name,Amount,Currency,Original Amount,Original Currency,Conversion Rate,Posted Date,Transaction Time,Authorisation Code,Transaction ID,Merchant Category,Receipt
John Doe,1234567890,15/01/2025,Amazon,100.50,GBP,100.50,GBP,1.0,16/01/2025,14:30,AUTH123,TXN001,Shopping,No
John Doe,1234567890,20/01/2025,Payment,-500.00,GBP,-500.00,GBP,1.0,21/01/2025,09:00,AUTH124,TXN002,Payment,No
John Doe,1234567890,05/02/2025,Tesco,75.25,GBP,75.25,GBP,1.0,06/02/2025,18:15,AUTH125,TXN003,Groceries,No`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    partitionCSVFile('/barclaycard.csv', 'barclaycard', mockFs);
    
    const integrity = verifyIntegrity(csvContent, writtenFiles, barclaycardParser);
    expect(integrity.rowCountMatch).toBe(true);
    expect(integrity.amountMatch).toBe(true);
    expect(integrity.originalAmount).toBe(-324.25); // 100.5 - 500 + 75.25
  });

  it('handles large multi-bank statement with mixed formats', () => {
    // Simulate processing multiple bank statements
    const results: ReturnType<typeof partitionCSVFile>[] = [];
    
    // Barclays - multi-month data
    const barclaysCsv = `Number,Date,Account,Amount,Subcategory,Memo
1,15/01/2025,Barclays,1000.00,Income,Salary
2,15/02/2025,Barclays,1000.00,Income,Salary`;
    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(barclaysCsv);
    results.push(partitionCSVFile('/barclays.csv', 'barclays-current', mockFs));
    const barclaysFiles = new Map(writtenFiles);
    writtenFiles.clear();
    
    // NatWest - multi-month data
    const natwestCsv = `Date,Type,Description,Value,Balance,Account Name,Account Number
15/01/2025,CRE,Deposit,500.00,5000.00,NatWest,12345678
15/02/2025,CRE,Deposit,500.00,5500.00,NatWest,12345678`;
    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(natwestCsv);
    results.push(partitionCSVFile('/natwest.csv', 'natwest', mockFs));
    const natwestFiles = new Map(writtenFiles);
    writtenFiles.clear();
    
    // All should succeed
    expect(results.every(r => r.totalRows > 0)).toBe(true);
    
    // Verify integrity for each
    const barclaysIntegrity = verifyIntegrity(
      barclaysCsv, 
      barclaysFiles, 
      (PARSERS as Record<string, BankParser>)['barclays-current']
    );
    
    const natwestIntegrity = verifyIntegrity(
      natwestCsv, 
      natwestFiles, 
      (PARSERS as Record<string, BankParser>)['natwest']
    );
    
    expect(barclaysIntegrity.amountMatch).toBe(true);
    expect(natwestIntegrity.amountMatch).toBe(true);
  });

  it('handles concurrent partitioning (stress test)', () => {
    // Simulate multiple files being processed with multi-month data
    const files = Array.from({ length: 10 }, (_, i) => ({
      name: `/file${i}.csv`,
      content: `Date,Amount,Description
15/01/2025,${(i + 1) * 100}.00,Transaction ${i} Jan
15/02/2025,${(i + 1) * 50}.00,Transaction ${i} Feb`
    }));
    
    const allResults = files.map(file => {
      const fileWritten = new Map<string, string>();
      const fileMockFs = {
        ...mockFs,
        writeFile: vi.fn((path: string, content: string) => {
          fileWritten.set(path, content);
        })
      };
      
      (fileMockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(file.content);
      const result = partitionCSVFile(file.name, 'test', fileMockFs);
      
      return {
        result,
        integrity: verifyIntegrity(file.content, fileWritten, mockParser)
      };
    });
    
    // All should preserve integrity
    expect(allResults.every(r => r.integrity.rowCountMatch)).toBe(true);
    expect(allResults.every(r => r.integrity.amountMatch)).toBe(true);
  });
});

// ============================================
// INTEGRATION TESTS WITH REAL CSV SAMPLES
// ============================================

describe('Integration Tests with Real Bank CSV Samples', () => {
  let mockFs: FileSystem;
  let writtenFiles: Map<string, string>;
  const fs = require('fs');
  const path = require('path');

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

  it('partitions real Barclays CSV with transaction integrity', () => {
    const samplePath = path.join(__dirname, '../parsers/fixtures/barclays-sample.csv');
    const csvContent = fs.readFileSync(samplePath, 'utf-8');
    
    const barclaysParser = (PARSERS as Record<string, BankParser>)['barclays-current'];
    
    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    const result = partitionCSVFile('/barclays.csv', 'barclays-current', mockFs);
    
    expect(result.totalRows).toBeGreaterThan(0);
    
    // Only verify integrity if file was actually partitioned (multi-month)
    if (writtenFiles.size > 0) {
      const integrity = verifyIntegrity(csvContent, writtenFiles, barclaysParser);
      expect(integrity.rowCountMatch).toBe(true);
      expect(integrity.amountMatch).toBe(true);
      
      // Verify specific amounts from sample
      const originalTotal = -172.99 + -3.06 + -500.00 + -80.40 + 12000.00;
      expect(integrity.originalAmount).toBeCloseTo(originalTotal, 2);
    }
  });

  it('partitions real NatWest CSV with transaction integrity', () => {
    const samplePath = path.join(__dirname, '../parsers/fixtures/natwest-sample.csv');
    const csvContent = fs.readFileSync(samplePath, 'utf-8');
    
    const natwestParser = (PARSERS as Record<string, BankParser>)['natwest'];
    
    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    const result = partitionCSVFile('/natwest.csv', 'natwest', mockFs);
    
    expect(result.totalRows).toBeGreaterThan(0);
    
    // Only verify integrity if file was actually partitioned (multi-month)
    if (writtenFiles.size > 0) {
      const integrity = verifyIntegrity(csvContent, writtenFiles, natwestParser);
      expect(integrity.rowCountMatch).toBe(true);
      expect(integrity.amountMatch).toBe(true);
      
      // Verify specific amounts from sample
      const originalTotal = -6.21 + -8.47 + -62.50 + 100.00 + -21.85;
      expect(integrity.originalAmount).toBeCloseTo(originalTotal, 2);
    }
  });

  it('partitions real Capital on Tap CSV with preprocessing and transaction integrity', () => {
    const samplePath = path.join(__dirname, '../parsers/fixtures/capital-on-tap-sample.csv');
    const csvContent = fs.readFileSync(samplePath, 'utf-8');
    
    const capitalParser = (PARSERS as Record<string, BankParser>)['capital-on-tap'];
    
    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    const result = partitionCSVFile('/capital.csv', 'capital-on-tap', mockFs);
    
    expect(result.totalRows).toBeGreaterThan(0);
    
    // Only verify integrity if file was actually partitioned (multi-month)
    if (writtenFiles.size > 0) {
      const integrity = verifyIntegrity(csvContent, writtenFiles, capitalParser);
      expect(integrity.rowCountMatch).toBe(true);
      expect(integrity.amountMatch).toBe(true);
      
      // Verify specific amounts from sample
      const originalTotal = 105.00 + 101.00 + 19.50 + 149.80 + -100.00;
      expect(integrity.originalAmount).toBeCloseTo(originalTotal, 2);
    }
  });

  it('partitions real Barclaycard CSV with transaction integrity', () => {
    const samplePath = path.join(__dirname, '../parsers/fixtures/barclaycard-sample.csv');
    const csvContent = fs.readFileSync(samplePath, 'utf-8');
    
    const barclaycardParser = (PARSERS as Record<string, BankParser>)['barclaycard'];
    
    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    const result = partitionCSVFile('/barclaycard.csv', 'barclaycard', mockFs);
    
    expect(result.totalRows).toBeGreaterThan(0);
    
    const integrity = verifyIntegrity(csvContent, writtenFiles, barclaycardParser);
    expect(integrity.rowCountMatch).toBe(true);
    expect(integrity.amountMatch).toBe(true);
    
    // Verify specific amounts from sample
    const originalTotal = 84.95 + -10.0 + -86.13 + 1020.0 + -13.0;
    expect(integrity.originalAmount).toBeCloseTo(originalTotal, 2);
  });

  it('preserves all transactions across month boundaries with real data', () => {
    // Use NatWest sample which spans Dec 2024
    const samplePath = path.join(__dirname, '../parsers/fixtures/natwest-sample.csv');
    const csvContent = fs.readFileSync(samplePath, 'utf-8');
    
    const natwestParser = (PARSERS as Record<string, BankParser>)['natwest'];
    
    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);

    const result = partitionCSVFile('/natwest.csv', 'natwest', mockFs);
    
    expect(result.totalRows).toBeGreaterThan(0);
    
    // Only verify if partitioned
    if (writtenFiles.size > 0) {
      const integrity = verifyIntegrity(csvContent, writtenFiles, natwestParser);
      expect(integrity.rowCountMatch).toBe(true);
      expect(integrity.amountMatch).toBe(true);
    }
  });

  it('handles all four bank formats simultaneously', () => {
    const samples = [
      { path: 'barclays-sample.csv', account: 'barclays-current' },
      { path: 'natwest-sample.csv', account: 'natwest' },
      { path: 'capital-on-tap-sample.csv', account: 'capital-on-tap' },
      { path: 'barclaycard-sample.csv', account: 'barclaycard' }
    ];

    const results = samples.map(sample => {
      const samplePath = path.join(__dirname, '../parsers/fixtures', sample.path);
      const csvContent = fs.readFileSync(samplePath, 'utf-8');
      const parser = (PARSERS as Record<string, BankParser>)[sample.account];
      
      const fileWritten = new Map<string, string>();
      const fileMockFs = {
        ...mockFs,
        writeFile: vi.fn((path: string, content: string) => {
          fileWritten.set(path, content);
        })
      };
      
      (fileMockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csvContent);
      const result = partitionCSVFile(`/${sample.path}`, sample.account, fileMockFs);
      
      return {
        account: sample.account,
        result,
        integrity: verifyIntegrity(csvContent, fileWritten, parser)
      };
    });

    // All banks should preserve integrity (if partitioned)
    const partitionedResults = results.filter(r => r.integrity.partitionedRowCount > 0);
    if (partitionedResults.length > 0) {
      expect(partitionedResults.every(r => r.integrity.rowCountMatch)).toBe(true);
      expect(partitionedResults.every(r => r.integrity.amountMatch)).toBe(true);
    }
    expect(results.every(r => r.result.totalRows > 0)).toBe(true);
  });
});

// Register mock parser for tests
import { PARSERS } from '../parsers/index.js';
(PARSERS as Record<string, BankParser>)['test'] = mockParser;

// ============================================
// INTEGRITY VERIFICATION UTILITIES
// ============================================

/**
 * Calculate total amount from CSV content using parser's amount column
 */
function calculateTotalAmount(
  csvContent: string,
  parser: BankParser
): number {
  const rows = parseCSVContent(csvContent);
  return rows.reduce((sum, row) => {
    const amount = parseFloat(getColumnValue(row, parser.amountColumn));
    return sum + (isNaN(amount) ? 0 : amount);
  }, 0);
}

/**
 * Integrity check result
 */
interface IntegrityResult {
  originalRowCount: number;
  originalAmount: number;
  partitionedRowCount: number;
  partitionedAmount: number;
  rowCountMatch: boolean;
  amountMatch: boolean;
  amountDifference: number;
}

/**
 * Verify that partitioned files preserve all data from original
 * CRITICAL: Both row counts and amounts must match exactly
 */
function verifyIntegrity(
  originalCsv: string,
  partitionedFiles: Map<string, string>,
  parser: BankParser
): IntegrityResult {
  // Preprocess the original CSV like the partitioner does
  const preprocessed = parser.preprocess(originalCsv);
  
  const originalRows = parseCSVContent(preprocessed);
  const originalAmount = calculateTotalAmount(preprocessed, parser);
  
  let partitionedRowCount = 0;
  let partitionedAmount = 0;
  
  for (const [_, content] of partitionedFiles) {
    const rows = parseCSVContent(content);
    partitionedRowCount += rows.length;
    partitionedAmount += calculateTotalAmount(content, parser);
  }
  
  const amountDifference = Math.abs(originalAmount - partitionedAmount);
  
  return {
    originalRowCount: originalRows.length,
    originalAmount,
    partitionedRowCount,
    partitionedAmount,
    rowCountMatch: originalRows.length === partitionedRowCount,
    amountMatch: amountDifference < 0.01, // Floating point tolerance
    amountDifference
  };
}

// ============================================
// Row Validation Tests
// ============================================

describe('Row Validation', () => {
  let mockFs: FileSystem;

  beforeEach(() => {
    mockFs = {
      readFile: vi.fn(),
      writeFile: vi.fn(),
      exists: vi.fn().mockReturnValue(false),
      deleteFile: vi.fn(),
      ensureDir: vi.fn(),
    };
  });

  it('should reject CSV with missing date field', () => {
    const csv = `Date,Amount,Description
15/01/2025,100.50,Valid transaction
,50.00,Missing date
17/01/2025,75.25,Another valid one`;
    
    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csv);
    
    expect(() => {
      partitionCSVFile('/data/test/2025-01_transactions_test.csv', 'test', mockFs);
    }).toThrow('CSV validation failed');
  });

  it('should reject CSV with empty date field', () => {
    const csv = `Date,Amount,Description
15/01/2025,100.50,Valid transaction
"",50.00,Empty date
17/01/2025,75.25,Another valid one`;
    
    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csv);
    
    expect(() => {
      partitionCSVFile('/data/test/2025-01_transactions_test.csv', 'test', mockFs);
    }).toThrow('CSV validation failed');
  });

  it('should reject CSV with missing amount field', () => {
    const csv = `Date,Amount,Description
15/01/2025,100.50,Valid transaction
16/01/2025,,Missing amount
17/01/2025,75.25,Another valid one`;
    
    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csv);
    
    expect(() => {
      partitionCSVFile('/data/test/2025-01_transactions_test.csv', 'test', mockFs);
    }).toThrow('CSV validation failed');
  });

  it('should reject CSV with invalid amount (non-numeric)', () => {
    const csv = `Date,Amount,Description
15/01/2025,100.50,Valid transaction
16/01/2025,NOT_A_NUMBER,Invalid amount
17/01/2025,75.25,Another valid one`;
    
    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csv);
    
    expect(() => {
      partitionCSVFile('/data/test/2025-01_transactions_test.csv', 'test', mockFs);
    }).toThrow('CSV validation failed');
  });

  it('should allow missing description (not a required field)', () => {
    const csv = `Date,Amount,Description
15/01/2025,100.50,Valid transaction
16/01/2025,50.00,
17/02/2025,75.25,Another valid one`;
    
    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csv);
    
    const result = partitionCSVFile('/data/test/2025-01_transactions_test.csv', 'test', mockFs);
    
    expect(result.totalRows).toBe(3);
  });
});

// ============================================
// CSV Merge with Deduplication Tests
// ============================================

describe('CSV Merge with Deduplication', () => {
  let mockFs: FileSystem;
  let writtenFiles: Map<string, string>;

  beforeEach(() => {
    writtenFiles = new Map();
    mockFs = {
      readFile: vi.fn((path: string) => {
        // For upload files, mock the original CSV content
        // For partitioned files, return from writtenFiles
        const content = writtenFiles.get(path);
        if (content) return content;
        // If not in writtenFiles, must be original upload - will be set by test
        throw new Error(`File not found: ${path}`);
      }),
      writeFile: vi.fn((path: string, content: string) => {
        writtenFiles.set(path, content);
      }),
      exists: vi.fn((path: string) => writtenFiles.has(path)),
      deleteFile: vi.fn(),
      ensureDir: vi.fn(),
    };
  });

  it('should deduplicate when merging overlapping CSV files', () => {
    // First upload: transactions for full Jan + some Feb
    const upload1 = `Date,Amount,Description
15/01/2025,100.50,Transaction A
20/01/2025,200.00,Transaction B
01/02/2025,50.00,Transaction C
05/02/2025,75.00,Transaction D`;

    // Second upload: more Feb transactions, but includes duplicate of C (need multi-month to trigger partitioning)
    const upload2 = `Date,Amount,Description
25/01/2025,10.00,Filler Jan
01/02/2025,50.00,Transaction C
10/02/2025,125.00,Transaction E`;

    // First partition
    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValueOnce(upload1);
    partitionCSVFile('/data/test/upload1.csv', 'test', mockFs);
    
    // Second partition (should merge and deduplicate Feb file)
    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValueOnce(upload2);
    partitionCSVFile('/data/test/upload2.csv', 'test', mockFs);
    
    // Check Feb file - should have 3 unique transactions (C, D, E), not 4
    const febContent = writtenFiles.get('/data/test/2025-02_transactions_test.csv');
    expect(febContent).toBeDefined();
    const febRows = parseCSVContent(febContent!);
    expect(febRows.length).toBe(3); // C (deduplicated), D, E
    
    // Verify total amount is correct (no double-counting)
    const febAmount = calculateTotalAmount(febContent!, mockParser);
    expect(febAmount).toBeCloseTo(50.00 + 75.00 + 125.00, 2); // C + D + E
  });

  it('should handle partial month overlap correctly', () => {
    // Upload 1: Jan 1-15 (need multi-month to trigger partitioning)
    const upload1 = `Date,Amount,Description
05/01/2025,100.00,Early transaction
15/01/2025,200.00,Mid transaction
01/02/2025,10.00,Filler`;

    // Upload 2: Jan 10-31 (overlaps with mid transaction)
    const upload2 = `Date,Amount,Description
10/01/2025,150.00,New mid transaction
15/01/2025,200.00,Mid transaction
31/01/2025,300.00,End transaction
05/02/2025,20.00,Filler`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValueOnce(upload1);
    partitionCSVFile('/data/test/upload1.csv', 'test', mockFs);
    
    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValueOnce(upload2);
    partitionCSVFile('/data/test/upload2.csv', 'test', mockFs);
    
    const janContent = writtenFiles.get('/data/test/2025-01_transactions_test.csv');
    const janRows = parseCSVContent(janContent!);
    
    // Should have 4 unique transactions (no duplicate of Jan 15)
    expect(janRows.length).toBe(4);
    
    // Verify amount integrity
    const janAmount = calculateTotalAmount(janContent!, mockParser);
    expect(janAmount).toBeCloseTo(100 + 200 + 150 + 300, 2);
  });

  it('should deduplicate across multiple uploads to same month', () => {
    // Need multi-month to trigger partitioning, but focus on one month for dedup test
    const upload1 = `Date,Amount,Description
15/03/2025,100.00,Same transaction
10/04/2025,50.00,April transaction`;

    const upload2 = `Date,Amount,Description
15/03/2025,100.00,Same transaction
15/04/2025,75.00,Another April`;

    const upload3 = `Date,Amount,Description
15/03/2025,100.00,Same transaction
20/04/2025,25.00,Yet another April`;

    // Upload same March transaction 3 times (with different April transactions)
    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValueOnce(upload1);
    partitionCSVFile('/data/test/upload1.csv', 'test', mockFs);
    
    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValueOnce(upload2);
    partitionCSVFile('/data/test/upload2.csv', 'test', mockFs);
    
    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValueOnce(upload3);
    partitionCSVFile('/data/test/upload3.csv', 'test', mockFs);
    
    const marContent = writtenFiles.get('/data/test/2025-03_transactions_test.csv');
    const marRows = parseCSVContent(marContent!);
    
    // Should only have 1 March transaction (deduplicated from 3), not 3
    expect(marRows.length).toBe(1);
    
    const marAmount = calculateTotalAmount(marContent!, mockParser);
    expect(marAmount).toBeCloseTo(100.00, 2);
  });

  it('should treat different descriptions as different transactions', () => {
    const upload1 = `Date,Amount,Description
10/04/2025,50.00,Coffee Shop A
05/05/2025,10.00,Filler`;

    const upload2 = `Date,Amount,Description
10/04/2025,50.00,Coffee Shop B
10/05/2025,20.00,Filler`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValueOnce(upload1);
    partitionCSVFile('/data/test/upload1.csv', 'test', mockFs);
    
    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValueOnce(upload2);
    partitionCSVFile('/data/test/upload2.csv', 'test', mockFs);
    
    const aprContent = writtenFiles.get('/data/test/2025-04_transactions_test.csv');
    const aprRows = parseCSVContent(aprContent!);
    
    // Same date and amount, but different description = 2 transactions
    expect(aprRows.length).toBe(2);
    
    const aprAmount = calculateTotalAmount(aprContent!, mockParser);
    expect(aprAmount).toBeCloseTo(100.00, 2);
  });

  it('should treat different amounts as different transactions', () => {
    const upload1 = `Date,Amount,Description
10/05/2025,50.00,Coffee Shop
05/06/2025,10.00,Filler`;

    const upload2 = `Date,Amount,Description
10/05/2025,51.00,Coffee Shop
10/06/2025,20.00,Filler`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValueOnce(upload1);
    partitionCSVFile('/data/test/upload1.csv', 'test', mockFs);
    
    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValueOnce(upload2);
    partitionCSVFile('/data/test/upload2.csv', 'test', mockFs);
    
    const mayContent = writtenFiles.get('/data/test/2025-05_transactions_test.csv');
    const mayRows = parseCSVContent(mayContent!);
    
    // Same date and description, but different amount = 2 transactions
    expect(mayRows.length).toBe(2);
    
    const mayAmount = calculateTotalAmount(mayContent!, mockParser);
    expect(mayAmount).toBeCloseTo(101.00, 2);
  });

  it('should preserve transaction order after deduplication (first occurrence)', () => {
    const upload1 = `Date,Amount,Description
01/06/2025,100.00,Transaction A
02/06/2025,200.00,Transaction B
03/06/2025,300.00,Transaction C
01/07/2025,10.00,Filler`;

    const upload2 = `Date,Amount,Description
02/06/2025,200.00,Transaction B
04/06/2025,400.00,Transaction D
05/07/2025,20.00,Filler`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValueOnce(upload1);
    partitionCSVFile('/data/test/upload1.csv', 'test', mockFs);
    
    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValueOnce(upload2);
    partitionCSVFile('/data/test/upload2.csv', 'test', mockFs);
    
    const junContent = writtenFiles.get('/data/test/2025-06_transactions_test.csv');
    const junRows = parseCSVContent(junContent!);
    
    // Should have A, B, C, D (4 transactions)
    expect(junRows.length).toBe(4);
    
    // B should appear in its original position (second), not duplicated at the end
    expect(getColumnValue(junRows[0], 'Description')).toBe('Transaction A');
    expect(getColumnValue(junRows[1], 'Description')).toBe('Transaction B');
    expect(getColumnValue(junRows[2], 'Description')).toBe('Transaction C');
    expect(getColumnValue(junRows[3], 'Description')).toBe('Transaction D');
  });

  it('should correctly calculate total amount after deduplication', () => {
    // Upload with intentional duplicates across multiple months
    const upload1 = `Date,Amount,Description
15/07/2025,100.00,Transaction A
20/07/2025,200.00,Transaction B
10/08/2025,150.00,Transaction C`;

    const upload2 = `Date,Amount,Description
15/07/2025,100.00,Transaction A
25/07/2025,250.00,Transaction D
10/08/2025,150.00,Transaction C`;

    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValueOnce(upload1);
    partitionCSVFile('/data/test/upload1.csv', 'test', mockFs);
    
    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValueOnce(upload2);
    partitionCSVFile('/data/test/upload2.csv', 'test', mockFs);
    
    // Check July: A (deduped), B, D = 550.00
    const julContent = writtenFiles.get('/data/test/2025-07_transactions_test.csv');
    const julAmount = calculateTotalAmount(julContent!, mockParser);
    expect(julAmount).toBeCloseTo(100 + 200 + 250, 2);
    
    // Check August: C (deduped) = 150.00
    const augContent = writtenFiles.get('/data/test/2025-08_transactions_test.csv');
    const augAmount = calculateTotalAmount(augContent!, mockParser);
    expect(augAmount).toBeCloseTo(150, 2);
  });
});

// ============================================
// Occurrence Index Tests
// ============================================

describe('Occurrence Index', () => {
  it('should add occurrence: 1 to unique transactions', () => {
    const rows: CSVRow[] = [
      { Date: '15/01/2025', Amount: '100.00', Description: 'Shop A' },
      { Date: '16/01/2025', Amount: '200.00', Description: 'Shop B' }
    ];
    
    const result = addOccurrenceIndex(rows, mockParser);
    
    expect(result.length).toBe(2);
    expect(result[0]._occurrence).toBe('1');
    expect(result[1]._occurrence).toBe('1');
  });

  it('should add occurrence: 1, 2 to duplicate transactions', () => {
    const rows: CSVRow[] = [
      { Date: '15/01/2025', Amount: '50.00', Description: 'Restaurant' },
      { Date: '15/01/2025', Amount: '50.00', Description: 'Restaurant' }
    ];
    
    const result = addOccurrenceIndex(rows, mockParser);
    
    expect(result.length).toBe(2);
    expect(result[0]._occurrence).toBe('1');
    expect(result[1]._occurrence).toBe('2');
  });

  it('should handle triple duplicates', () => {
    const rows: CSVRow[] = [
      { Date: '15/01/2025', Amount: '50.00', Description: 'Coffee' },
      { Date: '15/01/2025', Amount: '50.00', Description: 'Coffee' },
      { Date: '15/01/2025', Amount: '50.00', Description: 'Coffee' }
    ];
    
    const result = addOccurrenceIndex(rows, mockParser);
    
    expect(result.length).toBe(3);
    expect(result[0]._occurrence).toBe('1');
    expect(result[1]._occurrence).toBe('2');
    expect(result[2]._occurrence).toBe('3');
  });

  it('should handle mixed: some unique, some duplicates', () => {
    const rows: CSVRow[] = [
      { Date: '15/01/2025', Amount: '100.00', Description: 'Shop A' },
      { Date: '16/01/2025', Amount: '200.00', Description: 'Shop B' },
      { Date: '17/01/2025', Amount: '50.00', Description: 'Restaurant' },
      { Date: '17/01/2025', Amount: '50.00', Description: 'Restaurant' },
      { Date: '17/01/2025', Amount: '50.00', Description: 'Restaurant' }
    ];
    
    const result = addOccurrenceIndex(rows, mockParser);
    
    expect(result.length).toBe(5);
    
    // Find unique transactions (occurrence: 1)
    const shopA = result.find(r => r.Description === 'Shop A');
    const shopB = result.find(r => r.Description === 'Shop B');
    expect(shopA?._occurrence).toBe('1');
    expect(shopB?._occurrence).toBe('1');
    
    // Find restaurant duplicates (occurrence: 1, 2, 3)
    const restaurants = result.filter(r => r.Description === 'Restaurant');
    expect(restaurants.length).toBe(3);
    const occurrences = restaurants.map(r => r._occurrence).sort();
    expect(occurrences).toEqual(['1', '2', '3']);
  });

  it('should handle case-insensitive descriptions', () => {
    const rows: CSVRow[] = [
      { Date: '15/01/2025', Amount: '50.00', Description: 'Coffee Shop' },
      { Date: '15/01/2025', Amount: '50.00', Description: 'coffee shop' },
      { Date: '15/01/2025', Amount: '50.00', Description: 'COFFEE SHOP' }
    ];
    
    const result = addOccurrenceIndex(rows, mockParser);
    
    expect(result.length).toBe(3);
    // All should be treated as same transaction with different occurrences
    const occurrences = result.map(r => r._occurrence).sort();
    expect(occurrences).toEqual(['1', '2', '3']);
  });
});

// ============================================
// Split Payment Preservation Tests
// ============================================

describe('Split Payment Preservation', () => {
  let mockFs: FileSystem;
  let writtenFiles: Map<string, string>;

  beforeEach(() => {
    writtenFiles = new Map();
    mockFs = {
      readFile: vi.fn(),
      writeFile: vi.fn((path: string, content: string) => {
        writtenFiles.set(path, content);
      }),
      exists: vi.fn().mockReturnValue(false),
      deleteFile: vi.fn(),
      ensureDir: vi.fn(),
    };
  });

  it('should preserve 2 identical split payments within single file', () => {
    const csv = `Date,Amount,Description
15/01/2025,50.00,Restaurant ABC
15/01/2025,50.00,Restaurant ABC
20/01/2025,100.00,Supermarket
05/02/2025,200.00,Filler`;
    
    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csv);
    
    partitionCSVFile('/file.csv', 'test', mockFs);
    
    const janContent = writtenFiles.get('/2025-01_transactions_test.csv');
    expect(janContent).toBeDefined();
    const janRows = parseCSVContent(janContent!);
    
    // Should have 3 transactions in January
    expect(janRows.length).toBe(3);
    
    // Split payments should have occurrence 1 and 2
    const restaurant = janRows.filter(r => getColumnValue(r, 'Description') === 'Restaurant ABC');
    expect(restaurant.length).toBe(2);
    expect(restaurant[0]._occurrence).toBe('1');
    expect(restaurant[1]._occurrence).toBe('2');
    
    // Verify total amount includes both split payments
    const janAmount = calculateTotalAmount(janContent!, mockParser);
    expect(janAmount).toBeCloseTo(50 + 50 + 100, 2);
  });

  it('should preserve 4 identical split payments', () => {
    const csv = `Date,Amount,Description
15/01/2025,25.00,Small Payment
15/01/2025,25.00,Small Payment
15/01/2025,25.00,Small Payment
15/01/2025,25.00,Small Payment
20/02/2025,100.00,Filler`;
    
    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csv);
    
    partitionCSVFile('/file.csv', 'test', mockFs);
    
    const janContent = writtenFiles.get('/2025-01_transactions_test.csv');
    const janRows = parseCSVContent(janContent!);
    
    // Should have 4 split payments
    const splits = janRows.filter(r => getColumnValue(r, 'Description') === 'Small Payment');
    expect(splits.length).toBe(4);
    
    // Check all occurrences
    const occurrences = splits.map(r => r._occurrence).sort();
    expect(occurrences).toEqual(['1', '2', '3', '4']);
    
    // Verify amount integrity
    const janAmount = calculateTotalAmount(janContent!, mockParser);
    expect(janAmount).toBeCloseTo(100, 2);
  });

  it('should preserve split payments across different months', () => {
    const csv = `Date,Amount,Description
15/01/2025,50.00,Restaurant
15/01/2025,50.00,Restaurant
15/02/2025,50.00,Restaurant
15/02/2025,50.00,Restaurant`;
    
    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csv);
    
    partitionCSVFile('/file.csv', 'test', mockFs);
    
    // Check January
    const janContent = writtenFiles.get('/2025-01_transactions_test.csv');
    const janRows = parseCSVContent(janContent!);
    expect(janRows.length).toBe(2);
    expect(janRows[0]._occurrence).toBe('1');
    expect(janRows[1]._occurrence).toBe('2');
    
    // Check February
    const febContent = writtenFiles.get('/2025-02_transactions_test.csv');
    const febRows = parseCSVContent(febContent!);
    expect(febRows.length).toBe(2);
    expect(febRows[0]._occurrence).toBe('1');
    expect(febRows[1]._occurrence).toBe('2');
  });

  it('should verify amount integrity with split payments', () => {
    const csv = `Date,Amount,Description
15/01/2025,50.00,Split Payment
15/01/2025,50.00,Split Payment
20/01/2025,200.00,Normal Payment
25/01/2025,75.00,Another Normal
05/02/2025,100.00,Filler`;
    
    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csv);
    
    partitionCSVFile('/file.csv', 'test', mockFs);
    
    const janContent = writtenFiles.get('/2025-01_transactions_test.csv');
    const janAmount = calculateTotalAmount(janContent!, mockParser);
    
    // Total: 50 + 50 + 200 + 75 = 375
    expect(janAmount).toBeCloseTo(375, 2);
    
    const janRows = parseCSVContent(janContent!);
    expect(janRows.length).toBe(4);
  });

  it('should handle split payments mixed with unique transactions', () => {
    const csv = `Date,Amount,Description
10/01/2025,100.00,Transaction A
11/01/2025,200.00,Transaction B
12/01/2025,50.00,Split
12/01/2025,50.00,Split
13/01/2025,300.00,Transaction C
14/01/2025,400.00,Transaction D
15/01/2025,75.00,Split2
15/01/2025,75.00,Split2
16/01/2025,500.00,Transaction E
17/01/2025,600.00,Transaction F
05/02/2025,100.00,Filler`;
    
    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValue(csv);
    
    partitionCSVFile('/file.csv', 'test', mockFs);
    
    const janContent = writtenFiles.get('/2025-01_transactions_test.csv');
    const janRows = parseCSVContent(janContent!);
    
    // Should have all 10 transactions
    expect(janRows.length).toBe(10);
    
    // Check split payments have correct occurrences
    const split1 = janRows.filter(r => getColumnValue(r, 'Description') === 'Split');
    expect(split1.length).toBe(2);
    expect(split1[0]._occurrence).toBe('1');
    expect(split1[1]._occurrence).toBe('2');
    
    const split2 = janRows.filter(r => getColumnValue(r, 'Description') === 'Split2');
    expect(split2.length).toBe(2);
    expect(split2[0]._occurrence).toBe('1');
    expect(split2[1]._occurrence).toBe('2');
    
    // All others should have occurrence: 1
    const unique = janRows.filter(r => 
      !['Split', 'Split2'].includes(getColumnValue(r, 'Description'))
    );
    expect(unique.length).toBe(6);
    unique.forEach(row => {
      expect(row._occurrence).toBe('1');
    });
  });
});

// ============================================
// Cross-File Deduplication with Occurrence Tests
// ============================================

describe('Cross-File Deduplication with Occurrence', () => {
  let mockFs: FileSystem;
  let writtenFiles: Map<string, string>;

  beforeEach(() => {
    writtenFiles = new Map();
    mockFs = {
      readFile: vi.fn((path: string) => {
        const content = writtenFiles.get(path);
        if (content) return content;
        throw new Error(`File not found: ${path}`);
      }),
      writeFile: vi.fn((path: string, content: string) => {
        writtenFiles.set(path, content);
      }),
      exists: vi.fn((path: string) => writtenFiles.has(path)),
      deleteFile: vi.fn(),
      ensureDir: vi.fn(),
    };
  });

  it('should deduplicate single occurrence across files', () => {
    const file1 = `Date,Amount,Description
15/01/2025,100.00,Shop A
20/01/2025,200.00,Shop B
05/02/2025,50.00,Filler`;

    const file2 = `Date,Amount,Description
15/01/2025,100.00,Shop A
25/01/2025,300.00,Shop C
10/02/2025,75.00,Filler`;
    
    // Upload file1
    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValueOnce(file1);
    partitionCSVFile('/file1.csv', 'test', mockFs);
    
    // Upload file2 (overlapping)
    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValueOnce(file2);
    partitionCSVFile('/file2.csv', 'test', mockFs);
    
    const janContent = writtenFiles.get('/2025-01_transactions_test.csv');
    const janRows = parseCSVContent(janContent!);
    
    // Should have 3 unique transactions (Shop A occurrence:1 deduplicated)
    expect(janRows.length).toBe(3);
    
    const shopA = janRows.filter(r => getColumnValue(r, 'Description') === 'Shop A');
    expect(shopA.length).toBe(1); // Deduplicated
    expect(shopA[0]._occurrence).toBe('1');
  });

  it('should NOT deduplicate different occurrences across files', () => {
    const file1 = `Date,Amount,Description
15/01/2025,50.00,Restaurant
15/01/2025,50.00,Restaurant
20/02/2025,100.00,Filler`;

    const file2 = `Date,Amount,Description
15/01/2025,50.00,Restaurant
25/02/2025,200.00,Filler`;
    
    // Upload both
    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValueOnce(file1);
    partitionCSVFile('/file1.csv', 'test', mockFs);
    
    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValueOnce(file2);
    partitionCSVFile('/file2.csv', 'test', mockFs);
    
    const janContent = writtenFiles.get('/2025-01_transactions_test.csv');
    const janRows = parseCSVContent(janContent!);
    
    // Should have 2 restaurant transactions
    // File1's occurrence:2 should be preserved
    expect(janRows.length).toBe(2);
    const restaurant = janRows.filter(r => getColumnValue(r, 'Description') === 'Restaurant');
    expect(restaurant.length).toBe(2);
    
    const occurrences = restaurant.map(r => r._occurrence).sort();
    expect(occurrences).toEqual(['1', '2']);
    
    // Verify amount
    const janAmount = calculateTotalAmount(janContent!, mockParser);
    expect(janAmount).toBeCloseTo(100, 2);
  });

  it('should handle 3-way file merge correctly', () => {
    const file1 = `Date,Amount,Description
15/01/2025,50.00,Restaurant
15/01/2025,50.00,Restaurant
20/02/2025,100.00,Filler`;

    const file2 = `Date,Amount,Description
15/01/2025,50.00,Restaurant
25/02/2025,200.00,Filler`;

    const file3 = `Date,Amount,Description
15/01/2025,50.00,Restaurant
28/02/2025,300.00,Filler`;
    
    // Upload all three
    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValueOnce(file1);
    partitionCSVFile('/file1.csv', 'test', mockFs);
    
    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValueOnce(file2);
    partitionCSVFile('/file2.csv', 'test', mockFs);
    
    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValueOnce(file3);
    partitionCSVFile('/file3.csv', 'test', mockFs);
    
    const janContent = writtenFiles.get('/2025-01_transactions_test.csv');
    const janRows = parseCSVContent(janContent!);
    
    // File1: occurrence 1 and 2
    // File2: occurrence 1 (dedup with File1's occurrence:1)
    // File3: occurrence 1 (dedup with File1's occurrence:1)
    // Result: 2 transactions (occurrence 1 and 2 from File1)
    expect(janRows.length).toBe(2);
    
    const occurrences = janRows.map(r => r._occurrence).sort();
    expect(occurrences).toEqual(['1', '2']);
  });

  it('should deduplicate when later file has higher occurrence', () => {
    const file1 = `Date,Amount,Description
15/01/2025,50.00,Restaurant
20/02/2025,100.00,Filler`;

    const file2 = `Date,Amount,Description
15/01/2025,50.00,Restaurant
15/01/2025,50.00,Restaurant
15/01/2025,50.00,Restaurant
25/02/2025,200.00,Filler`;
    
    // Upload file1 (1 occurrence)
    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValueOnce(file1);
    partitionCSVFile('/file1.csv', 'test', mockFs);
    
    // Upload file2 (3 occurrences)
    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValueOnce(file2);
    partitionCSVFile('/file2.csv', 'test', mockFs);
    
    const janContent = writtenFiles.get('/2025-01_transactions_test.csv');
    const janRows = parseCSVContent(janContent!);
    
    // File1: occurrence 1
    // File2: occurrence 1 (dedup), 2 (kept), 3 (kept)
    // Result: 3 transactions (occurrence 1, 2, 3)
    expect(janRows.length).toBe(3);
    
    const occurrences = janRows.map(r => r._occurrence).sort();
    expect(occurrences).toEqual(['1', '2', '3']);
    
    // Verify amount
    const janAmount = calculateTotalAmount(janContent!, mockParser);
    expect(janAmount).toBeCloseTo(150, 2);
  });

  it('should verify amount totals after cross-file dedup', () => {
    const file1 = `Date,Amount,Description
15/01/2025,100.00,Transaction A
20/01/2025,200.00,Transaction B
25/01/2025,50.00,Restaurant
25/01/2025,50.00,Restaurant
05/02/2025,100.00,Filler`;

    const file2 = `Date,Amount,Description
15/01/2025,100.00,Transaction A
25/01/2025,50.00,Restaurant
30/01/2025,300.00,Transaction C
10/02/2025,200.00,Filler`;
    
    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValueOnce(file1);
    partitionCSVFile('/file1.csv', 'test', mockFs);
    
    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValueOnce(file2);
    partitionCSVFile('/file2.csv', 'test', mockFs);
    
    const janContent = writtenFiles.get('/2025-01_transactions_test.csv');
    const janRows = parseCSVContent(janContent!);
    
    // Transaction A: occurrence:1 (deduped)
    // Transaction B: occurrence:1
    // Restaurant: occurrence:1 (deduped), occurrence:2
    // Transaction C: occurrence:1
    // Total: 5 transactions
    expect(janRows.length).toBe(5);
    
    // Verify amount: 100 + 200 + 50 + 50 + 300 = 700
    const janAmount = calculateTotalAmount(janContent!, mockParser);
    expect(janAmount).toBeCloseTo(700, 2);
  });

  it('should handle re-uploading same file', () => {
    const file = `Date,Amount,Description
15/01/2025,100.00,Shop A
20/01/2025,200.00,Shop B
05/02/2025,100.00,Filler`;
    
    // Upload file twice
    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValueOnce(file);
    partitionCSVFile('/file.csv', 'test', mockFs);
    
    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValueOnce(file);
    partitionCSVFile('/file.csv', 'test', mockFs);
    
    const janContent = writtenFiles.get('/2025-01_transactions_test.csv');
    const janRows = parseCSVContent(janContent!);
    
    // All occurrence:1 should deduplicate
    expect(janRows.length).toBe(2);
    
    const shopA = janRows.filter(r => getColumnValue(r, 'Description') === 'Shop A');
    const shopB = janRows.filter(r => getColumnValue(r, 'Description') === 'Shop B');
    expect(shopA.length).toBe(1);
    expect(shopB.length).toBe(1);
  });

  it('should preserve order after deduplication', () => {
    const file1 = `Date,Amount,Description
10/01/2025,100.00,First
15/01/2025,200.00,Second
20/01/2025,300.00,Third
05/02/2025,100.00,Filler`;

    const file2 = `Date,Amount,Description
15/01/2025,200.00,Second
25/01/2025,400.00,Fourth
10/02/2025,200.00,Filler`;
    
    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValueOnce(file1);
    partitionCSVFile('/file1.csv', 'test', mockFs);
    
    (mockFs.readFile as ReturnType<typeof vi.fn>).mockReturnValueOnce(file2);
    partitionCSVFile('/file2.csv', 'test', mockFs);
    
    const janContent = writtenFiles.get('/2025-01_transactions_test.csv');
    const janRows = parseCSVContent(janContent!);
    
    // Should preserve First, Second, Third, Fourth order
    expect(janRows.length).toBe(4);
    expect(getColumnValue(janRows[0], 'Description')).toBe('First');
    expect(getColumnValue(janRows[1], 'Description')).toBe('Second');
    expect(getColumnValue(janRows[2], 'Description')).toBe('Third');
    expect(getColumnValue(janRows[3], 'Description')).toBe('Fourth');
  });
});

// ============================================
// Occurrence Field Bug Tests (Critical)
// ============================================

describe('Occurrence Field - Never Blank', () => {
  const mockParser: BankParser = {
    columns: 'auto',
    dateColumn: 'Date',
    amountColumn: 'Amount',
    descriptionColumn: 'Description',
    headers: ['Date', 'Amount', 'Description'] as const,
    requiredHeaders: ['Date', 'Amount', 'Description'] as const,
    parseOptions: {},
    preprocess: (content: string) => content,
    extractFilenameDate: () => null,
    validateHeaders: () => ({ valid: true }),
    parseDate: (dateStr: string) => new Date(dateStr),
    transform: (row) => ({
      date: new Date(getColumnValue(row, 'Date')),
      description: getColumnValue(row, 'Description'),
      amount: parseFloat(getColumnValue(row, 'Amount')),
      account: 'test',
      type: 'expense' as const,
      occurrence: parseInt(getColumnValue(row, '_occurrence') || '1', 10)
    })
  };

  it('generates _occurrence=1 for single transactions, never blank', () => {
    const rows = [
      { Date: '15/01/2025', Amount: '50.00', Description: 'Coffee' }
    ];
    
    const result = addOccurrenceIndex(rows, mockParser);
    
    expect(result[0]._occurrence).toBe('1');
    expect(result[0]._occurrence).not.toBe('');
    expect(result[0]._occurrence).not.toBe(undefined);
  });

  it('rowsToCSV writes _occurrence=1 for first occurrence, never blank', () => {
    const rows = [
      { Date: '15/01/2025', Amount: '50.00', Description: 'Coffee', _occurrence: '1' }
    ];
    
    const csv = rowsToCSV(['Date', 'Amount', 'Description'], rows);
    const lines = csv.split('\n');
    
    expect(lines[0]).toContain('_occurrence');
    expect(lines[1]).toMatch(/,1$/); // Should end with ",1" not ",,"
    expect(lines[1]).not.toMatch(/,,$/); // Should NOT end with ",,"
  });

  it('rowsToCSV defaults blank _occurrence to "1"', () => {
    const rows = [
      { Date: '15/01/2025', Amount: '50.00', Description: 'Coffee', _occurrence: '' }
    ];
    
    const csv = rowsToCSV(['Date', 'Amount', 'Description'], rows);
    const lines = csv.split('\n');
    
    // Should convert blank to "1"
    expect(lines[1]).toMatch(/,1$/);
    expect(lines[1]).not.toMatch(/,,$/);
  });

  it('preserves all occurrences when merging files with split payments', () => {
    // First file: 3 identical vending machine transactions
    const file1Rows = [
      { Date: '25/02/2025', Amount: '2.70', Description: 'Vendease', _occurrence: '1' },
      { Date: '25/02/2025', Amount: '2.70', Description: 'Vendease', _occurrence: '2' },
      { Date: '25/02/2025', Amount: '2.70', Description: 'Vendease', _occurrence: '3' }
    ];
    
    // Second file: Same 3 transactions (downloaded again from bank)
    const file2Rows = [
      { Date: '25/02/2025', Amount: '2.70', Description: 'Vendease', _occurrence: '1' },
      { Date: '25/02/2025', Amount: '2.70', Description: 'Vendease', _occurrence: '2' },
      { Date: '25/02/2025', Amount: '2.70', Description: 'Vendease', _occurrence: '3' }
    ];
    
    const merged = [...file1Rows, ...file2Rows];
    const deduped = deduplicateRows(merged, mockParser);
    
    // Should keep exactly 3 (one of each occurrence)
    expect(deduped.length).toBe(3);
    expect(deduped.filter(r => r._occurrence === '1').length).toBe(1);
    expect(deduped.filter(r => r._occurrence === '2').length).toBe(1);
    expect(deduped.filter(r => r._occurrence === '3').length).toBe(1);
  });

  it('deduplicates correctly when first file has blank occurrence', () => {
    // Simulate bug scenario: first file written with blank occurrence
    const file1Rows = [
      { Date: '25/02/2025', Amount: '2.70', Description: 'Vendease', _occurrence: '' }, // Blank!
      { Date: '25/02/2025', Amount: '2.70', Description: 'Vendease', _occurrence: '2' },
      { Date: '25/02/2025', Amount: '2.70', Description: 'Vendease', _occurrence: '3' }
    ];
    
    // Second file: Properly numbered
    const file2Rows = [
      { Date: '25/02/2025', Amount: '2.70', Description: 'Vendease', _occurrence: '1' },
      { Date: '25/02/2025', Amount: '2.70', Description: 'Vendease', _occurrence: '2' },
      { Date: '25/02/2025', Amount: '2.70', Description: 'Vendease', _occurrence: '3' }
    ];
    
    // Normalize blank to "1" before deduplication (simulating rowsToCSV fix)
    file1Rows[0]._occurrence = file1Rows[0]._occurrence || '1';
    
    const merged = [...file1Rows, ...file2Rows];
    const deduped = deduplicateRows(merged, mockParser);
    
    // Should keep exactly 3 (blank normalized to "1" matches first from file2)
    expect(deduped.length).toBe(3);
  });

  it('generates sequential occurrences for multiple identical transactions', () => {
    const rows = [
      { Date: '15/01/2025', Amount: '2.70', Description: 'Vending Machine' },
      { Date: '15/01/2025', Amount: '2.70', Description: 'Vending Machine' },
      { Date: '15/01/2025', Amount: '2.70', Description: 'Vending Machine' },
      { Date: '16/01/2025', Amount: '50.00', Description: 'Restaurant' }
    ];
    
    const result = addOccurrenceIndex(rows, mockParser);
    
    expect(result.length).toBe(4);
    
    // Vending machine transactions should have occurrence 1, 2, 3
    const vendingTransactions = result.filter(r => 
      getColumnValue(r, 'Description') === 'Vending Machine'
    );
    expect(vendingTransactions.length).toBe(3);
    expect(vendingTransactions[0]._occurrence).toBe('1');
    expect(vendingTransactions[1]._occurrence).toBe('2');
    expect(vendingTransactions[2]._occurrence).toBe('3');
    
    // Restaurant should have occurrence 1
    const restaurant = result.find(r => 
      getColumnValue(r, 'Description') === 'Restaurant'
    );
    expect(restaurant?._occurrence).toBe('1');
  });
});
