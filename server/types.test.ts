import { describe, it, expect } from 'vitest';
import {
  ACCOUNTS,
  ACCOUNT_CONFIG,
  isBusinessAccount,
  isBusinessConfig,
  isCrossAccountBusinessToBusinessTransfer,
  getBusinessPaymentAccounts,
  getVatApplicableAccounts,
  getCorpTaxApplicableAccounts,
  type BusinessAccountConfig,
} from './types.js';

describe('isBusinessAccount', () => {
  it('returns true for configured business accounts', () => {
    expect(isBusinessAccount('barclays-current')).toBe(true);
    expect(isBusinessAccount('barclays-savings')).toBe(true);
    expect(isBusinessAccount('capital-on-tap')).toBe(true);
    expect(isBusinessAccount('barclaycard')).toBe(true);
    expect(isBusinessAccount('emirates-islamic')).toBe(true);
  });

  it('returns false for personal accounts', () => {
    expect(isBusinessAccount('natwest')).toBe(false);
    expect(isBusinessAccount('monzo-joint')).toBe(false);
  });

  it('returns false for unknown account ids', () => {
    expect(isBusinessAccount('unknown-bank')).toBe(false);
    expect(isBusinessAccount('')).toBe(false);
  });
});

describe('AccountConfig discriminated union structure', () => {
  it('every business account has a business property', () => {
    for (const name of ACCOUNTS) {
      const config = ACCOUNT_CONFIG[name];
      if (config.category === 'business') {
        expect(config).toHaveProperty('business');
        expect(config.business).toHaveProperty('vatApplicable');
        expect(config.business).toHaveProperty('corpTaxApplicable');
      }
    }
  });

  it('no personal account has a business property', () => {
    for (const name of ACCOUNTS) {
      const config = ACCOUNT_CONFIG[name];
      if (config.category === 'personal') {
        expect(config).not.toHaveProperty('business');
      }
    }
  });

  it('isBusinessConfig narrows correctly for business accounts', () => {
    const barclaysCurrent = ACCOUNT_CONFIG['barclays-current'];
    expect(isBusinessConfig(barclaysCurrent)).toBe(true);
    if (isBusinessConfig(barclaysCurrent)) {
      expect(barclaysCurrent.business.vatApplicable).toBe(true);
      expect(barclaysCurrent.business.corpTaxApplicable).toBe(true);
    }
  });

  it('isBusinessConfig returns false for personal accounts', () => {
    expect(isBusinessConfig(ACCOUNT_CONFIG['natwest'])).toBe(false);
    expect(isBusinessConfig(ACCOUNT_CONFIG['monzo-joint'])).toBe(false);
  });
});

describe('getVatApplicableAccounts', () => {
  it('returns only business accounts with business.vatApplicable === true', () => {
    const vatAccounts = getVatApplicableAccounts();
    expect(vatAccounts).toContain('barclays-current');
    expect(vatAccounts.length).toBeGreaterThan(0);

    for (const name of vatAccounts) {
      const config = ACCOUNT_CONFIG[name];
      expect(isBusinessConfig(config)).toBe(true);
      expect((config as BusinessAccountConfig).business.vatApplicable).toBe(true);
    }
  });

  it('never includes personal accounts', () => {
    const vatAccounts = getVatApplicableAccounts();
    const personalAccounts = ACCOUNTS.filter(a => ACCOUNT_CONFIG[a].category === 'personal');
    for (const p of personalAccounts) {
      expect(vatAccounts).not.toContain(p);
    }
  });

  it('never includes business accounts with vatApplicable === false', () => {
    const vatAccounts = getVatApplicableAccounts();
    for (const name of ACCOUNTS) {
      const config = ACCOUNT_CONFIG[name];
      if (isBusinessConfig(config) && !config.business.vatApplicable) {
        expect(vatAccounts).not.toContain(name);
      }
    }
  });

  it('excludes emirates-islamic (UAE jurisdiction)', () => {
    const vatAccounts = getVatApplicableAccounts();
    expect(vatAccounts).not.toContain('emirates-islamic');
  });
});

describe('getCorpTaxApplicableAccounts', () => {
  it('returns only business accounts with business.corpTaxApplicable === true', () => {
    const corpTaxAccounts = getCorpTaxApplicableAccounts();
    expect(corpTaxAccounts).toContain('barclays-current');
    expect(corpTaxAccounts.length).toBeGreaterThan(0);

    for (const name of corpTaxAccounts) {
      const config = ACCOUNT_CONFIG[name];
      expect(isBusinessConfig(config)).toBe(true);
      expect((config as BusinessAccountConfig).business.corpTaxApplicable).toBe(true);
    }
  });

  it('never includes personal accounts', () => {
    const corpTaxAccounts = getCorpTaxApplicableAccounts();
    const personalAccounts = ACCOUNTS.filter(a => ACCOUNT_CONFIG[a].category === 'personal');
    for (const p of personalAccounts) {
      expect(corpTaxAccounts).not.toContain(p);
    }
  });

  it('never includes business accounts with corpTaxApplicable === false', () => {
    const corpTaxAccounts = getCorpTaxApplicableAccounts();
    for (const name of ACCOUNTS) {
      const config = ACCOUNT_CONFIG[name];
      if (isBusinessConfig(config) && !config.business.corpTaxApplicable) {
        expect(corpTaxAccounts).not.toContain(name);
      }
    }
  });

  it('excludes emirates-islamic (UAE jurisdiction)', () => {
    const corpTaxAccounts = getCorpTaxApplicableAccounts();
    expect(corpTaxAccounts).not.toContain('emirates-islamic');
  });
});

describe('getBusinessPaymentAccounts (still works with new structure)', () => {
  it('only returns business accounts that canMakeOutgoingPayments', () => {
    const accounts = getBusinessPaymentAccounts();
    for (const name of accounts) {
      const config = ACCOUNT_CONFIG[name];
      expect(config.category).toBe('business');
      expect(config.canMakeOutgoingPayments).toBe(true);
    }
  });

  it('excludes savings (cannot make outgoing payments)', () => {
    const accounts = getBusinessPaymentAccounts();
    expect(accounts).not.toContain('barclays-savings');
  });

  it('excludes personal accounts', () => {
    const accounts = getBusinessPaymentAccounts();
    expect(accounts).not.toContain('natwest');
    expect(accounts).not.toContain('monzo-joint');
  });
});

describe('isCrossAccountBusinessToBusinessTransfer', () => {
  it('returns false when accounts are the same', () => {
    expect(isCrossAccountBusinessToBusinessTransfer('barclays-current', 'barclays-current')).toBe(
      false,
    );
  });

  it('returns true for business to different business account', () => {
    expect(isCrossAccountBusinessToBusinessTransfer('barclays-current', 'barclays-savings')).toBe(
      true,
    );
    expect(isCrossAccountBusinessToBusinessTransfer('barclays-current', 'capital-on-tap')).toBe(
      true,
    );
  });

  it('returns true for cross-currency business-to-business transfers (UK ↔ UAE)', () => {
    expect(isCrossAccountBusinessToBusinessTransfer('barclays-current', 'emirates-islamic')).toBe(
      true,
    );
    expect(isCrossAccountBusinessToBusinessTransfer('emirates-islamic', 'barclays-current')).toBe(
      true,
    );
  });

  it('returns false for business to personal (director payouts stay expense/income)', () => {
    expect(isCrossAccountBusinessToBusinessTransfer('barclays-current', 'natwest')).toBe(false);
    expect(isCrossAccountBusinessToBusinessTransfer('barclays-current', 'monzo-joint')).toBe(false);
  });

  it('returns false if either account is unknown', () => {
    expect(isCrossAccountBusinessToBusinessTransfer('barclays-current', 'other')).toBe(false);
    expect(isCrossAccountBusinessToBusinessTransfer('other', 'barclays-current')).toBe(false);
  });
});
