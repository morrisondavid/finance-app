import { describe, it, expect } from 'vitest';
import { transactionDescriptionMatchesDrillSearch } from './merchant-drill-search.js';

describe('transactionDescriptionMatchesDrillSearch', () => {
  it('matches NatWest-style Uber Eats lines when search is display label', () => {
    expect(
      transactionDescriptionMatchesDrillSearch('5120 15APR26 UBER *EATS NATWEST GBR', 'Uber Eats'),
    ).toBe(true);
  });

  it('matches plain UBER EATS', () => {
    expect(transactionDescriptionMatchesDrillSearch('UBER EATS LONDON', 'Uber Eats')).toBe(true);
  });

  it('does not match Uber rides', () => {
    expect(transactionDescriptionMatchesDrillSearch('UBER PAYMENTS UK', 'Uber Eats')).toBe(false);
  });

  it('uses substring match for other merchants', () => {
    expect(transactionDescriptionMatchesDrillSearch('CURSOR AI SUBSCRIPTION', 'Cursor')).toBe(true);
  });
});
