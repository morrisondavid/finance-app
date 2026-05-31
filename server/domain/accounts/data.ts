/**
 * Accounts domain — raw data.
 *
 * Data only. No gate logic, no queries, no derived state. This literal
 * is fed through `buildAccountsRegistry` (which validates it against
 * `AccountConfigMapSchema`) to produce the registry with its indexes.
 *
 * Adding an account:
 *   1. Extend `AccountNameSchema` in `shared/api-contracts.ts` with the
 *      new id (the enum is the canonical list of supported accounts).
 *   2. Add the row here.
 *   3. `tsc` will enforce completeness via `Record<AccountName, ...>`.
 */

import type { CompleteAccountConfigMap } from './schema.js';

export const ACCOUNT_CONFIG_DATA: CompleteAccountConfigMap = {
  'barclays-current': {
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
    /**
     * AISP feeds (§3.4): Enable hints seed `/api/feed/enable/start` when body
     * fields are omitted. TrueLayer `providerId` — confirm in TL Console /
     * providers list for Barclays UK OB.
     */
    aispFeed: {
      enableBanking: {
        institutionHint: { institutionName: 'Barclays', country: 'GB' },
      },
      trueLayer: {
        providerId: 'ob-barclays',
      },
    },
  },
  'barclays-savings': {
    name: 'barclays-savings',
    label: 'Barclays Savings',
    type: 'savings',
    currency: 'GBP',
    entityId: 'autonize-it-ltd',
    category: 'business',
    business: {
      jurisdiction: 'UK',
      vat: { applicable: false, rate: 0.2, registered: true },
      corpTax: { applicable: false, qualifyingFreeZone: false },
    },
    canMakeOutgoingPayments: false,
    excludeTransfersFromIncome: false,
    showTaxLiabilities: false,
    aispFeed: {
      trueLayer: {
        providerId: 'ob-barclays',
      },
    },
  },
  'capital-on-tap': {
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
    quarterOverlapMonths: 1,
    /** Capital on Tap is not on TrueLayer AIS — use CSV upload (`capital-on-tap` parser). */
  },
  'barclaycard': {
    name: 'barclaycard',
    label: 'Barclaycard',
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
    aispFeed: {
      trueLayer: {
        providerId: 'ob-barclaycard',
      },
    },
  },
  /**
   * Wise (formerly TransferWise) GBP business balance held by Autonize
   * IT Ltd. Wise is not a legal bank — it's an EMI operating under FCA
   * authorisation 900507 — but for our ledger it behaves identically to
   * a current account: money in, money out, per-row settlement dates.
   * `excludeTransfersFromIncome: true` mirrors `barclays-current` so
   * top-ups that `detectTransfers` pairs Barclays→Wise don't inflate
   * Wise's "income" view. When we open a Wise balance under the FZCO
   * entity a second row (`wise-fzco`, AED) should be added alongside.
   */
  'wise-ltd': {
    name: 'wise-ltd',
    label: 'Wise (UK Ltd)',
    type: 'current',
    currency: 'GBP',
    entityId: 'autonize-it-ltd',
    category: 'business',
    business: {
      jurisdiction: 'UK',
      vat: { applicable: false, rate: 0.2, registered: true },
      corpTax: { applicable: false, qualifyingFreeZone: false },
    },
    canMakeOutgoingPayments: true,
    excludeTransfersFromIncome: true,
    showTaxLiabilities: false,
    aispFeed: {
      trueLayer: {
        providerId: 'ob-transferwise',
      },
    },
  },
  'natwest': {
    name: 'natwest',
    label: 'NatWest',
    type: 'current',
    currency: 'GBP',
    entityId: null,
    category: 'personal',
    canMakeOutgoingPayments: true,
    excludeTransfersFromIncome: false,
    showTaxLiabilities: false,
    aispFeed: {
      enableBanking: {
        institutionHint: { institutionName: 'NatWest', country: 'GB' },
      },
      trueLayer: {
        providerId: 'ob-natwest',
      },
    },
  },
  'natwest-savings': {
    name: 'natwest-savings',
    label: 'NatWest Savings',
    type: 'savings',
    currency: 'GBP',
    entityId: null,
    category: 'personal',
    canMakeOutgoingPayments: false,
    excludeTransfersFromIncome: false,
    showTaxLiabilities: false,
    aispFeed: {
      trueLayer: {
        providerId: 'ob-natwest',
      },
    },
  },
  'monzo-joint': {
    name: 'monzo-joint',
    label: 'Monzo Joint',
    type: 'current',
    currency: 'GBP',
    entityId: null,
    category: 'personal',
    canMakeOutgoingPayments: true,
    excludeTransfersFromIncome: false,
    showTaxLiabilities: false,
    aispFeed: {
      trueLayer: {
        providerId: 'ob-monzo',
      },
    },
  },
  'emirates-islamic': {
    name: 'emirates-islamic',
    label: 'Emirates Islamic (AED)',
    type: 'current',
    currency: 'AED',
    entityId: 'autonize-it-fzco',
    category: 'business',
    business: {
      jurisdiction: 'UAE',
      /**
       * UAE VAT is 5% and registration-gated. The FZCO is not yet VAT-
       * registered (per the La Fosse self-bill agreement); applicable
       * stays `true` so the Warnings Engine can surface threshold
       * breaches, but `registered: false` keeps VAT obligation seeders
       * silent until the status flips.
       */
      vat: { applicable: true, rate: 0.05, registered: false },
      /**
       * UAE CT applies in principle; `qualifyingFreeZone: 'TBC'` means
       * the FZCO has not yet formally elected QFZP status with its
       * accountant. CT obligation seeders treat `'TBC'` as a hard gate
       * and refuse to emit rows — this is a regression lock against
       * prematurely generating UAE CT liabilities.
       */
      corpTax: { applicable: true, qualifyingFreeZone: 'TBC' },
    },
    canMakeOutgoingPayments: true,
    excludeTransfersFromIncome: false,
    showTaxLiabilities: false,
    /** Emirates Islamic / UAE banks are not on TrueLayer AIS — use CSV upload. */
  },
  'emirates-islamic-gbp': {
    name: 'emirates-islamic-gbp',
    label: 'Emirates Islamic (GBP)',
    type: 'current',
    currency: 'GBP',
    entityId: 'autonize-it-fzco',
    category: 'business',
    business: {
      jurisdiction: 'UAE',
      vat: { applicable: true, rate: 0.05, registered: false },
      corpTax: { applicable: true, qualifyingFreeZone: 'TBC' },
    },
    canMakeOutgoingPayments: true,
    excludeTransfersFromIncome: false,
    showTaxLiabilities: false,
  },
  'emirates-islamic-usd': {
    name: 'emirates-islamic-usd',
    label: 'Emirates Islamic (USD)',
    type: 'current',
    currency: 'USD',
    entityId: 'autonize-it-fzco',
    category: 'business',
    business: {
      jurisdiction: 'UAE',
      vat: { applicable: true, rate: 0.05, registered: false },
      corpTax: { applicable: true, qualifyingFreeZone: 'TBC' },
    },
    canMakeOutgoingPayments: true,
    excludeTransfersFromIncome: false,
    showTaxLiabilities: false,
  },
  'santander-everyday': {
    name: 'santander-everyday',
    label: 'Santander Everyday',
    type: 'credit-card',
    currency: 'GBP',
    entityId: null,
    category: 'personal',
    canMakeOutgoingPayments: true,
    excludeTransfersFromIncome: false,
    showTaxLiabilities: false,
    aispFeed: {
      trueLayer: {
        providerId: 'ob-santander-personal',
      },
    },
  },
};
