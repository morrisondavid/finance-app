import { describe, it, expect } from 'vitest';
import {
  normalizeFilename,
  isNormalized,
  cleanJunk,
  getExtension,
  removeExtension,
  generateUniqueFilename,
} from '../filename-normalizer.js';
import type { BankParser, CSVRow, ValidationResult } from '../../types.js';

// Mock parser for testing
const mockParser: BankParser = {
  columns: 'auto',
  dateColumn: 'Date',
  amountColumn: 'Amount',
  descriptionColumn: 'Description',
  headers: ['Date', 'Amount'] as const,
  requiredHeaders: ['Date', 'Amount'] as const,
  parseOptions: {},
  
  preprocess(content: string): string {
    return content;
  },
  
  parseDate(_dateStr: string): Date | null {
    return null;
  },
  
  extractFilenameDate(filename: string): string | null {
    // Mock: extract from "Statement 27-DEC-24" format
    const match = filename.match(/(\d{1,2})-([A-Za-z]{3})-(\d{2})/);
    if (match) {
      const months: Record<string, string> = {
        'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04',
        'may': '05', 'jun': '06', 'jul': '07', 'aug': '08',
        'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12'
      };
      const day = match[1].padStart(2, '0');
      const month = months[match[2].toLowerCase()];
      const year = parseInt(match[3]) <= 50 ? `20${match[3]}` : `19${match[3]}`;
      return `${year}-${month}-${day}`;
    }
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
  describe('isNormalized', () => {
    it('returns true for new PDF format with account', () => {
      expect(isNormalized('2024-12_statement_barclays-current.pdf')).toBe(true);
      expect(isNormalized('2024-12_statement_natwest.pdf')).toBe(true);
      expect(isNormalized('2024-12_statement_capital-on-tap.pdf')).toBe(true);
    });

    it('returns true for new CSV format with account', () => {
      expect(isNormalized('2024-12_transactions_barclays-current.csv')).toBe(true);
      expect(isNormalized('2024-12_transactions_natwest.csv')).toBe(true);
      expect(isNormalized('2024-12_transactions_capital-on-tap.csv')).toBe(true);
    });

    it('returns true for old format (backward compatibility)', () => {
      expect(isNormalized('2024-12_statement.csv')).toBe(true);
      expect(isNormalized('2024-12_statement.pdf')).toBe(true);
      expect(isNormalized('2024-12_transactions.csv')).toBe(true);
    });

    it('returns false for non-normalized filenames', () => {
      expect(isNormalized('Statement 27-DEC-24.csv')).toBe(false);
      expect(isNormalized('random-file.csv')).toBe(false);
      expect(isNormalized('2024-12.csv')).toBe(false);
    });

    it('is case-insensitive for extension', () => {
      expect(isNormalized('2024-12_statement_barclays.CSV')).toBe(true);
      expect(isNormalized('2024-12_transactions_natwest.PDF')).toBe(true);
    });
  });

  describe('cleanJunk', () => {
    it('removes (1) from filename', () => {
      expect(cleanJunk('Statement 27-DEC-24 (1)')).toBe('Statement 27-DEC-24');
    });

    it('removes (copy) from filename', () => {
      expect(cleanJunk('Statement 27-DEC-24 (copy)')).toBe('Statement 27-DEC-24');
    });

    it('removes [1] from filename', () => {
      expect(cleanJunk('Statement 27-DEC-24 [1]')).toBe('Statement 27-DEC-24');
    });

    it('removes multiple junk', () => {
      expect(cleanJunk('Statement 27-DEC-24 (1) [copy]')).toBe('Statement 27-DEC-24');
    });

    it('normalizes whitespace', () => {
      expect(cleanJunk('Statement   27-DEC-24')).toBe('Statement 27-DEC-24');
    });

    it('trims leading/trailing whitespace', () => {
      expect(cleanJunk('  Statement 27-DEC-24  ')).toBe('Statement 27-DEC-24');
    });
  });

  describe('getExtension', () => {
    it('returns extension including dot', () => {
      expect(getExtension('file.csv')).toBe('.csv');
      expect(getExtension('file.pdf')).toBe('.pdf');
    });

    it('returns lowercase extension', () => {
      expect(getExtension('file.CSV')).toBe('.csv');
      expect(getExtension('file.PDF')).toBe('.pdf');
    });

    it('returns last extension for multiple dots', () => {
      expect(getExtension('file.name.csv')).toBe('.csv');
    });

    it('returns empty string for no extension', () => {
      expect(getExtension('filename')).toBe('');
    });
  });

  describe('removeExtension', () => {
    it('removes extension from filename', () => {
      expect(removeExtension('file.csv')).toBe('file');
      expect(removeExtension('file.pdf')).toBe('file');
    });

    it('handles multiple dots', () => {
      expect(removeExtension('file.name.csv')).toBe('file.name');
    });

    it('returns unchanged if no extension', () => {
      expect(removeExtension('filename')).toBe('filename');
    });
  });

  describe('generateUniqueFilename', () => {
    it('returns original if no conflict', () => {
      const existing = new Set<string>();
      expect(generateUniqueFilename('2024-12_statement', '.csv', existing))
        .toBe('2024-12_statement.csv');
    });

    it('adds _2 for first conflict', () => {
      const existing = new Set(['2024-12_statement.csv']);
      expect(generateUniqueFilename('2024-12_statement', '.csv', existing))
        .toBe('2024-12_statement_2.csv');
    });

    it('increments counter for multiple conflicts', () => {
      const existing = new Set([
        '2024-12_statement.csv',
        '2024-12_statement_2.csv',
        '2024-12_statement_3.csv'
      ]);
      expect(generateUniqueFilename('2024-12_statement', '.csv', existing))
        .toBe('2024-12_statement_4.csv');
    });
  });

  describe('normalizeFilename', () => {
    it('normalizes CSV to transactions format with account', () => {
      const result = normalizeFilename('Statement 27-DEC-24 AC 63648923.csv', mockParser, 'barclays-current');
      expect(result).toBe('2024-12_transactions_barclays-current.csv');
    });

    it('normalizes PDF to statement format with account', () => {
      const result = normalizeFilename('Statement 27-DEC-24.pdf', mockParser, 'natwest');
      expect(result).toBe('2024-12_statement_natwest.pdf');
    });

    it('returns unchanged if already normalized', () => {
      const result = normalizeFilename('2024-12_transactions_barclays-current.csv', mockParser, 'barclays-current');
      expect(result).toBe('2024-12_transactions_barclays-current.csv');
    });

    it('cleans junk from filename', () => {
      const result = normalizeFilename('Statement 27-DEC-24 (1).csv', mockParser, 'natwest');
      expect(result).toBe('2024-12_transactions_natwest.csv');
    });

    it('returns unchanged if cannot extract date', () => {
      const result = normalizeFilename('random-file.csv', mockParser, 'barclays-current');
      expect(result).toBe('random-file.csv');
    });

    it('handles different months with CSV', () => {
      expect(normalizeFilename('Statement 15-JAN-25.csv', mockParser, 'natwest')).toBe('2025-01_transactions_natwest.csv');
      expect(normalizeFilename('Statement 15-FEB-25.csv', mockParser, 'natwest')).toBe('2025-02_transactions_natwest.csv');
      expect(normalizeFilename('Statement 15-MAR-25.csv', mockParser, 'natwest')).toBe('2025-03_transactions_natwest.csv');
    });

    it('handles different months with PDF', () => {
      expect(normalizeFilename('Statement 15-JAN-25.pdf', mockParser, 'barclaycard')).toBe('2025-01_statement_barclaycard.pdf');
      expect(normalizeFilename('Statement 15-FEB-25.pdf', mockParser, 'barclaycard')).toBe('2025-02_statement_barclaycard.pdf');
    });

    it('handles different account names', () => {
      expect(normalizeFilename('Statement 27-DEC-24.csv', mockParser, 'barclays-current')).toBe('2024-12_transactions_barclays-current.csv');
      expect(normalizeFilename('Statement 27-DEC-24.csv', mockParser, 'capital-on-tap')).toBe('2024-12_transactions_capital-on-tap.csv');
      expect(normalizeFilename('Statement 27-DEC-24.pdf', mockParser, 'natwest')).toBe('2024-12_statement_natwest.pdf');
    });
  });
});
