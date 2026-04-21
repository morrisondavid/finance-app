import { describe, it, expect } from 'vitest';
import santanderEverydayParser from './santander-everyday.js';

const SAMPLE_CSV = `Date,Card,Description,Amount
2025-03-20,** 3062,BALANCE TRANSFER MERCH,7230.00
2025-03-25,** 3062,PURCHASE - DOMESTIC SHELL ROMFORD,16.69
2025-05-02,** 3062,DD PAYMENT RECEIVED D/DEBIT,-77.56
`;

const SAMPLE_HTML = [
  '<!DOCTYPE html><html><body><table>',
  '<tr><td /><td style="TDSeparadorDoble">Transactions</td></tr>',
  '<tr><td /><td><font>XXXX XXXX XXXX 3062</font></td><td /><td><font>20/03/2025 To 03/05/2025</font></td></tr>',
  '<tr><td /><td>Date</td><td /><td>Card</td><td /><td>Description</td><td /><td>Money in</td><td /><td>Money Out</td></tr>',
  '<tr>',
  '<td />',
  '<td><font>2025-03-20</font></td>',
  '<td />',
  '<td><font>** 3062</font></td>',
  '<td />',
  '<td><font>BALANCE TRANSFER     MERCH</font></td>',
  '<td />',
  '<td />',
  '<td />',
  '<td><font>\u00A3 7,230.00</font></td>',
  '</tr>',
  '</table></body></html>',
].join('');

describe('Santander Everyday parser', () => {
  describe('parseDate', () => {
    it('parses YYYY-MM-DD (the native format emitted by the converter)', () => {
      expect(santanderEverydayParser.parseDate('2025-03-20'))
        .toEqual(new Date(2025, 2, 20));
    });

    it('parses DD/MM/YYYY (fallback for filename-embedded dates)', () => {
      expect(santanderEverydayParser.parseDate('20/03/2025'))
        .toEqual(new Date(2025, 2, 20));
    });

    it('returns null for junk input', () => {
      expect(santanderEverydayParser.parseDate('')).toBeNull();
      expect(santanderEverydayParser.parseDate('not a date')).toBeNull();
    });
  });

  describe('extractFilenameDate', () => {
    it('extracts a DMMYYYY download date from Report_ prefix', () => {
      expect(santanderEverydayParser.extractFilenameDate('Report_2042026NUMERO_DE_PERSONA 98340537.xls'))
        .toBe('2026-04-20');
    });

    it('extracts a DDMMYYYY download date from Report_ prefix', () => {
      expect(santanderEverydayParser.extractFilenameDate('Report_20042026NUMERO_DE_PERSONA 98340537.xls'))
        .toBe('2026-04-20');
    });

    it('falls back to an embedded YYYY-MM-DD token', () => {
      expect(santanderEverydayParser.extractFilenameDate('2025-03_transactions_santander-everyday.csv'))
        .toBe('2025-03-01');
    });

    it('returns null when no date pattern is present', () => {
      expect(santanderEverydayParser.extractFilenameDate('random.csv')).toBeNull();
    });
  });

  describe('validateHeaders', () => {
    it('accepts Date,Card,Description,Amount', () => {
      expect(santanderEverydayParser.validateHeaders(['Date', 'Card', 'Description', 'Amount']))
        .toEqual({ valid: true });
    });

    it('rejects when Amount is missing', () => {
      const result = santanderEverydayParser.validateHeaders(['Date', 'Card', 'Description']);
      expect(result.valid).toBe(false);
      expect(result.errors?.[0]).toMatch(/Amount/);
    });

    it('is case insensitive', () => {
      expect(santanderEverydayParser.validateHeaders(['date', 'card', 'description', 'amount']))
        .toEqual({ valid: true });
    });
  });

  describe('preprocess', () => {
    it('passes through already-CSV content verbatim', () => {
      expect(santanderEverydayParser.preprocess(SAMPLE_CSV)).toBe(SAMPLE_CSV);
    });

    it('auto-converts HTML exports dropped straight into the csv folder', () => {
      const converted = santanderEverydayParser.preprocess(SAMPLE_HTML);
      expect(converted.split('\n')[0]).toBe('Date,Card,Description,Amount');
      expect(converted).toContain('2025-03-20,** 3062,BALANCE TRANSFER MERCH,7230.00');
    });
  });

  describe('acceptedUploadExtensions', () => {
    it('declares .xls so the generic upload route accepts Santander HTML exports', () => {
      expect(santanderEverydayParser.acceptedUploadExtensions).toEqual(['.xls']);
    });
  });

  describe('transcodeUpload', () => {
    it('converts Santander HTML bytes to CSV with a filename hint stamped by earliest tx date', () => {
      const result = santanderEverydayParser.transcodeUpload!(
        Buffer.from(SAMPLE_HTML, 'latin1'),
        'Report_2042026NUMERO_DE_PERSONA 98340537.xls',
      );

      expect(result.csv.split('\n')[0]).toBe('Date,Card,Description,Amount');
      expect(result.csv).toContain('2025-03-20,** 3062,BALANCE TRANSFER MERCH,7230.00');
      expect(result.filenameHint)
        .toBe('2025-03-20_Report_2042026NUMERO_DE_PERSONA 98340537.csv');
    });

    it('decodes latin1 bytes so the literal \\xA3 pound sign survives', () => {
      const result = santanderEverydayParser.transcodeUpload!(
        Buffer.from(SAMPLE_HTML, 'latin1'),
        'Report_2042026NUMERO_DE_PERSONA 98340537 (5).xls',
      );
      // The CSV writer strips the pound for the Amount column, but the point is
      // that latin1 decode did not throw / produce mojibake along the way.
      expect(result.csv).toMatch(/7230\.00/);
    });

    it('falls back to an un-stamped filename when no tx rows are present', () => {
      const emptyHtml = [
        '<html><body><table>',
        '<tr><td /><td style="TDSeparadorDoble">Transactions</td></tr>',
        '<tr><td /><td>Date</td><td /><td>Card</td><td /><td>Description</td><td /><td>Money in</td><td /><td>Money Out</td></tr>',
        '</table></body></html>',
      ].join('');

      const result = santanderEverydayParser.transcodeUpload!(
        Buffer.from(emptyHtml, 'latin1'),
        'Report_2042026EMPTY.xls',
      );

      expect(result.filenameHint).toBe('Report_2042026EMPTY.csv');
    });
  });

  describe('transform', () => {
    it('flags positive amounts as expenses (card spend)', () => {
      const txn = santanderEverydayParser.transform(
        { Date: '2025-03-25', Card: '** 3062', Description: 'PURCHASE - DOMESTIC SHELL', Amount: '16.69' },
        'santander-everyday',
      );
      expect(txn).toMatchObject({
        amount: 16.69,
        type: 'expense',
        description: 'PURCHASE - DOMESTIC SHELL',
        account: 'santander-everyday',
      });
      expect(txn?.date).toEqual(new Date(2025, 2, 25));
    });

    it('flags negative amounts as income (payment received)', () => {
      const txn = santanderEverydayParser.transform(
        { Date: '2025-05-02', Card: '** 3062', Description: 'DD PAYMENT RECEIVED D/DEBIT', Amount: '-77.56' },
        'santander-everyday',
      );
      expect(txn).toMatchObject({ amount: -77.56, type: 'income' });
    });

    it('returns null for rows with an unparseable date', () => {
      const txn = santanderEverydayParser.transform(
        { Date: '', Card: '** 3062', Description: 'X', Amount: '1.00' },
        'santander-everyday',
      );
      expect(txn).toBeNull();
    });

    it('returns null for rows with no description', () => {
      const txn = santanderEverydayParser.transform(
        { Date: '2025-03-25', Card: '** 3062', Description: '', Amount: '1.00' },
        'santander-everyday',
      );
      expect(txn).toBeNull();
    });
  });
});
