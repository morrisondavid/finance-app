import { describe, it, expect } from 'vitest';
import barclaycardParser from './barclaycard.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeFilename, normalizeFileOnDisk } from '../utils/filename-normalizer.js';

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
    const portalPdfCases: { filename: string; expected: string }[] = [
      { filename: 'Statement12May25XXXX6719.PDF', expected: '2025-05-12' },
      { filename: 'Statement12Jun25XXXX6719.PDF', expected: '2025-06-12' },
      { filename: 'Statement12Jul25XXXX6719.PDF', expected: '2025-07-12' },
      { filename: 'Statement12Aug25XXXX6719.PDF', expected: '2025-08-12' },
      { filename: 'Statement12Sep25XXXX6719.PDF', expected: '2025-09-12' },
      { filename: 'Statement12Oct25XXXX6719.PDF', expected: '2025-10-12' },
      { filename: 'Statement12Nov25XXXX6719.PDF', expected: '2025-11-12' },
      { filename: 'Statement12Dec25XXXX6719.PDF', expected: '2025-12-12' },
      { filename: 'Statement12Jan26XXXX6719.PDF', expected: '2026-01-12' },
      { filename: 'Statement12Feb26XXXX6719.PDF', expected: '2026-02-12' },
      { filename: 'Statement12Mar26XXXX6719.PDF', expected: '2026-03-12' },
      { filename: 'Statement12Apr26XXXX6719.PDF', expected: '2026-04-12' },
      { filename: 'Statement12May26XXXX6719.PDF', expected: '2026-05-12' },
    ];

    it.each(portalPdfCases)(
      'parses portal PDF $filename → $expected',
      ({ filename, expected }) => {
        expect(barclaycardParser.extractFilenameDate(filename)).toBe(expected);
      },
    );

    it('does not treat card suffix 6719 as the statement year', () => {
      const iso = barclaycardParser.extractFilenameDate('Statement12May25XXXX6719.PDF');
      expect(iso).not.toBe('6719-12-31');
      expect(iso?.startsWith('6719')).toBe(false);
      expect(normalizeFilename('Statement12May25XXXX6719.PDF', barclaycardParser, 'barclaycard')).toBe(
        '2025-05_statement_barclaycard.pdf',
      );
    });

    it('extracts year from "Barclaycard 2024" annual CSV export', () => {
      expect(barclaycardParser.extractFilenameDate('Barclaycard 2024')).toBe('2024-12-31');
    });

    it('extracts year from Statement_2025_export style filenames', () => {
      expect(barclaycardParser.extractFilenameDate('Statement_2025_export')).toBe('2025-12-31');
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

    it('accepts newer portal headers with Transaction Amount', () => {
      const headers = [
        'Card Holder Name',
        'Account Number',
        'Transaction Date',
        'Merchant Name',
        'Transaction Amount',
        'Currency',
      ];
      expect(barclaycardParser.validateHeaders(headers)).toEqual({ valid: true });
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
      expect(result!.amount).toBe(84.95);  // Raw CSV amount; credit card inversion happens in parsers/index.ts
      expect(result!.description).toBe('PURCHASE FINANCE CHARGE');
      expect(result!.account).toBe('barclaycard');
      expect(result!.type).toBe('expense');
    });

    it('transforms payment correctly', () => {
      const row = {
        'Transaction Date': '09/12/2024',
        'Merchant Name': 'DIRECT DEBIT PAYMENT',
        'Amount': '-86.13'
      };
      
      const result = barclaycardParser.transform(row, 'barclaycard');
      
      expect(result).not.toBeNull();
      expect(result!.amount).toBe(-86.13);  // Raw CSV amount; inversion is central
      expect(result!.type).toBe('income');
    });

    it('reads Transaction Amount from newer portal exports', () => {
      const row = {
        'Card Holder Name': 'AUTONIZE IT LIMITED',
        'Account Number': '****6719',
        'Transaction Date': '12/08/2026',
        'Merchant Name': 'CASH BACK REBATE',
        'Transaction Amount': '-24.0',
        Currency: 'GBP',
      };

      const result = barclaycardParser.transform(row, 'barclaycard');

      expect(result).not.toBeNull();
      expect(result!.amount).toBe(-24);
      expect(result!.description).toBe('CASH BACK REBATE');
      expect(result!.type).toBe('income');
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

  describe('portal PDF fixtures on disk', () => {
    it('normalises copied portal PDF fixture to YYYY-MM_statement_barclaycard.pdf', () => {
      const fixtureSrc = path.join(__dirname, 'fixtures', 'barclaycard-statement-2025-05.pdf');
      const workDir = fs.mkdtempSync(path.join(path.dirname(fixtureSrc), 'barclaycard-pdf-test-'));
      const incoming = path.join(workDir, 'Statement12May25XXXX6719.PDF');
      fs.copyFileSync(fixtureSrc, incoming);

      try {
        const result = normalizeFileOnDisk(incoming, 'barclaycard');
        expect(result.normalized).toBe('2025-05_statement_barclaycard.pdf');
        expect(fs.existsSync(path.join(workDir, '2025-05_statement_barclaycard.pdf'))).toBe(true);
      } finally {
        fs.rmSync(workDir, { recursive: true, force: true });
      }
    });
  });

  describe('integration with fixture', () => {
    it('parses newer Recent-DD-MM-YYYY portal export headers', () => {
      const fixturePath = path.join(__dirname, 'fixtures', 'barclaycard-recent-export-sample.csv');
      const content = fs.readFileSync(fixturePath, 'utf-8');
      const preprocessed = barclaycardParser.preprocess(content);
      const headers = preprocessed.split('\n')[0].split(',');
      expect(barclaycardParser.validateHeaders(headers)).toEqual({ valid: true });

      const rebate = barclaycardParser.transform(
        {
          'Transaction Date': '12/08/2026',
          'Merchant Name': 'CASH BACK REBATE',
          'Transaction Amount': '-24.0',
        },
        'barclaycard',
      );
      expect(rebate?.amount).toBe(-24);
    });

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
