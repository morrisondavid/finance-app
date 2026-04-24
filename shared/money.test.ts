import { describe, it, expect } from 'vitest';
import { parseMoneyAmount } from './money.js';

describe('parseMoneyAmount', () => {
  it('parses a plain integer', () => {
    expect(parseMoneyAmount('2500')).toBe(2500);
  });

  it('parses thousands-separated values', () => {
    expect(parseMoneyAmount('2,500.00')).toBe(2500);
    expect(parseMoneyAmount('12,345.67')).toBe(12345.67);
  });

  it('tolerates a leading currency symbol', () => {
    expect(parseMoneyAmount('£2,500.00')).toBe(2500);
    expect(parseMoneyAmount('$500')).toBe(500);
    expect(parseMoneyAmount('€99.99')).toBe(99.99);
  });

  it('tolerates an ISO currency prefix', () => {
    expect(parseMoneyAmount('GBP 2,500.00')).toBe(2500);
    expect(parseMoneyAmount('AED 10000')).toBe(10000);
  });

  it('parses explicit negatives', () => {
    expect(parseMoneyAmount('-500')).toBe(-500);
    expect(parseMoneyAmount('-£500.00')).toBe(-500);
  });

  it('parses accountant-style parenthesised negatives', () => {
    expect(parseMoneyAmount('(500.00)')).toBe(-500);
    expect(parseMoneyAmount('(£2,500.00)')).toBe(-2500);
  });

  it('returns null for non-numeric input', () => {
    expect(parseMoneyAmount('')).toBeNull();
    expect(parseMoneyAmount('   ')).toBeNull();
    expect(parseMoneyAmount('abc')).toBeNull();
    expect(parseMoneyAmount('£abc')).toBeNull();
  });

  it('returns null for ambiguous multi-dot strings', () => {
    expect(parseMoneyAmount('1.234.56')).toBeNull();
  });

  it('preserves zero correctly', () => {
    expect(parseMoneyAmount('0.00')).toBe(0);
    expect(parseMoneyAmount('£0')).toBe(0);
  });
});
