import { describe, it, expect, vi } from 'vitest';
import {
  isValidAccountName,
  validateAccount,
  getAccountConfig,
  isBusinessConfig,
  isBusinessAccount,
  isCreditCard,
  canMakeOutgoingPayments,
  getEntityIdForAccount,
  accountsForEntity,
  businessAccounts,
  personalAccounts,
  vatApplicableAccounts,
  corpTaxApplicableAccounts,
  businessPaymentAccounts,
  personalPaymentAccounts,
  businessAndPersonalPaymentAccounts,
  isCrossAccountBusinessToBusinessTransfer,
} from './queries.js';
import * as enableLinks from '../../ingestion/feeds/enable-account-links-csv.js';
import * as tlLinks from '../../ingestion/feeds/truelayer-account-links-csv.js';
import { makeTestAccountsRegistry } from './fixtures.js';
import { buildAccountsRegistry } from './registry.js';
import { ACCOUNT_CONFIG_DATA } from './data.js';
import type { AccountConfigMap, AccountName, BusinessAccountConfig } from './schema.js';

function businessSource(name: AccountName): BusinessAccountConfig {
  const cfg = ACCOUNT_CONFIG_DATA[name];
  if (cfg.category !== 'business') {
    throw new Error(`businessSource: ${name} is not a business account`);
  }
  return cfg;
}

const reg = makeTestAccountsRegistry();

describe('isValidAccountName / validateAccount', () => {
  it('accepts known account names', () => {
    expect(isValidAccountName('barclays-current')).toBe(true);
  });

  it('rejects unknown names', () => {
    expect(isValidAccountName('not-a-bank')).toBe(false);
  });

  it('validateAccount falls back to barclays-current for unknown ids', () => {
    expect(validateAccount(undefined)).toBe('barclays-current');
    expect(validateAccount('bogus')).toBe('barclays-current');
  });

  it('validateAccount keeps known ids', () => {
    expect(validateAccount('natwest')).toBe('natwest');
  });
});

describe('getAccountConfig / isBusinessConfig', () => {
  it('returns the configured AccountConfig', () => {
    const cfg = getAccountConfig('barclays-current', reg);
    expect(cfg.name).toBe('barclays-current');
  });

  it('throws when a registry built from a data subset is missing the requested name', () => {
    const subset: AccountConfigMap = {
      'barclays-current': ACCOUNT_CONFIG_DATA['barclays-current'],
    };
    const sparse = buildAccountsRegistry(subset);
    expect(() => getAccountConfig('natwest', sparse)).toThrow(/Unknown account/);
    expect(getAccountConfig('barclays-current', sparse).name).toBe('barclays-current');
  });

  it('isBusinessConfig narrows to BusinessAccountConfig', () => {
    const cfg = getAccountConfig('barclays-current', reg);
    expect(isBusinessConfig(cfg)).toBe(true);
    if (isBusinessConfig(cfg)) {
      expect(cfg.business.jurisdiction).toBe('UK');
    }
  });

  it('isBusinessConfig returns false for personal configs', () => {
    const cfg = getAccountConfig('natwest', reg);
    expect(isBusinessConfig(cfg)).toBe(false);
  });

  it('overrides enableBanking.accountId when enable-account-links.csv has a row', () => {
    const spy = vi.spyOn(enableLinks, 'getEnableAccountIdFromFile');
    spy.mockImplementation((acct: AccountName) =>
      acct === 'natwest' ? 'from-csv-uid' : undefined,
    );
    const cfg = getAccountConfig('natwest', reg);
    expect(cfg.aispFeed?.enableBanking?.accountId).toBe('from-csv-uid');
    expect(cfg.aispFeed?.enableBanking?.institutionHint?.country).toBe('GB');
    spy.mockRestore();
  });

  it('overrides trueLayer.dataAccountId when truelayer-account-links.csv has a row', () => {
    const subReg = makeTestAccountsRegistry({
      'barclays-current': {
        ...ACCOUNT_CONFIG_DATA['barclays-current'],
        aispFeed: {
          ...ACCOUNT_CONFIG_DATA['barclays-current'].aispFeed,
          trueLayer: { providerId: 'ob-barclays', dataAccountId: 'from-ts' },
        },
      },
    });
    const spy = vi.spyOn(tlLinks, 'getTrueLayerAccountIdFromFile');
    spy.mockImplementation((acct: AccountName) =>
      acct === 'barclays-current' ? 'from-csv-tl' : undefined,
    );
    const cfg = getAccountConfig('barclays-current', subReg);
    expect(cfg.aispFeed?.trueLayer?.dataAccountId).toBe('from-csv-tl');
    expect(cfg.aispFeed?.trueLayer?.providerId).toBe('ob-barclays');
    spy.mockRestore();
  });
  it('returns true for business accounts', () => {
    expect(isBusinessAccount('barclays-current', reg)).toBe(true);
    expect(isBusinessAccount('emirates-islamic', reg)).toBe(true);
  });

  it('returns false for personal accounts', () => {
    expect(isBusinessAccount('natwest', reg)).toBe(false);
  });

  it('returns false for unknown ids', () => {
    expect(isBusinessAccount('ghost', reg)).toBe(false);
  });
});

describe('isCreditCard / canMakeOutgoingPayments', () => {
  it('isCreditCard picks out every credit card', () => {
    expect(isCreditCard('capital-on-tap', reg)).toBe(true);
    expect(isCreditCard('barclays-current', reg)).toBe(false);
  });

  it('canMakeOutgoingPayments honours the config flag', () => {
    expect(canMakeOutgoingPayments('barclays-current', reg)).toBe(true);
    expect(canMakeOutgoingPayments('barclays-savings', reg)).toBe(false);
  });
});

describe('getEntityIdForAccount / accountsForEntity', () => {
  it('resolves UK Ltd accounts to autonize-it-ltd', () => {
    expect(getEntityIdForAccount('barclays-current', reg)).toBe('autonize-it-ltd');
  });

  it('resolves FZCO account to autonize-it-fzco', () => {
    expect(getEntityIdForAccount('emirates-islamic', reg)).toBe('autonize-it-fzco');
  });

  it('resolves personal accounts to null', () => {
    expect(getEntityIdForAccount('natwest', reg)).toBeNull();
  });

  it('accountsForEntity(null) returns personal accounts', () => {
    expect([...accountsForEntity(null, reg)].sort()).toEqual([...personalAccounts(reg)].sort());
  });

  it('accountsForEntity(id) returns business accounts for that entity', () => {
    expect(accountsForEntity('autonize-it-fzco', reg)).toEqual(['emirates-islamic']);
  });
});

describe('businessAccounts / personalAccounts', () => {
  it('returns the corresponding indexes', () => {
    expect(businessAccounts(reg)).toBe(reg.indexes.business);
    expect(personalAccounts(reg)).toBe(reg.indexes.personal);
  });
});

describe('vatApplicableAccounts', () => {
  it('returns the global VAT-applicable index when no scope is supplied', () => {
    expect(vatApplicableAccounts(undefined, reg)).toBe(reg.indexes.vatApplicable);
  });

  it('scopes to a single entity when entityId is supplied', () => {
    expect(vatApplicableAccounts({ entityId: 'autonize-it-ltd' }, reg)).toEqual(['barclays-current']);
  });

  it('returns [] for an entity with no VAT-applicable accounts', () => {
    expect(vatApplicableAccounts({ entityId: 'autonize-it-fzco' }, reg)).toEqual([]);
  });
});

describe('corpTaxApplicableAccounts', () => {
  it('returns the global CT-applicable index when no scope is supplied', () => {
    expect(corpTaxApplicableAccounts(undefined, reg)).toBe(reg.indexes.corpTaxApplicable);
  });

  it('scopes to a single entity when entityId is supplied', () => {
    expect(corpTaxApplicableAccounts({ entityId: 'autonize-it-ltd' }, reg)).toEqual(['barclays-current']);
  });
});

describe('payment-account queries', () => {
  it('businessPaymentAccounts is business ∩ outgoing', () => {
    const accounts = businessPaymentAccounts(reg);
    for (const a of accounts) {
      expect(reg.indexes.business).toContain(a);
      expect(reg.indexes.outgoingPaymentsCapable).toContain(a);
    }
  });

  it('personalPaymentAccounts excludes savings', () => {
    expect(personalPaymentAccounts(reg)).not.toContain('natwest-savings');
  });

  it('businessAndPersonalPaymentAccounts is the union of both', () => {
    const combined = businessAndPersonalPaymentAccounts(reg);
    for (const a of businessPaymentAccounts(reg)) expect(combined).toContain(a);
    for (const a of personalPaymentAccounts(reg)) expect(combined).toContain(a);
  });
});

describe('isCrossAccountBusinessToBusinessTransfer', () => {
  it('returns false when accounts are equal', () => {
    expect(
      isCrossAccountBusinessToBusinessTransfer('barclays-current', 'barclays-current', reg),
    ).toBe(false);
  });

  it('returns true for UK Ltd → UK Ltd pairs', () => {
    expect(
      isCrossAccountBusinessToBusinessTransfer('barclays-current', 'barclays-savings', reg),
    ).toBe(true);
  });

  it('returns false for UK Ltd ↔ UAE FZCO pairs (inter-company, not transfer)', () => {
    expect(
      isCrossAccountBusinessToBusinessTransfer('barclays-current', 'emirates-islamic', reg),
    ).toBe(false);
  });

  it('returns false for business ↔ personal pairs', () => {
    expect(
      isCrossAccountBusinessToBusinessTransfer('barclays-current', 'natwest', reg),
    ).toBe(false);
  });

  it('returns false when either side is unknown', () => {
    expect(isCrossAccountBusinessToBusinessTransfer('barclays-current', 'ghost', reg)).toBe(false);
    expect(isCrossAccountBusinessToBusinessTransfer('ghost', 'barclays-current', reg)).toBe(false);
  });
});

describe('query purity — injection of a fixture registry is honoured', () => {
  it('switching the FZCO to vat.registered=true flips the VAT-applicable result', () => {
    const override: BusinessAccountConfig = {
      ...businessSource('emirates-islamic'),
      business: {
        jurisdiction: 'UAE',
        vat: { applicable: true, rate: 0.05, registered: true },
        corpTax: { applicable: true, qualifyingFreeZone: 'TBC' },
      },
    };
    const switched = makeTestAccountsRegistry({ 'emirates-islamic': override });
    expect(vatApplicableAccounts({ entityId: 'autonize-it-fzco' }, switched)).toEqual([
      'emirates-islamic',
    ]);
    // Default registry remains unchanged — query doesn't leak fixture state.
    expect(vatApplicableAccounts({ entityId: 'autonize-it-fzco' }, reg)).toEqual([]);
  });
});
