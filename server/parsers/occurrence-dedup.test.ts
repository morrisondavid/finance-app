import { describe, it, expect } from 'vitest';
import { assignOccurrences } from './index.js';
import { generateTransactionHash } from '../db/connection.js';
import type { Transaction } from '../types.js';

function makeTxn(overrides: Partial<Transaction> = {}): Transaction {
  return {
    date: new Date('2025-06-15'),
    description: 'RESTAURANT ABC',
    amount: -50,
    account: 'barclays-current',
    type: 'expense',
    ...overrides,
  };
}

describe('assignOccurrences', () => {
  describe('core logic', () => {
    it('returns empty array for empty input', () => {
      expect(assignOccurrences([])).toEqual([]);
    });

    it('assigns occurrence 1 to a single transaction', () => {
      const result = assignOccurrences([makeTxn()]);
      expect(result).toHaveLength(1);
      expect(result[0].occurrence).toBe(1);
    });

    it('assigns occurrence 1 to all unique transactions', () => {
      const result = assignOccurrences([
        makeTxn({ description: 'SHOP A', amount: -10 }),
        makeTxn({ description: 'SHOP B', amount: -20 }),
        makeTxn({ description: 'SHOP C', amount: -30 }),
      ]);
      expect(result).toHaveLength(3);
      result.forEach(t => expect(t.occurrence).toBe(1));
    });

    it('assigns occurrence 1 and 2 to two identical transactions', () => {
      const result = assignOccurrences([makeTxn(), makeTxn()]);
      expect(result).toHaveLength(2);
      expect(result[0].occurrence).toBe(1);
      expect(result[1].occurrence).toBe(2);
    });

    it('assigns occurrence 1, 2, 3 to triple identical transactions', () => {
      const result = assignOccurrences([makeTxn(), makeTxn(), makeTxn()]);
      expect(result).toHaveLength(3);
      expect(result[0].occurrence).toBe(1);
      expect(result[1].occurrence).toBe(2);
      expect(result[2].occurrence).toBe(3);
    });

    it('numbers each duplicate group independently', () => {
      const result = assignOccurrences([
        makeTxn({ description: 'SHOP A', amount: -10 }),
        makeTxn({ description: 'RESTAURANT', amount: -50 }),
        makeTxn({ description: 'RESTAURANT', amount: -50 }),
        makeTxn({ description: 'SHOP B', amount: -20 }),
        makeTxn({ description: 'RESTAURANT', amount: -50 }),
      ]);
      expect(result).toHaveLength(5);

      const shopA = result.filter(t => t.description === 'SHOP A');
      const shopB = result.filter(t => t.description === 'SHOP B');
      const restaurants = result.filter(t => t.description === 'RESTAURANT');

      expect(shopA).toHaveLength(1);
      expect(shopA[0].occurrence).toBe(1);
      expect(shopB).toHaveLength(1);
      expect(shopB[0].occurrence).toBe(1);
      expect(restaurants).toHaveLength(3);
      expect(restaurants.map(t => t.occurrence).sort()).toEqual([1, 2, 3]);
    });

    it('does NOT group transactions with same date/amount but different descriptions', () => {
      const result = assignOccurrences([
        makeTxn({ description: 'SHOP A', amount: -50 }),
        makeTxn({ description: 'SHOP B', amount: -50 }),
      ]);
      expect(result).toHaveLength(2);
      result.forEach(t => expect(t.occurrence).toBe(1));
    });

    it('does NOT group transactions with same date/description but different amounts', () => {
      const result = assignOccurrences([
        makeTxn({ description: 'RESTAURANT', amount: -50 }),
        makeTxn({ description: 'RESTAURANT', amount: -75 }),
      ]);
      expect(result).toHaveLength(2);
      result.forEach(t => expect(t.occurrence).toBe(1));
    });

    it('groups case-insensitively (matching normalizeDescription behaviour)', () => {
      const result = assignOccurrences([
        makeTxn({ description: 'RESTAURANT ABC' }),
        makeTxn({ description: 'restaurant abc' }),
        makeTxn({ description: 'Restaurant ABC' }),
      ]);
      expect(result).toHaveLength(3);
      expect(result.map(t => t.occurrence).sort()).toEqual([1, 2, 3]);
    });

    it('collapses whitespace/tabs when grouping (matching normalizeDescription)', () => {
      const result = assignOccurrences([
        makeTxn({ description: 'HMRC VAT SOUTHEND\t292146596 BBP' }),
        makeTxn({ description: 'HMRC VAT SOUTHEND  292146596 BBP' }),
      ]);
      expect(result).toHaveLength(2);
      expect(result.map(t => t.occurrence).sort()).toEqual([1, 2]);
    });

    it('preserves all other transaction fields unchanged', () => {
      const original = makeTxn({
        date: new Date('2025-08-01'),
        description: 'SPECIFIC PAYMENT',
        amount: -123.45,
        account: 'natwest',
        type: 'expense',
      });
      const result = assignOccurrences([original]);
      expect(result[0].date).toEqual(original.date);
      expect(result[0].description).toBe(original.description);
      expect(result[0].amount).toBe(original.amount);
      expect(result[0].account).toBe(original.account);
      expect(result[0].type).toBe(original.type);
    });
  });

  describe('cross-file dedup via hash', () => {
    it('raw file and monthly file produce identical hashes for the same transactions', () => {
      const rawFileTransactions = assignOccurrences([
        makeTxn({ description: 'PAYMENT A' }),
        makeTxn({ description: 'PAYMENT B' }),
      ]);

      const monthlyFileTransactions = assignOccurrences([
        makeTxn({ description: 'PAYMENT A' }),
        makeTxn({ description: 'PAYMENT B' }),
      ]);

      const rawHashes = rawFileTransactions.map(generateTransactionHash);
      const monthlyHashes = monthlyFileTransactions.map(generateTransactionHash);
      expect(rawHashes).toEqual(monthlyHashes);
    });

    it('processing order does not matter — monthly then raw gives same hashes', () => {
      const fileA = assignOccurrences([makeTxn(), makeTxn()]);
      const fileB = assignOccurrences([makeTxn(), makeTxn()]);

      const hashesA = fileA.map(generateTransactionHash);
      const hashesB = fileB.map(generateTransactionHash);
      expect(hashesA).toEqual(hashesB);
    });

    it('partial file (1 txn) then full file (2 identical txns) — occurrence:2 is net-new', () => {
      const partial = assignOccurrences([makeTxn()]);
      const full = assignOccurrences([makeTxn(), makeTxn()]);

      const partialHashes = new Set(partial.map(generateTransactionHash));
      const fullHashes = full.map(generateTransactionHash);

      const partialHash = [...partialHashes][0];
      expect(fullHashes[0]).toBe(partialHash);
      expect(partialHashes.has(fullHashes[1])).toBe(false);
    });

    it('full file (2 txns) then partial file (1 txn) — partial is entirely a duplicate', () => {
      const full = assignOccurrences([makeTxn(), makeTxn()]);
      const partial = assignOccurrences([makeTxn()]);

      const fullHashes = new Set(full.map(generateTransactionHash));
      const partialHashes = partial.map(generateTransactionHash);

      expect(fullHashes.has(partialHashes[0])).toBe(true);
    });

    it('unique transactions across files — all get occurrence 1, all hashes match', () => {
      const fileA = assignOccurrences([
        makeTxn({ description: 'PAYMENT A' }),
        makeTxn({ description: 'PAYMENT B' }),
      ]);
      const fileB = assignOccurrences([
        makeTxn({ description: 'PAYMENT A' }),
        makeTxn({ description: 'PAYMENT B' }),
      ]);

      fileA.forEach(t => expect(t.occurrence).toBe(1));
      fileB.forEach(t => expect(t.occurrence).toBe(1));

      const hashesA = fileA.map(generateTransactionHash);
      const hashesB = fileB.map(generateTransactionHash);
      expect(hashesA).toEqual(hashesB);
    });

    it('three overlapping files — max occurrence count survives, no extras', () => {
      const file1 = assignOccurrences([makeTxn(), makeTxn(), makeTxn()]);
      const file2 = assignOccurrences([makeTxn(), makeTxn()]);
      const file3 = assignOccurrences([makeTxn()]);

      const allHashes = [
        ...file1.map(generateTransactionHash),
        ...file2.map(generateTransactionHash),
        ...file3.map(generateTransactionHash),
      ];
      const uniqueHashes = new Set(allHashes);

      expect(uniqueHashes.size).toBe(3);
    });
  });

  describe('regression: _occurrence column is ignored', () => {
    it('file with and without _occurrence column produces same occurrences', () => {
      const withOccurrence = assignOccurrences([
        { ...makeTxn(), occurrence: 99 },
        { ...makeTxn(), occurrence: 99 },
      ]);
      const withoutOccurrence = assignOccurrences([
        makeTxn(),
        makeTxn(),
      ]);

      expect(withOccurrence[0].occurrence).toBe(1);
      expect(withOccurrence[1].occurrence).toBe(2);

      const hashesWith = withOccurrence.map(generateTransactionHash);
      const hashesWithout = withoutOccurrence.map(generateTransactionHash);
      expect(hashesWith).toEqual(hashesWithout);
    });

    it('wrong pre-baked occurrence values are corrected', () => {
      const wrongOccurrences = assignOccurrences([
        { ...makeTxn(), occurrence: 1 },
        { ...makeTxn(), occurrence: 1 },
        { ...makeTxn(), occurrence: 1 },
      ]);

      expect(wrongOccurrences[0].occurrence).toBe(1);
      expect(wrongOccurrences[1].occurrence).toBe(2);
      expect(wrongOccurrences[2].occurrence).toBe(3);
    });
  });
});
