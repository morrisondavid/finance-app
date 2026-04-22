/**
 * Schema coherence for the transaction-overrides registry.
 *
 * Every row written back to `transaction-category-overrides.csv` must
 * round-trip through `TransactionCategoryOverrideRowSchema`. We
 * exercise the schema here independently of CSV I/O so rejections
 * are attributable to the schema.
 */

import { describe, it, expect } from 'vitest';
import { TransactionCategoryOverrideRowSchema } from './schema.js';

describe('TransactionCategoryOverrideRowSchema', () => {
  it('accepts a valid row', () => {
    const parsed = TransactionCategoryOverrideRowSchema.parse({
      hash: 'abc123',
      category: 'Inter-company Loan',
      notes: null,
      classified_at: '2026-04-21',
    });
    expect(parsed.category).toBe('Inter-company Loan');
  });

  it('rejects an unknown category', () => {
    const result = TransactionCategoryOverrideRowSchema.safeParse({
      hash: 'abc123',
      category: 'Not A Real Category',
      notes: null,
      classified_at: '2026-04-21',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a malformed classified_at', () => {
    const result = TransactionCategoryOverrideRowSchema.safeParse({
      hash: 'abc123',
      category: 'Inter-company Loan',
      notes: null,
      classified_at: 'yesterday',
    });
    expect(result.success).toBe(false);
  });
});
