import { describe, it, expect } from 'vitest';
import { accKey } from './expenses.js';

describe('expenses accumulator keying', () => {
  it('keeps two payments to the same merchant at different amounts separate', () => {
    const key1 = accKey('Debt Repayment', 'Barclays Partner Finance', 'barclays-current', 97.50);
    const key2 = accKey('Debt Repayment', 'Barclays Partner Finance', 'barclays-current', 143.20);
    expect(key1).not.toBe(key2);
  });

  it('groups the same recurring payment with identical amounts', () => {
    const jan = accKey('Insurance', 'Churchill Insurance', 'barclays-current', 77.00);
    const feb = accKey('Insurance', 'Churchill Insurance', 'barclays-current', 77.00);
    expect(jan).toBe(feb);
  });

  it('groups payments with sub-penny variation into the same bucket', () => {
    const a = accKey('Utilities', 'Scottish Power', 'barclays-current', 85.20);
    const b = accKey('Utilities', 'Scottish Power', 'barclays-current', 85.40);
    expect(a).toBe(b);
  });

  it('separates payments that differ significantly (>20%)', () => {
    const a = accKey('Debt Repayment', 'Novuna Finance', 'barclays-current', 300);
    const b = accKey('Debt Repayment', 'Novuna Finance', 'barclays-current', 425);
    expect(a).not.toBe(b);
  });

  it('separates same merchant across different accounts', () => {
    const a = accKey('Debt Repayment', 'Funding Circle', 'barclays-current', 400);
    const b = accKey('Debt Repayment', 'Funding Circle', 'natwest', 400);
    expect(a).not.toBe(b);
  });

  it('separates same merchant across different categories', () => {
    const a = accKey('Business', 'Cursor', 'natwest', 78);
    const b = accKey('Entertainment', 'Cursor', 'natwest', 78);
    expect(a).not.toBe(b);
  });
});
