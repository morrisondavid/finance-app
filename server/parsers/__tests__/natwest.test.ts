import { describe, it, expect } from 'vitest';
import natwestParser from '../natwest.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('NatWest Parser', () => {
  describe('parseDate', () => {
    it('parses "DD Mon YYYY" format', () => {
      const date = natwestParser.parseDate('30 Dec 2024');
      expect(date).toEqual(new Date(2024, 11, 30));
    });

    it('parses single-digit day', () => {
      const date = natwestParser.parseDate('5 Jan 2025');
      expect(date).toEqual(new Date(2025, 0, 5));
    });

    it('handles different months', () => {
      expect(natwestParser.parseDate('15 Jan 2025')).toEqual(new Date(2025, 0, 15));
      expect(natwestParser.parseDate('15 Feb 2025')).toEqual(new Date(2025, 1, 15));
      expect(natwestParser.parseDate('15 Mar 2025')).toEqual(new Date(2025, 2, 15));
      expect(natwestParser.parseDate('15 Apr 2025')).toEqual(new Date(2025, 3, 15));
      expect(natwestParser.parseDate('15 May 2025')).toEqual(new Date(2025, 4, 15));
      expect(natwestParser.parseDate('15 Jun 2025')).toEqual(new Date(2025, 5, 15));
      expect(natwestParser.parseDate('15 Jul 2025')).toEqual(new Date(2025, 6, 15));
      expect(natwestParser.parseDate('15 Aug 2025')).toEqual(new Date(2025, 7, 15));
      expect(natwestParser.parseDate('15 Sep 2025')).toEqual(new Date(2025, 8, 15));
      expect(natwestParser.parseDate('15 Oct 2025')).toEqual(new Date(2025, 9, 15));
      expect(natwestParser.parseDate('15 Nov 2025')).toEqual(new Date(2025, 10, 15));
      expect(natwestParser.parseDate('15 Dec 2025')).toEqual(new Date(2025, 11, 15));
    });

    it('is case-insensitive for month names', () => {
      expect(natwestParser.parseDate('15 JAN 2025')).toEqual(new Date(2025, 0, 15));
      expect(natwestParser.parseDate('15 jan 2025')).toEqual(new Date(2025, 0, 15));
    });

    it('parses DD/MM/YYYY format', () => {
      const date = natwestParser.parseDate('30/12/2024');
      expect(date).toEqual(new Date(2024, 11, 30));
    });

    it('returns null for invalid date', () => {
      expect(natwestParser.parseDate('invalid')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(natwestParser.parseDate('')).toBeNull();
    });
  });

  describe('extractFilenameDate', () => {
    it('extracts from "MORRISONDD73193380-20260123" format', () => {
      expect(natwestParser.extractFilenameDate('MORRISONDD73193380-20260123'))
        .toBe('2026-01-23');
    });

    it('extracts date from end of filename', () => {
      expect(natwestParser.extractFilenameDate('SomePrefix20251231'))
        .toBe('2025-12-31');
    });

    it('extracts end date from NatWest PDF format with account number', () => {
      expect(natwestParser.extractFilenameDate('Statement--602308-73193380--10-12-2024-09-01-2025'))
        .toBe('2025-01-09');
    });

    it('extracts end date from NatWest PDF format with different account', () => {
      expect(natwestParser.extractFilenameDate('Statement--504237-67216358--08-10-2025-07-11-2025'))
        .toBe('2025-11-07');
    });

    it('extracts end date from NatWest PDF with prefix', () => {
      expect(natwestParser.extractFilenameDate('Natwest Statement--602308-73193380--10-12-2024-09-01-2025'))
        .toBe('2025-01-09');
    });

    it('returns null for unrecognized format', () => {
      expect(natwestParser.extractFilenameDate('random-filename')).toBeNull();
    });
  });

  describe('validateHeaders', () => {
    it('validates correct headers', () => {
      const headers = ['Date', 'Type', 'Description', 'Value', 'Balance', 'Account Name', 'Account Number'];
      expect(natwestParser.validateHeaders(headers)).toEqual({ valid: true });
    });

    it('validates headers case-insensitively', () => {
      const headers = ['DATE', 'TYPE', 'DESCRIPTION', 'VALUE', 'BALANCE'];
      expect(natwestParser.validateHeaders(headers)).toEqual({ valid: true });
    });

    it('rejects missing Date column', () => {
      const headers = ['Type', 'Description', 'Value'];
      const result = natwestParser.validateHeaders(headers);
      expect(result.valid).toBe(false);
      expect(result.errors![0]).toContain('Date');
    });

    it('rejects missing Value column', () => {
      const headers = ['Date', 'Type', 'Description'];
      const result = natwestParser.validateHeaders(headers);
      expect(result.valid).toBe(false);
    });
  });

  describe('transform', () => {
    it('transforms row with Value column', () => {
      const row = {
        'Date': '30 Dec 2024',
        'Type': 'D/D',
        'Description': 'UTILITY COMPANY',
        'Value': '-6.21',
        'Balance': '21.71'
      };
      
      const result = natwestParser.transform(row, 'natwest');
      
      expect(result).not.toBeNull();
      expect(result!.amount).toBe(-6.21);
      expect(result!.description).toBe('UTILITY COMPANY');
      expect(result!.account).toBe('natwest');
      expect(result!.type).toBe('expense');
    });

    it('transforms income correctly', () => {
      const row = {
        'Date': '24 Dec 2024',
        'Type': 'BAC',
        'Description': 'TRANSFER IN',
        'Value': '100.00'
      };
      
      const result = natwestParser.transform(row, 'natwest');
      
      expect(result).not.toBeNull();
      expect(result!.amount).toBe(100);
      expect(result!.type).toBe('income');
    });
  });

  describe('integration with fixture', () => {
    it('parses fixture file correctly', () => {
      const fixturePath = path.join(__dirname, 'fixtures', 'natwest-sample.csv');
      const content = fs.readFileSync(fixturePath, 'utf-8');
      const preprocessed = natwestParser.preprocess(content);
      
      // Check that preprocessing worked
      expect(preprocessed).toContain('Date,Type');
      
      // Validate headers from first line
      const firstLine = preprocessed.split('\n')[0];
      const headers = firstLine.split(',');
      const validation = natwestParser.validateHeaders(headers);
      expect(validation.valid).toBe(true);
    });
  });
});
