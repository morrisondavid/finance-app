import { describe, it, expect } from 'vitest';
import capitalOnTapParser from '../capital-on-tap.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Capital on Tap Parser', () => {
  describe('parseDate', () => {
    it('parses DD/MM/YYYY format', () => {
      const date = capitalOnTapParser.parseDate('24/12/2025');
      expect(date).toEqual(new Date(2025, 11, 24));
    });

    it('parses single-digit day and month', () => {
      const date = capitalOnTapParser.parseDate('3/2/2025');
      expect(date).toEqual(new Date(2025, 1, 3));
    });

    it('parses YYYY-MM-DD format', () => {
      const date = capitalOnTapParser.parseDate('2025-12-24');
      expect(date).toEqual(new Date(2025, 11, 24));
    });

    it('returns null for invalid date', () => {
      expect(capitalOnTapParser.parseDate('invalid')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(capitalOnTapParser.parseDate('')).toBeNull();
    });
  });

  describe('extractFilenameDate', () => {
    it('extracts start date from CSV range "Transactions 01-01-2025 - 01-01-2026"', () => {
      expect(capitalOnTapParser.extractFilenameDate('Transactions 01-01-2025 - 01-01-2026'))
        .toBe('2025-01-01');
    });

    it('extracts single date from "Transactions 15-06-2025" format', () => {
      expect(capitalOnTapParser.extractFilenameDate('Transactions 15-06-2025'))
        .toBe('2025-06-15');
    });

    it('extracts start date from PDF format with space-only separator', () => {
      expect(capitalOnTapParser.extractFilenameDate('Statement 12-10-2025 11-11-2025'))
        .toBe('2025-10-12');
    });

    it('extracts start date from prefixed PDF format', () => {
      expect(capitalOnTapParser.extractFilenameDate('Capital On Tap - Statement 12-12-2025 11-01-2026'))
        .toBe('2025-12-12');
    });

    it('returns null for unrecognized format', () => {
      expect(capitalOnTapParser.extractFilenameDate('random-filename')).toBeNull();
    });
  });

  describe('validateHeaders', () => {
    it('validates correct headers', () => {
      const headers = ['Clearance Date', 'Authorisation Date', 'Description', 'Amount', 
                       'Original Amount', 'Original Currency', 'Merchant Name'];
      expect(capitalOnTapParser.validateHeaders(headers)).toEqual({ valid: true });
    });

    it('validates headers case-insensitively', () => {
      const headers = ['CLEARANCE DATE', 'authorisation date', 'DESCRIPTION', 'amount'];
      expect(capitalOnTapParser.validateHeaders(headers)).toEqual({ valid: true });
    });

    it('rejects missing Clearance Date column', () => {
      const headers = ['Authorisation Date', 'Description', 'Amount'];
      const result = capitalOnTapParser.validateHeaders(headers);
      expect(result.valid).toBe(false);
      expect(result.errors![0]).toContain('Clearance Date');
    });

    it('rejects missing Amount column', () => {
      const headers = ['Clearance Date', 'Description'];
      const result = capitalOnTapParser.validateHeaders(headers);
      expect(result.valid).toBe(false);
    });
  });

  describe('transform', () => {
    it('transforms row correctly (inverts amount for credit card)', () => {
      const row = {
        'Clearance Date': '24/12/2025',
        'Description': 'Test Purchase',
        'Amount': '105.00',
        'Merchant Name': 'Test Merchant'
      };
      
      const result = capitalOnTapParser.transform(row, 'capital-on-tap');
      
      expect(result).not.toBeNull();
      expect(result!.amount).toBe(-105);  // Inverted for credit card
      expect(result!.type).toBe('expense');
    });

    it('transforms payment correctly', () => {
      const row = {
        'Clearance Date': '02/12/2025',
        'Description': 'Payment made',
        'Amount': '-100.00'
      };
      
      const result = capitalOnTapParser.transform(row, 'capital-on-tap');
      
      expect(result).not.toBeNull();
      expect(result!.amount).toBe(100);  // Inverted: negative payment becomes positive
      expect(result!.type).toBe('income');
    });
  });

  describe('integration with fixture', () => {
    it('parses fixture file correctly', () => {
      const fixturePath = path.join(__dirname, 'fixtures', 'capital-on-tap-sample.csv');
      const content = fs.readFileSync(fixturePath, 'utf-8');
      const preprocessed = capitalOnTapParser.preprocess(content);
      
      // Check that preprocessing worked
      expect(preprocessed).toContain('Clearance Date');
      
      // Validate headers from first line
      const firstLine = preprocessed.split('\n')[0];
      const headers = firstLine.split(',');
      const validation = capitalOnTapParser.validateHeaders(headers);
      expect(validation.valid).toBe(true);
    });
  });
});
