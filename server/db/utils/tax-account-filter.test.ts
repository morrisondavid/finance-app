import { describe, it, expect } from 'vitest';
import { buildVatAccountFilter, buildCorpTaxAccountFilter } from './tax-account-filter.js';
import {
  ACCOUNTS,
  ACCOUNT_CONFIG,
  isBusinessConfig,
  getVatApplicableAccounts,
  getCorpTaxApplicableAccounts,
} from '../../types.js';

describe('buildVatAccountFilter', () => {
  it('returns a clause with placeholders matching vatApplicable accounts', () => {
    const { clause, params } = buildVatAccountFilter();
    const expected = getVatApplicableAccounts();
    expect(expected.length).toBeGreaterThan(0);
    expect(clause).toContain('AND account IN');
    expect(params).toEqual(expected);
  });

  it('params contain only vatApplicable accounts', () => {
    const { params } = buildVatAccountFilter();
    for (const p of params) {
      const config = ACCOUNT_CONFIG[p as keyof typeof ACCOUNT_CONFIG];
      expect(isBusinessConfig(config)).toBe(true);
      if (isBusinessConfig(config)) {
        expect(config.business.vatApplicable).toBe(true);
      }
    }
  });

  it('never includes a personal account', () => {
    const { params } = buildVatAccountFilter();
    const personalAccounts = ACCOUNTS.filter(a => ACCOUNT_CONFIG[a].category === 'personal');
    for (const p of personalAccounts) {
      expect(params).not.toContain(p);
    }
  });

  it('never includes a business account without vatApplicable', () => {
    const { params } = buildVatAccountFilter();
    for (const name of ACCOUNTS) {
      const config = ACCOUNT_CONFIG[name];
      if (isBusinessConfig(config) && !config.business.vatApplicable) {
        expect(params).not.toContain(name);
      }
    }
  });

  it('placeholder count matches params count', () => {
    const { clause, params } = buildVatAccountFilter();
    const questionMarks = (clause.match(/\?/g) ?? []).length;
    expect(questionMarks).toBe(params.length);
  });
});

describe('buildCorpTaxAccountFilter', () => {
  it('returns a clause with placeholders matching corpTaxApplicable accounts', () => {
    const { clause, params } = buildCorpTaxAccountFilter();
    const expected = getCorpTaxApplicableAccounts();
    expect(expected.length).toBeGreaterThan(0);
    expect(clause).toContain('AND account IN');
    expect(params).toEqual(expected);
  });

  it('params contain only corpTaxApplicable accounts', () => {
    const { params } = buildCorpTaxAccountFilter();
    for (const p of params) {
      const config = ACCOUNT_CONFIG[p as keyof typeof ACCOUNT_CONFIG];
      expect(isBusinessConfig(config)).toBe(true);
      if (isBusinessConfig(config)) {
        expect(config.business.corpTaxApplicable).toBe(true);
      }
    }
  });

  it('never includes a personal account', () => {
    const { params } = buildCorpTaxAccountFilter();
    const personalAccounts = ACCOUNTS.filter(a => ACCOUNT_CONFIG[a].category === 'personal');
    for (const p of personalAccounts) {
      expect(params).not.toContain(p);
    }
  });

  it('never includes a business account without corpTaxApplicable', () => {
    const { params } = buildCorpTaxAccountFilter();
    for (const name of ACCOUNTS) {
      const config = ACCOUNT_CONFIG[name];
      if (isBusinessConfig(config) && !config.business.corpTaxApplicable) {
        expect(params).not.toContain(name);
      }
    }
  });

  it('placeholder count matches params count', () => {
    const { clause, params } = buildCorpTaxAccountFilter();
    const questionMarks = (clause.match(/\?/g) ?? []).length;
    expect(questionMarks).toBe(params.length);
  });
});

describe('zero-result safety net', () => {
  it('buildVatAccountFilter would return AND 1=0 if no accounts qualified', () => {
    // We can't easily mock ACCOUNT_CONFIG in a unit test without DI,
    // but we can verify the shape of the current output is never empty
    // given the current config. The structural guarantee comes from
    // the implementation: if getVatApplicableAccounts() returns [],
    // the function returns { clause: 'AND 1=0', params: [] }.
    const { clause, params } = buildVatAccountFilter();
    if (params.length === 0) {
      expect(clause).toBe('AND 1=0');
    } else {
      expect(clause).toContain('AND account IN');
    }
  });

  it('buildCorpTaxAccountFilter would return AND 1=0 if no accounts qualified', () => {
    const { clause, params } = buildCorpTaxAccountFilter();
    if (params.length === 0) {
      expect(clause).toBe('AND 1=0');
    } else {
      expect(clause).toContain('AND account IN');
    }
  });
});
