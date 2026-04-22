import { describe, it, expect } from 'vitest';
import {
  AccountConfigSchema,
  AccountConfigMapSchema,
  BusinessAccountConfigSchema,
  PersonalAccountConfigSchema,
} from './schema.js';
import { ACCOUNT_CONFIG_DATA } from './data.js';

describe('schema coherence with data.ts', () => {
  it('every entry in ACCOUNT_CONFIG_DATA parses against AccountConfigSchema', () => {
    for (const [name, config] of Object.entries(ACCOUNT_CONFIG_DATA)) {
      const parsed = AccountConfigSchema.safeParse(config);
      if (!parsed.success) {
        throw new Error(
          `Account '${name}' failed schema: ${JSON.stringify(parsed.error.issues, null, 2)}`,
        );
      }
    }
  });

  it('the full map parses against AccountConfigMapSchema', () => {
    const parsed = AccountConfigMapSchema.safeParse(ACCOUNT_CONFIG_DATA);
    expect(parsed.success).toBe(true);
  });
});

describe('BusinessAccountConfigSchema discriminator', () => {
  it('accepts a well-formed UK business account', () => {
    const result = BusinessAccountConfigSchema.safeParse(ACCOUNT_CONFIG_DATA['barclays-current']);
    expect(result.success).toBe(true);
  });

  it('rejects a business account with entityId: null', () => {
    const result = BusinessAccountConfigSchema.safeParse({
      ...ACCOUNT_CONFIG_DATA['barclays-current'],
      entityId: null,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a business account missing the business block', () => {
    const source = ACCOUNT_CONFIG_DATA['barclays-current'];
    const withoutBusiness = {
      name: source.name,
      label: source.label,
      type: source.type,
      currency: source.currency,
      entityId: source.entityId,
      category: source.category,
      canMakeOutgoingPayments: source.canMakeOutgoingPayments,
      excludeTransfersFromIncome: source.excludeTransfersFromIncome,
      showTaxLiabilities: source.showTaxLiabilities,
    };
    const result = BusinessAccountConfigSchema.safeParse(withoutBusiness);
    expect(result.success).toBe(false);
  });

  it("accepts UAE business account with qualifyingFreeZone: 'TBC'", () => {
    const result = BusinessAccountConfigSchema.safeParse(ACCOUNT_CONFIG_DATA['emirates-islamic']);
    expect(result.success).toBe(true);
  });
});

describe('PersonalAccountConfigSchema discriminator', () => {
  it('accepts a well-formed personal account', () => {
    const result = PersonalAccountConfigSchema.safeParse(ACCOUNT_CONFIG_DATA['natwest']);
    expect(result.success).toBe(true);
  });

  it('rejects a personal account with a non-null entityId', () => {
    const result = PersonalAccountConfigSchema.safeParse({
      ...ACCOUNT_CONFIG_DATA['natwest'],
      entityId: 'autonize-it-ltd',
    });
    expect(result.success).toBe(false);
  });

  it('strips a stray business block rather than embedding it on a personal config', () => {
    const result = PersonalAccountConfigSchema.safeParse({
      ...ACCOUNT_CONFIG_DATA['natwest'],
      business: {
        jurisdiction: 'UK',
        vat: { applicable: true, rate: 0.2, registered: true },
        corpTax: { applicable: true, qualifyingFreeZone: false },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect('business' in result.data).toBe(false);
    }
  });
});

describe('AccountConfigSchema discriminated union', () => {
  it('picks the right branch based on category', () => {
    const business = AccountConfigSchema.safeParse(ACCOUNT_CONFIG_DATA['barclays-current']);
    const personal = AccountConfigSchema.safeParse(ACCOUNT_CONFIG_DATA['natwest']);
    expect(business.success).toBe(true);
    expect(personal.success).toBe(true);
  });

  it('rejects a config with an invalid category', () => {
    const result = AccountConfigSchema.safeParse({
      ...ACCOUNT_CONFIG_DATA['barclays-current'],
      category: 'mystery',
    });
    expect(result.success).toBe(false);
  });
});
