import { describe, it, expect } from 'vitest';
import barclaysParser from './barclays.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Barclays Parser', () => {
  describe('parseDate', () => {
    it('parses DD/MM/YYYY format', () => {
      const date = barclaysParser.parseDate('23/01/2026');
      expect(date).toEqual(new Date(2026, 0, 23));
    });

    it('parses single-digit day and month', () => {
      const date = barclaysParser.parseDate('3/2/2025');
      expect(date).toEqual(new Date(2025, 1, 3));
    });

    it('parses YYYY-MM-DD format', () => {
      const date = barclaysParser.parseDate('2025-01-15');
      expect(date).toEqual(new Date(2025, 0, 15));
    });

    it('returns null for invalid date', () => {
      expect(barclaysParser.parseDate('invalid')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(barclaysParser.parseDate('')).toBeNull();
    });
  });

  describe('extractFilenameDate', () => {
    it('extracts from "Statement 27-DEC-24" format', () => {
      expect(barclaysParser.extractFilenameDate('Statement 27-DEC-24 AC 63648923'))
        .toBe('2024-12-27');
    });

    it('extracts from lowercase month', () => {
      expect(barclaysParser.extractFilenameDate('Statement 15-jan-25'))
        .toBe('2025-01-15');
    });

    it('extracts from 4-digit year', () => {
      expect(barclaysParser.extractFilenameDate('Statement 01-MAR-2025'))
        .toBe('2025-03-01');
    });

    it('extracts from full PDF filename with account and reference numbers', () => {
      expect(barclaysParser.extractFilenameDate('Statement 27-DEC-24 AC 63648923 29060329'))
        .toBe('2024-12-27');
    });

    it('extracts from savings account PDF filename', () => {
      expect(barclaysParser.extractFilenameDate('Statement 29-NOV-24 AC 60878820 01181313'))
        .toBe('2024-11-29');
    });

    it('returns null for unrecognized format', () => {
      expect(barclaysParser.extractFilenameDate('random-filename')).toBeNull();
    });
  });

  describe('validateHeaders', () => {
    it('validates correct headers', () => {
      const headers = ['Number', 'Date', 'Account', 'Amount', 'Subcategory', 'Memo'];
      expect(barclaysParser.validateHeaders(headers)).toEqual({ valid: true });
    });

    it('validates headers case-insensitively', () => {
      const headers = ['NUMBER', 'DATE', 'ACCOUNT', 'AMOUNT', 'SUBCATEGORY', 'MEMO'];
      expect(barclaysParser.validateHeaders(headers)).toEqual({ valid: true });
    });

    it('validates with mixed case', () => {
      const headers = ['number', 'Date', 'ACCOUNT', 'Amount', 'subcategory', 'Memo'];
      expect(barclaysParser.validateHeaders(headers)).toEqual({ valid: true });
    });

    it('rejects missing Date column', () => {
      const headers = ['Number', 'Account', 'Amount'];
      const result = barclaysParser.validateHeaders(headers);
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors![0]).toContain('Date');
    });

    it('rejects missing Amount column', () => {
      const headers = ['Number', 'Date', 'Account'];
      const result = barclaysParser.validateHeaders(headers);
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors![0]).toContain('Amount');
    });
  });

  describe('preprocess', () => {
    it('removes leading tabs from lines', () => {
      const input = '\t0,22/01/2026,20-25-19,-3.06,Debit,GITHUB';
      const result = barclaysParser.preprocess(input);
      expect(result).toBe('0,22/01/2026,20-25-19,-3.06,Debit,GITHUB');
    });

    it('removes multiple leading tabs', () => {
      const input = '\t\t\t0,22/01/2026,20-25-19,-3.06,Debit,GITHUB';
      const result = barclaysParser.preprocess(input);
      expect(result).toBe('0,22/01/2026,20-25-19,-3.06,Debit,GITHUB');
    });

    it('preserves tabs within fields', () => {
      const input = '0,22/01/2026,20-25-19,-3.06,Debit,GITHUB\tUSA';
      const result = barclaysParser.preprocess(input);
      expect(result).toBe('0,22/01/2026,20-25-19,-3.06,Debit,GITHUB\tUSA');
    });

    it('finds header row when metadata lines present', () => {
      const input = 'Bank Statement\nAccount Info\nNumber,Date,Account,Amount,Subcategory,Memo\n0,01/01/2025,123,-10,Debit,Test';
      const result = barclaysParser.preprocess(input);
      expect(result.startsWith('Number,Date')).toBe(true);
    });
  });

  describe('transform', () => {
    it('transforms row with Amount column', () => {
      const row = {
        'Number': '0',
        'Date': '21/01/2026',
        'Account': '20-25-19',
        'Amount': '-500.00',
        'Subcategory': 'Funds Transfer',
        'Memo': 'DAVID MORRISON'
      };
      
      const result = barclaysParser.transform(row, 'barclays-current');
      
      expect(result).not.toBeNull();
      expect(result!.amount).toBe(-500);
      expect(result!.description).toBe('DAVID MORRISON');
      expect(result!.account).toBe('barclays-current');
      expect(result!.type).toBe('expense');
    });

    it('transforms income correctly', () => {
      const row = {
        'Date': '21/01/2026',
        'Amount': '12000.00',
        'Memo': 'LA FOSSE LTD'
      };
      
      const result = barclaysParser.transform(row, 'barclays-current');
      
      expect(result).not.toBeNull();
      expect(result!.amount).toBe(12000);
      expect(result!.type).toBe('income');
    });

    it('returns null for row without valid date', () => {
      const row = {
        'Date': 'invalid',
        'Amount': '100.00'
      };
      
      const result = barclaysParser.transform(row, 'barclays-current');
      expect(result).toBeNull();
    });
  });

  describe('integration with fixture', () => {
    it('parses fixture file correctly', () => {
      const fixturePath = path.join(__dirname, 'fixtures', 'barclays-sample.csv');
      const content = fs.readFileSync(fixturePath, 'utf-8');
      const preprocessed = barclaysParser.preprocess(content);
      
      // Check that preprocessing worked
      expect(preprocessed).toContain('Number,Date');
      
      // Validate headers from first line
      const firstLine = preprocessed.split('\n')[0];
      const headers = firstLine.split(',');
      const validation = barclaysParser.validateHeaders(headers);
      expect(validation.valid).toBe(true);
    });
  });
});
