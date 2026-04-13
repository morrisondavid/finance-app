import { describe, it, expect } from 'vitest';
import { normalizeDescription, generateTransactionHash } from './connection.js';
import type { Transaction } from '../types.js';

describe('normalizeDescription', () => {
  it('lowercases and trims', () => {
    expect(normalizeDescription('  HELLO WORLD  ')).toBe('hello world');
  });

  it('collapses multiple spaces and tabs', () => {
    expect(normalizeDescription('FOO   BAR\tBAZ')).toBe('foo bar baz');
  });

  it('preserves the full description without truncation', () => {
    const longDesc = 'OKSANA LUKOSIENE , DAVID , VIA MOBILE - LVP , FP 13/03/23 10 , 17105408493699000N';
    const normalized = normalizeDescription(longDesc);
    expect(normalized).toContain('17105408493699000n');
    expect(normalized.length).toBeGreaterThan(50);
  });
});

describe('generateTransactionHash', () => {
  it('produces different hashes for transactions with different descriptions beyond 50 chars', () => {
    const base: Omit<Transaction, 'description'> = {
      date: new Date('2023-03-13'),
      amount: -60,
      account: 'natwest',
      type: 'expense',
      occurrence: 1,
    };

    const transaction1: Transaction = {
      ...base,
      description: 'OKSANA LUKOSIENE , DAVID , VIA MOBILE - LVP , FP 13/03/23 10 , 17105408493699000N',
    };

    const transaction2: Transaction = {
      ...base,
      description: 'OKSANA LUKOSIENE , DAVID , VIA MOBILE - LVP , FP 10/03/23 10 , 62190236316068000N',
    };

    const hash1 = generateTransactionHash(transaction1);
    const hash2 = generateTransactionHash(transaction2);

    expect(hash1).not.toBe(hash2);
  });

  it('produces different hashes for different occurrence values', () => {
    const base: Omit<Transaction, 'occurrence'> = {
      date: new Date('2023-03-13'),
      description: 'IDENTICAL PAYMENT',
      amount: -60,
      account: 'natwest',
      type: 'expense',
    };

    const hash1 = generateTransactionHash({ ...base, occurrence: 1 });
    const hash2 = generateTransactionHash({ ...base, occurrence: 2 });

    expect(hash1).not.toBe(hash2);
  });

  it('produces the same hash for identical transactions', () => {
    const transaction: Transaction = {
      date: new Date('2023-03-13'),
      description: 'SOME PAYMENT',
      amount: -25.50,
      account: 'natwest',
      type: 'expense',
      occurrence: 1,
    };

    expect(generateTransactionHash(transaction)).toBe(generateTransactionHash(transaction));
  });

  it('defaults occurrence to 1 when not set', () => {
    const withOccurrence: Transaction = {
      date: new Date('2023-03-13'),
      description: 'SOME PAYMENT',
      amount: -25.50,
      account: 'natwest',
      type: 'expense',
      occurrence: 1,
    };

    const withoutOccurrence: Transaction = {
      date: new Date('2023-03-13'),
      description: 'SOME PAYMENT',
      amount: -25.50,
      account: 'natwest',
      type: 'expense',
    };

    expect(generateTransactionHash(withOccurrence)).toBe(generateTransactionHash(withoutOccurrence));
  });
});
