import { describe, it, expect } from 'vitest';
import { buildAccountInFilter } from './tax-account-filter.js';
import {
  vatApplicableAccounts,
  corpTaxApplicableAccounts,
  personalAccounts,
  businessAccounts,
  getAccountConfig,
  type AccountName,
} from '../../domain/accounts/index.js';

describe('buildAccountInFilter', () => {
  it('produces AND 1=0 for an empty accounts list', () => {
    const { clause, params } = buildAccountInFilter([]);
    expect(clause).toBe('AND 1=0');
    expect(params).toEqual([]);
  });

  it('produces a placeholder IN clause for a non-empty list', () => {
    const { clause, params } = buildAccountInFilter(['barclays-current']);
    expect(clause).toBe('AND account IN (?)');
    expect(params).toEqual(['barclays-current']);
  });

  it('placeholder count matches params count', () => {
    const { clause, params } = buildAccountInFilter([
      'barclays-current',
      'capital-on-tap',
      'barclaycard',
    ]);
    const questionMarks = (clause.match(/\?/g) ?? []).length;
    expect(questionMarks).toBe(params.length);
    expect(params).toEqual(['barclays-current', 'capital-on-tap', 'barclaycard']);
  });

  it('returns a fresh params array — mutating the result does not leak', () => {
    const accounts: readonly AccountName[] = ['barclays-current'];
    const { params } = buildAccountInFilter(accounts);
    params.push('capital-on-tap');
    expect(accounts).toEqual(['barclays-current']);
  });
});

describe('VAT filter integration (buildAccountInFilter × vatApplicableAccounts)', () => {
  it('produces the same clause/params the seeder actually consumes', () => {
    const result = buildAccountInFilter(vatApplicableAccounts());
    const expected = [...vatApplicableAccounts()];
    expect(result.params).toEqual(expected);
    expect(result.clause).toContain('AND account IN');
  });

  it('current config: params === [barclays-current]', () => {
    const { params } = buildAccountInFilter(vatApplicableAccounts());
    expect(params).toEqual(['barclays-current']);
  });

  it('never includes a personal account', () => {
    const { params } = buildAccountInFilter(vatApplicableAccounts());
    for (const p of personalAccounts()) {
      expect(params).not.toContain(p);
    }
  });

  it('never includes a business account with vat.applicable === false', () => {
    const { params } = buildAccountInFilter(vatApplicableAccounts());
    for (const name of businessAccounts()) {
      const config = getAccountConfig(name);
      if (config.category === 'business' && !config.business.vat.applicable) {
        expect(params).not.toContain(name);
      }
    }
  });

  it('never includes emirates-islamic (FZCO vat.registered=false)', () => {
    const { params } = buildAccountInFilter(vatApplicableAccounts());
    expect(params).not.toContain('emirates-islamic');
  });
});

describe('CT filter integration (buildAccountInFilter × corpTaxApplicableAccounts)', () => {
  it('produces the same clause/params the seeder actually consumes', () => {
    const result = buildAccountInFilter(corpTaxApplicableAccounts());
    const expected = [...corpTaxApplicableAccounts()];
    expect(result.params).toEqual(expected);
    expect(result.clause).toContain('AND account IN');
  });

  it('current config: params === [barclays-current]', () => {
    const { params } = buildAccountInFilter(corpTaxApplicableAccounts());
    expect(params).toEqual(['barclays-current']);
  });

  it('never includes a personal account', () => {
    const { params } = buildAccountInFilter(corpTaxApplicableAccounts());
    for (const p of personalAccounts()) {
      expect(params).not.toContain(p);
    }
  });

  it('never includes a business account with corpTax.applicable === false', () => {
    const { params } = buildAccountInFilter(corpTaxApplicableAccounts());
    for (const name of businessAccounts()) {
      const config = getAccountConfig(name);
      if (config.category === 'business' && !config.business.corpTax.applicable) {
        expect(params).not.toContain(name);
      }
    }
  });

  it('never includes emirates-islamic (FZCO qualifyingFreeZone=TBC)', () => {
    const { params } = buildAccountInFilter(corpTaxApplicableAccounts());
    expect(params).not.toContain('emirates-islamic');
  });
});
