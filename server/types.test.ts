import { describe, it, expect } from 'vitest';
import {
  ACCOUNTS,
  ACCOUNT_CONFIG,
  isBusinessAccount,
  isCrossAccountBusinessToBusinessTransfer,
  getBusinessPaymentAccounts,
  getAccountsByEntity,
  getEntityIdForAccount,
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
  it('every business account has a jurisdiction-scoped business block', () => {
    for (const name of ACCOUNTS) {
      const config = ACCOUNT_CONFIG[name];
      if (config.category === 'business') {
        expect(config).toHaveProperty('business');
        expect(config.business).toHaveProperty('jurisdiction');
        expect(config.business).toHaveProperty('vat');
        expect(config.business).toHaveProperty('corpTax');
        expect(config.business.vat).toHaveProperty('applicable');
        expect(config.business.vat).toHaveProperty('rate');
        expect(config.business.vat).toHaveProperty('registered');
        expect(config.business.corpTax).toHaveProperty('applicable');
        expect(config.business.corpTax).toHaveProperty('qualifyingFreeZone');
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

  it('every UK Ltd business account carries jurisdiction=UK', () => {
    for (const name of ACCOUNTS) {
      const config = ACCOUNT_CONFIG[name];
      if (config.category === 'business' && config.entityId === 'autonize-it-ltd') {
        expect(config.business.jurisdiction).toBe('UK');
      }
    }
  });

  it('the FZCO account carries jurisdiction=UAE', () => {
    const fzco = ACCOUNT_CONFIG['emirates-islamic'];
    expect(fzco.category).toBe('business');
    if (fzco.category === 'business') {
      expect(fzco.business.jurisdiction).toBe('UAE');
      expect(fzco.business.vat.rate).toBe(0.05);
      expect(fzco.business.vat.registered).toBe(false);
      expect(fzco.business.corpTax.applicable).toBe(true);
      expect(fzco.business.corpTax.qualifyingFreeZone).toBe('TBC');
    }
  });

  it('emirates-islamic is reclassified as a current account (Phase 4)', () => {
    expect(ACCOUNT_CONFIG['emirates-islamic'].type).toBe('current');
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

  it('Phase 5 flip: returns FALSE for UK Ltd ↔ UAE FZCO pairs — inter-company is NOT a plain transfer', () => {
    expect(isCrossAccountBusinessToBusinessTransfer('barclays-current', 'emirates-islamic')).toBe(
      false,
    );
    expect(isCrossAccountBusinessToBusinessTransfer('emirates-islamic', 'barclays-current')).toBe(
      false,
    );
  });

  it('still returns true for same-entity UK ↔ UK business pairs', () => {
    expect(
      isCrossAccountBusinessToBusinessTransfer('barclays-current', 'barclays-savings'),
    ).toBe(true);
    expect(
      isCrossAccountBusinessToBusinessTransfer('barclays-savings', 'capital-on-tap'),
    ).toBe(true);
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

describe('ACCOUNT_CONFIG entityId axis', () => {
  it('every business account has a non-null entityId', () => {
    for (const name of ACCOUNTS) {
      const config = ACCOUNT_CONFIG[name];
      if (config.category === 'business') {
        expect(config.entityId).not.toBeNull();
      }
    }
  });

  it('every personal account has entityId === null', () => {
    for (const name of ACCOUNTS) {
      const config = ACCOUNT_CONFIG[name];
      if (config.category === 'personal') {
        expect(config.entityId).toBeNull();
      }
    }
  });

  it('UK Ltd business accounts are exactly the four expected ones', () => {
    const ukAccounts = ACCOUNTS.filter(
      a => ACCOUNT_CONFIG[a].entityId === 'autonize-it-ltd',
    );
    expect([...ukAccounts].sort()).toEqual(
      ['barclaycard', 'barclays-current', 'barclays-savings', 'capital-on-tap'].sort(),
    );
  });

  it('UAE FZCO business accounts are exactly [emirates-islamic]', () => {
    const fzcoAccounts = ACCOUNTS.filter(
      a => ACCOUNT_CONFIG[a].entityId === 'autonize-it-fzco',
    );
    expect(fzcoAccounts).toEqual(['emirates-islamic']);
  });

  it('entityId matches each account individually', () => {
    expect(ACCOUNT_CONFIG['barclays-current'].entityId).toBe('autonize-it-ltd');
    expect(ACCOUNT_CONFIG['barclays-savings'].entityId).toBe('autonize-it-ltd');
    expect(ACCOUNT_CONFIG['capital-on-tap'].entityId).toBe('autonize-it-ltd');
    expect(ACCOUNT_CONFIG['barclaycard'].entityId).toBe('autonize-it-ltd');
    expect(ACCOUNT_CONFIG['emirates-islamic'].entityId).toBe('autonize-it-fzco');
    expect(ACCOUNT_CONFIG['natwest'].entityId).toBeNull();
    expect(ACCOUNT_CONFIG['natwest-savings'].entityId).toBeNull();
    expect(ACCOUNT_CONFIG['monzo-joint'].entityId).toBeNull();
    expect(ACCOUNT_CONFIG['santander-everyday'].entityId).toBeNull();
  });
});

describe('getAccountsByEntity', () => {
  it('returns UK Ltd accounts for autonize-it-ltd', () => {
    expect([...getAccountsByEntity('autonize-it-ltd')].sort()).toEqual(
      ['barclaycard', 'barclays-current', 'barclays-savings', 'capital-on-tap'].sort(),
    );
  });

  it('returns [emirates-islamic] for autonize-it-fzco', () => {
    expect(getAccountsByEntity('autonize-it-fzco')).toEqual(['emirates-islamic']);
  });

  it('returns every personal account when passed null', () => {
    const personal = getAccountsByEntity(null);
    expect([...personal].sort()).toEqual(
      ['monzo-joint', 'natwest', 'natwest-savings', 'santander-everyday'].sort(),
    );
  });

  it('the three result sets partition every account exactly once', () => {
    const uk = new Set(getAccountsByEntity('autonize-it-ltd'));
    const fzco = new Set(getAccountsByEntity('autonize-it-fzco'));
    const personal = new Set(getAccountsByEntity(null));
    expect(uk.size + fzco.size + personal.size).toBe(ACCOUNTS.length);
    for (const a of ACCOUNTS) {
      const hits = [uk.has(a), fzco.has(a), personal.has(a)].filter(Boolean).length;
      expect(hits).toBe(1);
    }
  });
});

describe('getEntityIdForAccount', () => {
  it('resolves the UK Ltd entity for Barclays accounts', () => {
    expect(getEntityIdForAccount('barclays-current')).toBe('autonize-it-ltd');
    expect(getEntityIdForAccount('barclays-savings')).toBe('autonize-it-ltd');
  });

  it('resolves the FZCO entity for emirates-islamic', () => {
    expect(getEntityIdForAccount('emirates-islamic')).toBe('autonize-it-fzco');
  });

  it('resolves null for personal accounts', () => {
    expect(getEntityIdForAccount('natwest')).toBeNull();
    expect(getEntityIdForAccount('monzo-joint')).toBeNull();
  });
});
