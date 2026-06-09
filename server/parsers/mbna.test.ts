import { describe, it, expect } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import mbnaParser from './mbna.js';
import { parseCSVFile } from './index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SAMPLE_FIXTURE = path.join(__dirname, 'fixtures/mbna-export-sample.csv');

describe('mbna parser', () => {
  describe('validateHeaders', () => {
    it('accepts official MBNA export headers', () => {
      expect(
        mbnaParser.validateHeaders([
          'Transaction Date',
          'Transaction Cleared Date',
          'Transaction Type',
          'Transaction Description',
          'Transaction Amount',
        ]),
      ).toEqual({ valid: true });
    });

    it('rejects when Transaction Amount is missing', () => {
      const result = mbnaParser.validateHeaders(['Transaction Date', 'Transaction Description']);
      expect(result.valid).toBe(false);
      expect(result.errors?.[0]).toMatch(/Transaction Amount/);
    });
  });

  describe('extractFilenameDate', () => {
    it('parses cardSuffix_DDMMYYYY export filenames', () => {
      expect(mbnaParser.extractFilenameDate('6819_17122025.csv')).toBe('2025-12-17');
    });

    it('parses normalized monthly filenames', () => {
      expect(mbnaParser.extractFilenameDate('2025-12_transactions_mbna.csv')).toBe('2025-12-01');
    });
  });

  describe('transform', () => {
    it('maps interest charges as positive expenses', () => {
      const txn = mbnaParser.transform(
        {
          'Transaction Date': '17/12/2025',
          'Transaction Description': 'INTEREST',
          'Transaction Amount': '5.79',
        },
        'mbna',
      );
      expect(txn).toMatchObject({
        description: 'INTEREST',
        amount: 5.79,
        account: 'mbna',
        type: 'expense',
      });
      expect(txn?.date).toEqual(new Date(2025, 11, 17));
    });

    it('maps direct debit payments as negative income', () => {
      const txn = mbnaParser.transform(
        {
          'Transaction Date': '12/12/2025',
          'Transaction Description': 'DIRECT DEBIT PAYMENT -',
          'Transaction Amount': '-25',
        },
        'mbna',
      );
      expect(txn).toMatchObject({
        description: 'DIRECT DEBIT PAYMENT -',
        amount: -25,
        type: 'income',
      });
    });
  });

  describe('parseCSVFile integration', () => {
    it('parses the official export fixture (amounts inverted for credit-card balance)', async () => {
      const rows = await parseCSVFile(SAMPLE_FIXTURE, 'mbna');
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        description: 'INTEREST',
        amount: -5.79,
        account: 'mbna',
        type: 'expense',
      });
      expect(rows[1]).toMatchObject({
        description: 'DIRECT DEBIT PAYMENT -',
        amount: 25,
        type: 'income',
      });
    });

  });
});
