import { describe, it, expect } from 'vitest';
import {
  effectiveMinPaymentFloorGbp,
  effectiveMinPaymentPct,
  isCostlyRevolvingCreditCard,
  preferredOutgoingAccountForCard,
} from './credit-card-terms.js';
import type { AccountConfig, CreditCardConfig } from './schema.js';

describe('credit-card-terms', () => {
  it('prefers top-level minPaymentPct over promo default', () => {
    const cfg: CreditCardConfig = {
      standardApr: 0.0718,
      minPaymentPct: 0.1,
      promo: { apr: 0, expiresAt: '2027-01-01', transferFeePct: 0, minPaymentPct: 0.01, minPaymentTerminatesPromo: true },
    };
    expect(effectiveMinPaymentPct(cfg)).toBe(0.1);
    expect(effectiveMinPaymentFloorGbp(cfg)).toBe(25);
  });

  it('flags Capital on Tap as costly revolving', () => {
    expect(
      isCostlyRevolvingCreditCard({ standardApr: 0.0718, minPaymentPct: 0.1, minPaymentFloorGbp: 100 }),
    ).toBe(true);
  });

  it('does not flag low APR + low min payment', () => {
    expect(isCostlyRevolvingCreditCard({ standardApr: 0.01, minPaymentPct: 0.02 })).toBe(false);
  });

  it('resolves preferred business current for a business credit card', () => {
    const card: AccountConfig = {
      name: 'capital-on-tap',
      label: 'Capital on Tap',
      type: 'credit-card',
      currency: 'GBP',
      entityId: 'autonize-it-ltd',
      category: 'business',
      business: {
        jurisdiction: 'UK',
        vat: { applicable: false, rate: 0.2, registered: true },
        corpTax: { applicable: false, qualifyingFreeZone: false },
      },
      canMakeOutgoingPayments: true,
      excludeTransfersFromIncome: false,
      showTaxLiabilities: false,
    };
    const current: AccountConfig = {
      name: 'barclays-current',
      label: 'Barclays Current',
      type: 'current',
      currency: 'GBP',
      entityId: 'autonize-it-ltd',
      category: 'business',
      business: {
        jurisdiction: 'UK',
        vat: { applicable: true, rate: 0.2, registered: true },
        corpTax: { applicable: true, qualifyingFreeZone: false },
      },
      canMakeOutgoingPayments: true,
      excludeTransfersFromIncome: true,
      showTaxLiabilities: true,
    };
    expect(preferredOutgoingAccountForCard(card, [card, current])?.name).toBe('barclays-current');
  });
});
