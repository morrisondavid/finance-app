import { describe, it, expect } from 'vitest';
import emiratesIslamicParser from './emirates-islamic.js';

const SAMPLE_CSV = `Account Number : 3508511754701
Account Name : AUTONIZE IT SOFTWARE DEVELOPMENT FZCO
Transaction Date,Value Date,Narration,Transaction Reference,Debit,Credit,Running Balance
01-04-2026,01-04-2026,DFT-DTB  TT REF EPHCOP09109FM301 1119010426766256 MCE ADVISORY FZ LLC PMS INV 0673 DTD 270326 MCE 4.2K 25-342885194-1-151 - EI0166013,25-342885194-1-151,"4,200.00",0.00,"1,496.91"
31-03-2026,31-03-2026,INWARD REMITTANCETT REF: AE1RCXT2609003HP AED 4824.33 AUTONIZE IT L IMITED 53 HEATH PARK R /REF/AUTONIZE IT LTD 25-342445656-1-151 - EI0062566,25-342445656-1-151,0.00,"4,824.33","5,696.91"
03-04-2026,31-03-2026,TRANSFERMIN BAL FEE - 03/2026  - EI0059666,- -,300.00,0.00,"1,043.61"
`;

describe('Emirates Islamic Parser', () => {
  describe('parseDate', () => {
    it('parses DD-MM-YYYY format', () => {
      expect(emiratesIslamicParser.parseDate('23-02-2026'))
        .toEqual(new Date(2026, 1, 23));
    });

    it('returns null for empty/invalid strings', () => {
      expect(emiratesIslamicParser.parseDate('')).toBeNull();
      expect(emiratesIslamicParser.parseDate('invalid')).toBeNull();
      expect(emiratesIslamicParser.parseDate('2026-02-23')).toBeNull();
    });
  });

  describe('extractFilenameDate', () => {
    it('extracts from "Transaction_Summary_20Apr2026_020658" format', () => {
      expect(emiratesIslamicParser.extractFilenameDate('Transaction_Summary_20Apr2026_020658'))
        .toBe('2026-04-20');
    });

    it('returns null when no date pattern is found', () => {
      expect(emiratesIslamicParser.extractFilenameDate('random_file.csv'))
        .toBeNull();
    });
  });

  describe('preprocess', () => {
    it('strips preamble lines before the header row', () => {
      const result = emiratesIslamicParser.preprocess(SAMPLE_CSV);
      expect(result).toMatch(/^Transaction Date,Value Date/);
      expect(result).not.toContain('Account Number');
      expect(result).not.toContain('Account Name');
    });
  });

  describe('transform', () => {
    it('converts a debit row to a negative (expense) transaction', () => {
      const row = {
        'Transaction Date': '01-04-2026',
        'Value Date': '01-04-2026',
        'Narration': 'DFT-DTB  TT REF EPHCOP',
        'Transaction Reference': '25-342885194-1-151',
        'Debit': '4,200.00',
        'Credit': '0.00',
        'Running Balance': '1,496.91',
      };
      const tx = emiratesIslamicParser.transform(row, 'emirates-islamic');
      expect(tx).not.toBeNull();
      expect(tx!.amount).toBe(-4200);
      expect(tx!.type).toBe('expense');
      expect(tx!.account).toBe('emirates-islamic');
    });

    it('converts a credit row to a positive (income) transaction', () => {
      const row = {
        'Transaction Date': '31-03-2026',
        'Value Date': '31-03-2026',
        'Narration': 'INWARD REMITTANCETT REF: AE1RCXT2609003HP',
        'Transaction Reference': '25-342445656-1-151',
        'Debit': '0.00',
        'Credit': '4,824.33',
        'Running Balance': '5,696.91',
      };
      const tx = emiratesIslamicParser.transform(row, 'emirates-islamic');
      expect(tx).not.toBeNull();
      expect(tx!.amount).toBe(4824.33);
      expect(tx!.type).toBe('income');
    });

    it('returns null when both debit and credit are zero', () => {
      const row = {
        'Transaction Date': '01-04-2026',
        'Value Date': '01-04-2026',
        'Narration': 'Zero row',
        'Transaction Reference': '',
        'Debit': '0.00',
        'Credit': '0.00',
        'Running Balance': '100.00',
      };
      expect(emiratesIslamicParser.transform(row, 'emirates-islamic')).toBeNull();
    });

    it('returns null for invalid date', () => {
      const row = {
        'Transaction Date': 'invalid',
        'Value Date': '',
        'Narration': 'Bad date',
        'Transaction Reference': '',
        'Debit': '100.00',
        'Credit': '0.00',
        'Running Balance': '0.00',
      };
      expect(emiratesIslamicParser.transform(row, 'emirates-islamic')).toBeNull();
    });

    it('handles amounts with comma separators in quotes', () => {
      const row = {
        'Transaction Date': '27-03-2026',
        'Value Date': '27-03-2026',
        'Narration': 'Large payment',
        'Transaction Reference': '',
        'Debit': '"25,200.00"',
        'Credit': '0.00',
        'Running Balance': '894.63',
      };
      const tx = emiratesIslamicParser.transform(row, 'emirates-islamic');
      expect(tx).not.toBeNull();
      expect(tx!.amount).toBe(-25200);
    });
  });

  describe('validateHeaders', () => {
    it('passes when required headers are present', () => {
      const result = emiratesIslamicParser.validateHeaders([
        'Transaction Date', 'Value Date', 'Narration',
        'Transaction Reference', 'Debit', 'Credit', 'Running Balance',
      ]);
      expect(result.valid).toBe(true);
    });

    it('fails when required headers are missing', () => {
      const result = emiratesIslamicParser.validateHeaders(['Date', 'Amount']);
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
    });
  });
});
