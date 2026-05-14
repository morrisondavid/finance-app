/**
 * Pure-function tests for the shared feed emitter helpers.
 *
 * Each helper has exactly one job — these tests pin that job (and the
 * one well-defined fall-through for malformed input) so any future
 * tweak to a parser's `emitFeedTransactionsAsCsv` can keep relying on
 * the helper's contract.
 */

import { describe, it, expect } from 'vitest';
import {
  buildCsv,
  formatAmount,
  isoToDDMMYYYY,
  isoToDDhyphenMMhyphenYYYY,
  isoToNatwestDate,
} from './feed-emitter-helpers.js';

describe('formatAmount', () => {
  it('formats positive numbers to two decimals', () => {
    expect(formatAmount(123.4)).toBe('123.40');
  });

  it('formats zero as 0.00', () => {
    expect(formatAmount(0)).toBe('0.00');
  });

  it('preserves the negative sign', () => {
    expect(formatAmount(-12.345)).toBe('-12.35');
  });
});

describe('isoToDDMMYYYY', () => {
  it('reverses an ISO date into DD/MM/YYYY', () => {
    expect(isoToDDMMYYYY('2026-04-15')).toBe('15/04/2026');
  });

  it('returns the input unchanged when not ISO-shaped', () => {
    expect(isoToDDMMYYYY('15-Apr-2026')).toBe('15-Apr-2026');
  });
});

describe('isoToNatwestDate', () => {
  it('renders Jan as the abbreviated month name with two-digit day', () => {
    expect(isoToNatwestDate('2026-01-05')).toBe('05 Jan 2026');
  });

  it('renders Dec at the end of the year', () => {
    expect(isoToNatwestDate('2024-12-30')).toBe('30 Dec 2024');
  });

  it('returns the input unchanged when not ISO-shaped', () => {
    expect(isoToNatwestDate('30/12/2024')).toBe('30/12/2024');
  });
});

describe('isoToDDhyphenMMhyphenYYYY', () => {
  it('reverses an ISO date into DD-MM-YYYY', () => {
    expect(isoToDDhyphenMMhyphenYYYY('2025-03-09')).toBe('09-03-2025');
  });

  it('returns the input unchanged when not ISO-shaped', () => {
    expect(isoToDDhyphenMMhyphenYYYY('not-a-date')).toBe('not-a-date');
  });
});

describe('buildCsv', () => {
  it('emits headers on the first line and joins rows with newlines', () => {
    const csv = buildCsv(['A', 'B'], [{ A: '1', B: '2' }, { A: '3', B: '4' }]);
    expect(csv).toBe('A,B\n1,2\n3,4');
  });

  it('emits an empty cell for missing keys without throwing', () => {
    const csv = buildCsv(['A', 'B', 'C'], [{ A: 'x' }]);
    expect(csv).toBe('A,B,C\nx,,');
  });

  it('escapes commas and quotes through escapeCsvField', () => {
    const csv = buildCsv(['Description'], [{ Description: 'Hello, "world"' }]);
    expect(csv).toBe('Description\n"Hello, ""world"""');
  });

  it('escapes newlines inside fields', () => {
    const csv = buildCsv(['Note'], [{ Note: 'line1\nline2' }]);
    expect(csv).toBe('Note\n"line1\nline2"');
  });
});
