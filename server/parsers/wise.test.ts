import { describe, it, expect } from 'vitest';
import wiseParser from './wise.js';
import type { CSVRow } from '../types.js';

/**
 * Fixture rows distilled from the real Wise export format — see
 * `~/Downloads/transaction-history.csv` for the canonical headers.
 * Each row below is keyed with the literal Wise column names so the
 * parser's `getColumnValue` path (which is case-insensitive but
 * otherwise literal) gets exercised end-to-end.
 */

function makeRow(overrides: Record<string, string>): CSVRow {
  const base: CSVRow = {
    'ID': 'TRANSFER-TEST',
    'Status': 'COMPLETED',
    'Direction': 'IN',
    'Created on': '2026-03-31 05:58:20',
    'Finished on': '2026-03-31 05:58:39',
    'Source fee amount': '0.00',
    'Source fee currency': 'GBP',
    'Target fee amount': '',
    'Target fee currency': '',
    'Source name': 'Autonize It Limited',
    'Source amount (after fees)': '1000.0',
    'Source currency': 'GBP',
    'Target name': 'Autonize It Limited',
    'Target amount (after fees)': '1000.0',
    'Target currency': 'GBP',
    'Exchange rate': '1.0',
    'Reference': '',
    'Batch': '',
    'Created by': 'David Delroy Morrison',
    'Category': 'Money added',
    'Note': '',
  };
  return { ...base, ...overrides };
}

describe('Wise Parser', () => {
  describe('parseDate', () => {
    it('parses YYYY-MM-DD HH:MM:SS format, ignoring the time', () => {
      const d = wiseParser.parseDate('2026-03-31 06:12:16');
      expect(d).not.toBeNull();
      expect(d!.getFullYear()).toBe(2026);
      expect(d!.getMonth()).toBe(2);
      expect(d!.getDate()).toBe(31);
    });

    it('returns null for empty or malformed strings', () => {
      expect(wiseParser.parseDate('')).toBeNull();
      expect(wiseParser.parseDate('31/03/2026')).toBeNull();
    });
  });

  describe('extractFilenameDate', () => {
    it('returns null — Wise exports do not embed a date in the filename', () => {
      expect(wiseParser.extractFilenameDate('transaction-history.csv')).toBeNull();
    });
  });

  describe('validateHeaders', () => {
    it('accepts the full Wise header set', () => {
      const result = wiseParser.validateHeaders([...wiseParser.headers]);
      expect(result.valid).toBe(true);
    });

    it('rejects a CSV missing a required header', () => {
      const result = wiseParser.validateHeaders(['ID', 'Status', 'Direction', 'Created on']);
      expect(result.valid).toBe(false);
      expect(result.errors?.[0]).toContain('Source amount (after fees)');
    });
  });

  describe('transform — IN GBP top-ups', () => {
    it('emits a positive income row for a completed GBP → GBP top-up', () => {
      const row = makeRow({
        'ID': 'TRANSFER-2049948142',
        'Direction': 'IN',
        'Source amount (after fees)': '1000.0',
      });
      const tx = wiseParser.transform(row, 'wise-ltd');
      expect(tx).not.toBeNull();
      expect(tx!.amount).toBe(1000);
      expect(tx!.type).toBe('income');
      expect(tx!.account).toBe('wise-ltd');
      expect(tx!.description).toMatch(/^Wise:/);
    });
  });

  describe('transform — OUT GBP → AED inter-company', () => {
    it('includes the source fee in the expense amount', () => {
      const row = makeRow({
        'ID': 'TRANSFER-2049952671',
        'Direction': 'OUT',
        'Source fee amount': '5.74',
        'Source amount (after fees)': '994.89',
        'Target name': 'Autonize IT Software Development - FZCO',
        'Target amount (after fees)': '4824.33',
        'Target currency': 'AED',
        'Exchange rate': '4.84911',
        'Category': 'General',
      });
      const tx = wiseParser.transform(row, 'wise-ltd');
      expect(tx).not.toBeNull();
      expect(tx!.amount).toBeCloseTo(-1000.63, 2);
      expect(tx!.type).toBe('expense');
      expect(tx!.description).toContain('Autonize IT Software Development - FZCO');
      expect(tx!.description).toContain('AED');
      expect(tx!.description).toContain('4.84911');
    });
  });

  describe('transform — OUT GBP → GBP refund', () => {
    it('emits a single expense row with no cross-currency metadata', () => {
      const row = makeRow({
        'ID': 'BANK_DETAILS_ORDER-23072293',
        'Direction': 'OUT',
        'Source fee amount': '',
        'Source amount (after fees)': '50.00',
        'Target name': 'TransferWise',
        'Target amount (after fees)': '50.00',
        'Target currency': 'GBP',
        'Exchange rate': '1.00000000',
        'Reference': '23072293',
      });
      const tx = wiseParser.transform(row, 'wise-ltd');
      expect(tx).not.toBeNull();
      expect(tx!.amount).toBe(-50);
      expect(tx!.type).toBe('expense');
      expect(tx!.description).toContain('TransferWise');
      expect(tx!.description).toContain('23072293');
      expect(tx!.description).not.toMatch(/AED|@/);
    });
  });

  describe('transform — rows that must be skipped', () => {
    it('skips REFUNDED rows regardless of direction', () => {
      const row = makeRow({
        'Status': 'REFUNDED',
        'Direction': 'IN',
        'Source amount (after fees)': '470.0',
      });
      expect(wiseParser.transform(row, 'wise-ltd')).toBeNull();
    });

    it('skips rows whose Source currency is not GBP (future wise-fzco surface)', () => {
      const row = makeRow({
        'Direction': 'OUT',
        'Source currency': 'AED',
        'Source amount (after fees)': '4000.00',
      });
      expect(wiseParser.transform(row, 'wise-ltd')).toBeNull();
    });

    it('skips rows with a malformed Created on', () => {
      const row = makeRow({
        'Created on': 'not a date',
      });
      expect(wiseParser.transform(row, 'wise-ltd')).toBeNull();
    });

    it('skips rows with a zero Source amount (after fees)', () => {
      const row = makeRow({
        'Direction': 'IN',
        'Source amount (after fees)': '0.0',
      });
      expect(wiseParser.transform(row, 'wise-ltd')).toBeNull();
    });

    it('skips non-IN/OUT directions defensively', () => {
      const row = makeRow({
        'Direction': 'NEUTRAL',
      });
      expect(wiseParser.transform(row, 'wise-ltd')).toBeNull();
    });
  });
});
