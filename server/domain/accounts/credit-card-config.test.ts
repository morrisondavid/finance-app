/**
 * Schema-level lock for the §1.9 `creditCard` extension on `AccountConfig`.
 * The field is optional everywhere; populated rows must validate; the three
 * existing credit-card accounts must currently be `creditCard: undefined`
 * (the user populates them in a follow-up edit, NOT in §1.9 itself).
 */

import { describe, it, expect } from 'vitest';
import {
  AccountConfigSchema,
  CreditCardConfigSchema,
  CreditCardPromoSchema,
  type CreditCardConfig,
} from './schema.js';
import { ACCOUNT_CONFIG_DATA } from './data.js';

describe('CreditCardConfig schema', () => {
  const validBase: CreditCardConfig = { standardApr: 0.249 };
  const validWithPromo: CreditCardConfig = {
    standardApr: 0.249,
    promo: {
      apr: 0,
      expiresAt: '2026-12-31',
      transferFeePct: 0.029,
      minPaymentPct: 0.01,
      minPaymentTerminatesPromo: true,
    },
  };

  it('accepts a base config with just standardApr', () => {
    expect(() => CreditCardConfigSchema.parse(validBase)).not.toThrow();
  });

  it('accepts minPaymentPct and minPaymentFloorGbp on the card block', () => {
    expect(() =>
      CreditCardConfigSchema.parse({
        standardApr: 0.0718,
        minPaymentPct: 0.1,
        minPaymentFloorGbp: 100,
      }),
    ).not.toThrow();
  });

  it('accepts a config with a promo block', () => {
    expect(() => CreditCardConfigSchema.parse(validWithPromo)).not.toThrow();
  });

  it('rejects standardApr outside [0, 1]', () => {
    expect(() => CreditCardConfigSchema.parse({ standardApr: -0.01 })).toThrow();
    expect(() => CreditCardConfigSchema.parse({ standardApr: 1.5 })).toThrow();
  });

  it('rejects a promo with non-ISO expiresAt', () => {
    expect(() =>
      CreditCardPromoSchema.parse({
        ...validWithPromo.promo!,
        expiresAt: '12/31/2026',
      }),
    ).toThrow();
  });

  it('rejects a promo with transferFeePct > 1', () => {
    expect(() =>
      CreditCardPromoSchema.parse({
        ...validWithPromo.promo!,
        transferFeePct: 1.5,
      }),
    ).toThrow();
  });
});

describe('AccountConfigSchema integration', () => {
  it('accepts a credit-card account WITHOUT a creditCard block (current state of all 3)', () => {
    const barclaycard = ACCOUNT_CONFIG_DATA['barclaycard'];
    expect(() => AccountConfigSchema.parse(barclaycard)).not.toThrow();
    expect(barclaycard.creditCard).toBeUndefined();
  });

  it('accepts a credit-card account WITH a creditCard block', () => {
    const barclaycard = ACCOUNT_CONFIG_DATA['barclaycard'];
    const enriched = {
      ...barclaycard,
      creditCard: {
        standardApr: 0.249,
        promo: {
          apr: 0,
          expiresAt: '2027-06-30',
          transferFeePct: 0.029,
          minPaymentPct: 0.01,
          minPaymentTerminatesPromo: true,
        },
      },
    };
    expect(() => AccountConfigSchema.parse(enriched)).not.toThrow();
  });

  it('Barclaycard and Santander Everyday still lack creditCard blocks; Capital on Tap and MBNA are populated', () => {
    expect(ACCOUNT_CONFIG_DATA['barclaycard'].creditCard).toBeUndefined();
    expect(ACCOUNT_CONFIG_DATA['santander-everyday'].creditCard).toBeUndefined();
    expect(ACCOUNT_CONFIG_DATA['capital-on-tap'].creditCard).toEqual({
      standardApr: 0.0718,
      minPaymentPct: 0.1,
      minPaymentFloorGbp: 100,
    });
    expect(ACCOUNT_CONFIG_DATA['mbna'].creditCard).toEqual({
      standardApr: 0.21726,
      minPaymentPct: 0.025,
      minPaymentFloorGbp: 25,
    });
  });

  it('non-credit-card accounts may also carry creditCard:undefined (semantically meaningless but schema-valid)', () => {
    const barclays = ACCOUNT_CONFIG_DATA['barclays-current'];
    expect(barclays.creditCard).toBeUndefined();
    expect(() => AccountConfigSchema.parse(barclays)).not.toThrow();
  });
});
