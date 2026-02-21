import { describe, it, expect } from 'vitest';
import barclaycardParser from '../barclaycard.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Barclaycard Parser', () => {
  describe('parseDate', () => {
    it('parses DD/MM/YYYY format', () => {
      const date = barclaycardParser.parseDate('12/12/2024');
      expect(date).toEqual(new Date(2024, 11, 12));
    });

    it('parses single-digit day and month', () => {
      const date = barclaycardParser.parseDate('3/2/2025');
      expect(date).toEqual(new Date(2025, 1, 3));
    });

    it('parses YYYY-MM-DD format', () => {
      const date = barclaycardParser.parseDate('2024-12-12');
      expect(date).toEqual(new Date(2024, 11, 12));
    });

    it('parses DD-MM-YYYY format', () => {
      const date = barclaycardParser.parseDate('12-12-2024');
      expect(date).toEqual(new Date(2024, 11, 12));
    });

    it('returns null for invalid date', () => {
      expect(barclaycardParser.parseDate('invalid')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(barclaycardParser.parseDate('')).toBeNull();
    });
  });

  describe('extractFilenameDate', () => {
    it('extracts year from "Barclaycard 2024" format', () => {
      expect(barclaycardParser.extractFilenameDate('Barclaycard 2024'))
        .toBe('2024-12-31');  // Defaults to end of year
    });

    it('extracts year from filename with other text', () => {
      expect(barclaycardParser.extractFilenameDate('Statement_2025_export'))
        .toBe('2025-12-31');
    });

    it('returns null for filename without year', () => {
      expect(barclaycardParser.extractFilenameDate('random-filename')).toBeNull();
    });
  });

  describe('validateHeaders', () => {
    it('validates correct headers', () => {
      const headers = ['Cardholder Name', 'Account Number', 'Transaction Date', 
                       'Merchant Name', 'Amount', 'Currency'];
      expect(barclaycardParser.validateHeaders(headers)).toEqual({ valid: true });
    });

    it('validates headers case-insensitively', () => {
      const headers = ['TRANSACTION DATE', 'amount', 'Merchant Name'];
      expect(barclaycardParser.validateHeaders(headers)).toEqual({ valid: true });
    });

    it('rejects missing Transaction Date column', () => {
      const headers = ['Merchant Name', 'Amount'];
      const result = barclaycardParser.validateHeaders(headers);
      expect(result.valid).toBe(false);
      expect(result.errors![0]).toContain('Transaction Date');
    });

    it('rejects missing Amount column', () => {
      const headers = ['Transaction Date', 'Merchant Name'];
      const result = barclaycardParser.validateHeaders(headers);
      expect(result.valid).toBe(false);
    });
  });

  describe('transform', () => {
    it('transforms purchase row correctly', () => {
      const row = {
        'Cardholder Name': 'COMPANY LTD',
        'Account Number': '****6719',
        'Transaction Date': '12/12/2024',
        'Merchant Name': 'PURCHASE FINANCE CHARGE',
        'Amount': '84.95',
        'Currency': 'GBP'
      };
      
      const result = barclaycardParser.transform(row, 'barclaycard');
      
      expect(result).not.toBeNull();
      expect(result!.amount).toBe(84.95);
      expect(result!.description).toBe('PURCHASE FINANCE CHARGE');
      expect(result!.account).toBe('barclaycard');
      expect(result!.type).toBe('expense');  // Positive amount = expense for credit card
    });

    it('transforms payment correctly', () => {
      const row = {
        'Transaction Date': '09/12/2024',
        'Merchant Name': 'DIRECT DEBIT PAYMENT',
        'Amount': '-86.13'
      };
      
      const result = barclaycardParser.transform(row, 'barclaycard');
      
      expect(result).not.toBeNull();
      expect(result!.amount).toBe(-86.13);
      expect(result!.type).toBe('income');  // Negative amount = income (payment received)
    });

    it('returns null for row without valid date', () => {
      const row = {
        'Transaction Date': 'invalid',
        'Amount': '100.00'
      };
      
      const result = barclaycardParser.transform(row, 'barclaycard');
      expect(result).toBeNull();
    });
  });

  describe('integration with fixture', () => {
    it('parses fixture file correctly', () => {
      const fixturePath = path.join(__dirname, 'fixtures', 'barclaycard-sample.csv');
      const content = fs.readFileSync(fixturePath, 'utf-8');
      const preprocessed = barclaycardParser.preprocess(content);
      
      // Check that preprocessing worked
      expect(preprocessed).toContain('Cardholder Name');
      
      // Validate headers from first line
      const firstLine = preprocessed.split('\n')[0];
      const headers = firstLine.split(',');
      const validation = barclaycardParser.validateHeaders(headers);
      expect(validation.valid).toBe(true);
    });
  });
});
