/**
 * Regression lock on the category enum. Adding or removing a
 * CategoryName breaks call-sites and budget configs across server
 * and client, so shape changes are intentional only.
 */

import { describe, expect, it } from 'vitest';
import {
  CATEGORY_NAMES,
  INTER_COMPANY_CATEGORIES,
  isInterCompanyCategory,
  type CategoryName,
} from './category-names';

describe('CATEGORY_NAMES', () => {
  it('includes the five inter-company categories', () => {
    expect(CATEGORY_NAMES).toContain('Inter-company Loan');
    expect(CATEGORY_NAMES).toContain('Capital Contribution');
    expect(CATEGORY_NAMES).toContain('Inter-company Service Fee');
    expect(CATEGORY_NAMES).toContain('Inter-company False Positive');
    expect(CATEGORY_NAMES).toContain('Inter-company Other');
  });

  it('has no duplicates', () => {
    const seen = new Set<string>();
    for (const name of CATEGORY_NAMES) {
      expect(seen.has(name)).toBe(false);
      seen.add(name);
    }
  });

  it('preserves the pre-Phase-8 categories (additive change only)', () => {
    const required: readonly CategoryName[] = [
      'Housing', 'Utilities', 'Groceries', 'Eating Out', 'Transport',
      'Shopping', 'Entertainment', 'Childcare & Education',
      'Health & Personal', 'Insurance', 'Debt Repayment', 'Tax',
      'Business', 'Payroll', 'Dividends', 'Property', 'Transfers',
      'Accommodation', 'Travel', 'Income', 'Other',
    ];
    for (const name of required) {
      expect(CATEGORY_NAMES).toContain(name);
    }
  });
});

describe('INTER_COMPANY_CATEGORIES', () => {
  it('contains exactly the five inter-company categories', () => {
    expect(INTER_COMPANY_CATEGORIES).toEqual([
      'Inter-company Loan',
      'Capital Contribution',
      'Inter-company Service Fee',
      'Inter-company False Positive',
      'Inter-company Other',
    ]);
  });

  it('every entry is also a valid CategoryName', () => {
    for (const name of INTER_COMPANY_CATEGORIES) {
      expect(CATEGORY_NAMES).toContain(name);
    }
  });
});

describe('isInterCompanyCategory', () => {
  it('returns true for each inter-company category', () => {
    for (const name of INTER_COMPANY_CATEGORIES) {
      expect(isInterCompanyCategory(name)).toBe(true);
    }
  });

  it('returns false for general-purpose categories', () => {
    expect(isInterCompanyCategory('Groceries')).toBe(false);
    expect(isInterCompanyCategory('Transfers')).toBe(false);
    expect(isInterCompanyCategory('Business')).toBe(false);
    expect(isInterCompanyCategory('Other')).toBe(false);
  });
});
