import { describe, it, expect } from 'vitest';
import { buildAccountsRegistry } from './registry.js';
import { ACCOUNT_CONFIG_DATA } from './data.js';
import type { AccountName, BusinessAccountConfig } from './schema.js';
import { makeTestAccountsRegistry } from './fixtures.js';

const reg = buildAccountsRegistry(ACCOUNT_CONFIG_DATA);

/** Narrow a known-business fixture row to `BusinessAccountConfig`. */
function businessSource(name: AccountName): BusinessAccountConfig {
  const cfg = ACCOUNT_CONFIG_DATA[name];
  if (cfg.category !== 'business') {
    throw new Error(`businessSource: ${name} is not a business account`);
  }
  return cfg;
}

describe('indexes.business', () => {
  it('includes every account with category === business', () => {
    expect(reg.indexes.business).toEqual(
      expect.arrayContaining(['barclays-current', 'barclays-savings', 'capital-on-tap', 'barclaycard', 'emirates-islamic']),
    );
  });

  it('excludes every personal account', () => {
    for (const name of ['natwest', 'natwest-savings', 'monzo-joint', 'santander-everyday']) {
      expect(reg.indexes.business).not.toContain(name);
    }
  });
});

describe('indexes.personal', () => {
  it('includes every account with category === personal', () => {
    expect(reg.indexes.personal).toEqual(
      expect.arrayContaining(['natwest', 'natwest-savings', 'monzo-joint', 'santander-everyday']),
    );
  });

  it('excludes every business account', () => {
    for (const name of reg.indexes.business) {
      expect(reg.indexes.personal).not.toContain(name);
    }
  });
});

describe('indexes.byEntity', () => {
  it('partitions UK Ltd accounts under autonize-it-ltd', () => {
    expect(reg.indexes.byEntity.get('autonize-it-ltd')).toEqual(
      expect.arrayContaining(['barclays-current', 'barclays-savings', 'capital-on-tap', 'barclaycard']),
    );
  });

  it('partitions FZCO accounts under autonize-it-fzco', () => {
    expect(reg.indexes.byEntity.get('autonize-it-fzco')).toEqual(['emirates-islamic']);
  });

  it('never contains personal accounts', () => {
    for (const [, accounts] of reg.indexes.byEntity) {
      for (const personal of reg.indexes.personal) {
        expect(accounts).not.toContain(personal);
      }
    }
  });
});

describe('indexes.vatApplicable (gate: business + vat.applicable + vat.registered)', () => {
  it('includes a UK business account with VAT applicable + registered', () => {
    expect(reg.indexes.vatApplicable).toContain('barclays-current');
  });

  it('excludes a business account with vat.applicable === false', () => {
    expect(reg.indexes.vatApplicable).not.toContain('barclays-savings');
    expect(reg.indexes.vatApplicable).not.toContain('capital-on-tap');
  });

  it('excludes emirates-islamic — vat.applicable=true but not VAT-registered', () => {
    expect(reg.indexes.vatApplicable).not.toContain('emirates-islamic');
  });

  it('excludes every personal account', () => {
    for (const name of reg.indexes.personal) {
      expect(reg.indexes.vatApplicable).not.toContain(name);
    }
  });

  it('flips emirates-islamic into the index when vat.registered is toggled to true', () => {
    const override: BusinessAccountConfig = {
      ...businessSource('emirates-islamic'),
      business: {
        jurisdiction: 'UAE',
        vat: { applicable: true, rate: 0.05, registered: true },
        corpTax: { applicable: true, qualifyingFreeZone: 'TBC' },
      },
    };
    const fxReg = makeTestAccountsRegistry({ 'emirates-islamic': override });
    expect(fxReg.indexes.vatApplicable).toContain('emirates-islamic');
  });

  it('flips barclays-current OUT of the index when vat.applicable is toggled to false', () => {
    const override: BusinessAccountConfig = {
      ...businessSource('barclays-current'),
      business: {
        jurisdiction: 'UK',
        vat: { applicable: false, rate: 0.2, registered: true },
        corpTax: { applicable: true, qualifyingFreeZone: false },
      },
    };
    const fxReg = makeTestAccountsRegistry({ 'barclays-current': override });
    expect(fxReg.indexes.vatApplicable).not.toContain('barclays-current');
  });
});

describe('indexes.vatApplicableByEntity', () => {
  it('scopes UK VAT accounts to autonize-it-ltd', () => {
    expect(reg.indexes.vatApplicableByEntity.get('autonize-it-ltd')).toEqual(['barclays-current']);
  });

  it('returns no entry for autonize-it-fzco while FZCO is unregistered', () => {
    expect(reg.indexes.vatApplicableByEntity.get('autonize-it-fzco')).toBeUndefined();
  });

  it('every name in vatApplicableByEntity also appears in vatApplicable', () => {
    for (const [, accounts] of reg.indexes.vatApplicableByEntity) {
      for (const a of accounts) {
        expect(reg.indexes.vatApplicable).toContain(a);
      }
    }
  });
});

describe('indexes.corpTaxApplicable (gate: business + corpTax.applicable + qualifyingFreeZone !== TBC)', () => {
  it('includes UK business accounts with CT applicable', () => {
    expect(reg.indexes.corpTaxApplicable).toContain('barclays-current');
  });

  it('excludes business accounts with corpTax.applicable === false', () => {
    expect(reg.indexes.corpTaxApplicable).not.toContain('barclays-savings');
    expect(reg.indexes.corpTaxApplicable).not.toContain('capital-on-tap');
    expect(reg.indexes.corpTaxApplicable).not.toContain('barclaycard');
  });

  it("excludes emirates-islamic while qualifyingFreeZone === 'TBC'", () => {
    expect(reg.indexes.corpTaxApplicable).not.toContain('emirates-islamic');
  });

  it('excludes every personal account', () => {
    for (const name of reg.indexes.personal) {
      expect(reg.indexes.corpTaxApplicable).not.toContain(name);
    }
  });

  it('flips emirates-islamic into the index when QFZP is resolved to false (non-QFZP)', () => {
    const override: BusinessAccountConfig = {
      ...businessSource('emirates-islamic'),
      business: {
        jurisdiction: 'UAE',
        vat: { applicable: true, rate: 0.05, registered: false },
        corpTax: { applicable: true, qualifyingFreeZone: false },
      },
    };
    const fxReg = makeTestAccountsRegistry({ 'emirates-islamic': override });
    expect(fxReg.indexes.corpTaxApplicable).toContain('emirates-islamic');
  });

  it('flips emirates-islamic into the index when QFZP is resolved to true', () => {
    const override: BusinessAccountConfig = {
      ...businessSource('emirates-islamic'),
      business: {
        jurisdiction: 'UAE',
        vat: { applicable: true, rate: 0.05, registered: false },
        corpTax: { applicable: true, qualifyingFreeZone: true },
      },
    };
    const fxReg = makeTestAccountsRegistry({ 'emirates-islamic': override });
    expect(fxReg.indexes.corpTaxApplicable).toContain('emirates-islamic');
  });
});

describe('indexes.outgoingPaymentsCapable', () => {
  it('excludes savings accounts (canMakeOutgoingPayments === false)', () => {
    expect(reg.indexes.outgoingPaymentsCapable).not.toContain('barclays-savings');
    expect(reg.indexes.outgoingPaymentsCapable).not.toContain('natwest-savings');
  });

  it('includes current and credit-card accounts', () => {
    expect(reg.indexes.outgoingPaymentsCapable).toContain('barclays-current');
    expect(reg.indexes.outgoingPaymentsCapable).toContain('capital-on-tap');
  });
});

describe('indexes.creditCards', () => {
  it('includes every account with type === credit-card', () => {
    expect(reg.indexes.creditCards).toEqual(
      expect.arrayContaining(['capital-on-tap', 'barclaycard', 'santander-everyday']),
    );
  });

  it('excludes current and savings accounts', () => {
    for (const name of ['barclays-current', 'barclays-savings', 'natwest', 'natwest-savings', 'monzo-joint', 'emirates-islamic']) {
      expect(reg.indexes.creditCards).not.toContain(name);
    }
  });
});

describe('indexes.showTaxLiabilities', () => {
  it('is exactly [barclays-current] on current seed data', () => {
    expect(reg.indexes.showTaxLiabilities).toEqual(['barclays-current']);
  });
});

describe('indexes.excludeTransfersFromIncome', () => {
  it('is exactly [barclays-current, wise-ltd] on current seed data', () => {
    expect([...reg.indexes.excludeTransfersFromIncome].sort()).toEqual(
      ['barclays-current', 'wise-ltd'],
    );
  });
});
