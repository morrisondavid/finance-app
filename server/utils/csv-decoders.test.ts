/**
 * Unit tests for the shared CSV cell decoders + record reader.
 *
 * Behaviour-only — every domain's existing `csv-io.test.ts` is the
 * regression guard for the kind-labelled error messages in real call
 * sites. These tests cover the helper contracts in isolation so a
 * bug in `decodeNumber` or `decodeIsoDate` blames the helper file.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, afterEach } from 'vitest';

import {
  createCsvDecoders,
  nullIfEmpty,
  readCsvRecords,
} from './csv-decoders.js';

describe('nullIfEmpty', () => {
  it('returns null for undefined and empty/whitespace strings', () => {
    expect(nullIfEmpty(undefined)).toBeNull();
    expect(nullIfEmpty('')).toBeNull();
    expect(nullIfEmpty('   ')).toBeNull();
  });

  it('returns the trimmed value otherwise', () => {
    expect(nullIfEmpty(' DC-001  ')).toBe('DC-001');
  });
});

describe('createCsvDecoders', () => {
  const d = createCsvDecoders('Widget');

  describe('requireNonEmpty', () => {
    it('returns trimmed value', () => {
      expect(d.requireNonEmpty(' x ', 'name', 'r1')).toBe('x');
    });

    it('throws kind-labelled error on missing/empty', () => {
      expect(() => d.requireNonEmpty('', 'name', 'r1')).toThrow(
        "Widget r1: name is required",
      );
      expect(() => d.requireNonEmpty(undefined, 'name', 'r1')).toThrow(
        "Widget r1: name is required",
      );
    });
  });

  describe('decodeNumber', () => {
    it('parses integers, decimals and negatives', () => {
      expect(d.decodeNumber('0', 'n', 'r1')).toBe(0);
      expect(d.decodeNumber('12.5', 'n', 'r1')).toBe(12.5);
      expect(d.decodeNumber('-3', 'n', 'r1')).toBe(-3);
    });

    it('rejects non-numeric strings', () => {
      expect(() => d.decodeNumber('abc', 'n', 'r1')).toThrow(
        "Widget r1: n must be a number, got 'abc'",
      );
    });

    it('rejects NaN/infinity', () => {
      expect(() => d.decodeNumber('NaN', 'n', 'r1')).toThrow(/must be a number/);
      expect(() => d.decodeNumber('Infinity', 'n', 'r1')).toThrow(/must be a number/);
    });

    it('treats empty/missing as required', () => {
      expect(() => d.decodeNumber('', 'n', 'r1')).toThrow(/is required/);
    });
  });

  describe('decodeNullableNumber', () => {
    it('returns null for empty/missing', () => {
      expect(d.decodeNullableNumber('', 'n', 'r1')).toBeNull();
      expect(d.decodeNullableNumber(undefined, 'n', 'r1')).toBeNull();
    });

    it('parses values when present', () => {
      expect(d.decodeNullableNumber('1.5', 'n', 'r1')).toBe(1.5);
    });

    it('rejects non-numeric values', () => {
      expect(() => d.decodeNullableNumber('abc', 'n', 'r1')).toThrow(
        /must be a number/,
      );
    });
  });

  describe('decodeIsoDate', () => {
    it('passes through yyyy-mm-dd', () => {
      expect(d.decodeIsoDate('2026-04-25', 'date', 'r1')).toBe('2026-04-25');
    });

    it('rejects other formats and treats empty as required', () => {
      expect(() => d.decodeIsoDate('25/04/2026', 'date', 'r1')).toThrow(
        "Widget r1: date must be yyyy-mm-dd, got '25/04/2026'",
      );
      expect(() => d.decodeIsoDate('', 'date', 'r1')).toThrow(/is required/);
    });
  });

  describe('decodeNullableIsoDate', () => {
    it('returns null for empty', () => {
      expect(d.decodeNullableIsoDate('', 'date', 'r1')).toBeNull();
      expect(d.decodeNullableIsoDate(undefined, 'date', 'r1')).toBeNull();
    });

    it('passes through yyyy-mm-dd otherwise', () => {
      expect(d.decodeNullableIsoDate('2026-04-25', 'date', 'r1')).toBe(
        '2026-04-25',
      );
    });

    it('rejects malformed dates', () => {
      expect(() => d.decodeNullableIsoDate('2026/04/25', 'date', 'r1')).toThrow(
        /must be yyyy-mm-dd/,
      );
    });
  });

  describe('decodeStrictBoolean', () => {
    it("accepts 'true' / 'false'", () => {
      expect(d.decodeStrictBoolean('true', 'flag', 'r1')).toBe(true);
      expect(d.decodeStrictBoolean('false', 'flag', 'r1')).toBe(false);
    });

    it('rejects other casings or words', () => {
      expect(() => d.decodeStrictBoolean('True', 'flag', 'r1')).toThrow(
        "Widget r1: flag must be 'true' | 'false', got 'True'",
      );
      expect(() => d.decodeStrictBoolean('yes', 'flag', 'r1')).toThrow(
        /must be 'true' \| 'false'/,
      );
    });

    it('treats missing as required', () => {
      expect(() => d.decodeStrictBoolean(undefined, 'flag', 'r1')).toThrow(
        /is required/,
      );
    });
  });

  describe('decodeNonNegativeInt', () => {
    it('accepts 0 and positive integers', () => {
      expect(d.decodeNonNegativeInt('0', 'n', 'r1')).toBe(0);
      expect(d.decodeNonNegativeInt('17', 'n', 'r1')).toBe(17);
    });

    it('rejects negatives, decimals, and non-numeric values', () => {
      expect(() => d.decodeNonNegativeInt('-1', 'n', 'r1')).toThrow(
        /must be a non-negative integer/,
      );
      expect(() => d.decodeNonNegativeInt('1.5', 'n', 'r1')).toThrow(
        /must be a non-negative integer/,
      );
      expect(() => d.decodeNonNegativeInt('x', 'n', 'r1')).toThrow(
        /must be a non-negative integer/,
      );
    });
  });

  describe('decodeNonNegativeNumber', () => {
    it('accepts 0, integers and finite decimals', () => {
      expect(d.decodeNonNegativeNumber('0', 'rate', 'r1')).toBe(0);
      expect(d.decodeNonNegativeNumber('550', 'rate', 'r1')).toBe(550);
      expect(d.decodeNonNegativeNumber('123.45', 'rate', 'r1')).toBe(123.45);
    });

    it('rejects negatives and non-numeric values', () => {
      expect(() => d.decodeNonNegativeNumber('-1', 'rate', 'r1')).toThrow(
        /must be a non-negative number/,
      );
      expect(() => d.decodeNonNegativeNumber('NaN', 'rate', 'r1')).toThrow(
        /must be a non-negative number/,
      );
    });
  });

  it('captures the kind label per factory invocation', () => {
    const a = createCsvDecoders('Alpha');
    const b = createCsvDecoders('Beta');
    expect(() => a.requireNonEmpty('', 'x', 'r1')).toThrow(/^Alpha r1:/);
    expect(() => b.requireNonEmpty('', 'x', 'r1')).toThrow(/^Beta r1:/);
  });
});

describe('readCsvRecords', () => {
  let scratchDir: string | null = null;

  afterEach(() => {
    if (scratchDir !== null) {
      fs.rmSync(scratchDir, { recursive: true, force: true });
      scratchDir = null;
    }
  });

  function mkScratchFile(contents: string): string {
    scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-decoders-'));
    const file = path.join(scratchDir, 'sample.csv');
    fs.writeFileSync(file, contents, 'utf8');
    return file;
  }

  it('returns [] for missing files', () => {
    expect(readCsvRecords('/does/not/exist.csv')).toEqual([]);
  });

  it('returns [] for empty / whitespace-only files', () => {
    const path1 = mkScratchFile('');
    expect(readCsvRecords(path1)).toEqual([]);
    fs.writeFileSync(path1, '   \n   ');
    expect(readCsvRecords(path1)).toEqual([]);
  });

  it('parses with column headers, trimming and tolerant column counts', () => {
    const file = mkScratchFile(
      'id, name, amount\n  1, alpha, 100  \n2, bravo\n3,charlie,300,extra\n',
    );
    expect(readCsvRecords(file)).toEqual([
      { id: '1', name: 'alpha', amount: '100' },
      { id: '2', name: 'bravo', amount: undefined },
      { id: '3', name: 'charlie', amount: '300' },
    ]);
  });

  it('skips blank rows', () => {
    const file = mkScratchFile('id,name\n1,alpha\n\n2,bravo\n');
    const rows = readCsvRecords(file);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ id: '1', name: 'alpha' });
    expect(rows[1]).toEqual({ id: '2', name: 'bravo' });
  });
});
