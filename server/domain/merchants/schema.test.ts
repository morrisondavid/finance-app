import { describe, it, expect } from 'vitest';
import {
  MerchantDataSchema,
  MerchantEntrySchema,
  CategoryNameSchema,
} from './schema.js';
import { STATIC_MERCHANT_DATA } from './data.js';

describe('schema coherence with data.ts', () => {
  it('every entry in STATIC_MERCHANT_DATA parses against MerchantEntrySchema', () => {
    for (const [i, entry] of STATIC_MERCHANT_DATA.entries()) {
      const parsed = MerchantEntrySchema.safeParse(entry);
      if (!parsed.success) {
        throw new Error(
          `Entry #${i} (${entry.displayName ?? '<null>'}) failed schema: ${JSON.stringify(
            parsed.error.issues,
            null,
            2,
          )}`,
        );
      }
    }
  });

  it('the full static data array parses against MerchantDataSchema', () => {
    const parsed = MerchantDataSchema.safeParse(STATIC_MERCHANT_DATA);
    expect(parsed.success).toBe(true);
  });
});

describe('MerchantEntrySchema validation', () => {
  it('requires pattern, category, and displayName keys', () => {
    const missingPattern = MerchantEntrySchema.safeParse({
      category: 'Groceries',
      displayName: null,
    });
    const missingCategory = MerchantEntrySchema.safeParse({
      pattern: /TESCO/i,
      displayName: null,
    });
    const missingDisplayName = MerchantEntrySchema.safeParse({
      pattern: /TESCO/i,
      category: 'Groceries',
    });
    expect(missingPattern.success).toBe(false);
    expect(missingCategory.success).toBe(false);
    expect(missingDisplayName.success).toBe(false);
  });

  it('rejects a non-RegExp pattern', () => {
    const result = MerchantEntrySchema.safeParse({
      pattern: 'TESCO',
      category: 'Groceries',
      displayName: 'Tesco',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a category that is not in the CATEGORY_NAMES enum', () => {
    const result = MerchantEntrySchema.safeParse({
      pattern: /TESCO/i,
      category: 'NotACategory',
      displayName: 'Tesco',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty displayName', () => {
    const result = MerchantEntrySchema.safeParse({
      pattern: /TESCO/i,
      category: 'Groceries',
      displayName: '',
    });
    expect(result.success).toBe(false);
  });

  it('accepts displayName === null (category-only matcher)', () => {
    const result = MerchantEntrySchema.safeParse({
      pattern: /MORTGAGE/i,
      category: 'Housing',
      displayName: null,
    });
    expect(result.success).toBe(true);
  });
});

describe('CategoryNameSchema', () => {
  it('accepts every name in the canonical list', () => {
    expect(CategoryNameSchema.safeParse('Groceries').success).toBe(true);
    expect(CategoryNameSchema.safeParse('Transfers').success).toBe(true);
    expect(CategoryNameSchema.safeParse('Inter-company Loan').success).toBe(true);
  });

  it('rejects unknown category strings', () => {
    expect(CategoryNameSchema.safeParse('groceries').success).toBe(false);
    expect(CategoryNameSchema.safeParse('').success).toBe(false);
    expect(CategoryNameSchema.safeParse('NewCategory').success).toBe(false);
  });
});
