/**
 * Jurisdiction-scoped tax rules (Roadmap 1.1 / Phase 4).
 *
 * This file is the single source of truth for VAT and Corporation-Tax-
 * style rules keyed by `Jurisdiction`. Every downstream calculation
 * (obligation auto-seeders, forecast projections, warnings engine)
 * reads from here rather than hard-coding country-specific constants
 * in-line — that keeps the UK and UAE paths symmetric and auditable.
 *
 * UK rates are imported from `server/config/tax-rates.ts` (the
 * pre-multi-entity file) rather than redeclared, so a rate change in
 * one place can never drift out of sync with the other. Calculation
 * helpers (e.g. `calculateCorporationTax`) continue to live in
 * `tax-rates.ts` for now — migrating them is a larger refactor
 * tracked separately.
 *
 * UAE numbers come from:
 *   - UAE Federal Tax Authority, Federal Decree-Law No. 8 of 2017 (VAT):
 *     voluntary registration threshold AED 187,500; mandatory AED
 *     375,000; standard rate 5%.
 *   - UAE Federal Tax Authority, Federal Decree-Law No. 47 of 2022
 *     (Corporate Tax): 0% on taxable income ≤ AED 375,000; 9% above.
 *     Qualifying Free Zone Persons (QFZP) that satisfy the substance
 *     requirements retain the 0% rate on qualifying income.
 */

import type { Jurisdiction } from '../../shared/api-contracts.js';
import { VAT, CORPORATION_TAX } from './tax-rates.js';

// =============================================================================
// UK thresholds (2024/25)
// =============================================================================

/** UK VAT mandatory registration threshold, pounds sterling. */
export const UK_VAT_REGISTRATION_THRESHOLD_GBP = 90_000;

// =============================================================================
// UAE thresholds (2024/25)
// =============================================================================

/** UAE voluntary VAT registration threshold, AED trailing 12 months. */
export const UAE_VAT_VOLUNTARY_AED = 187_500;

/** UAE mandatory VAT registration threshold, AED trailing 12 months. */
export const UAE_VAT_MANDATORY_AED = 375_000;

/**
 * UAE Corporate Tax small-business threshold (AED). Taxable income at
 * or below this amount sits in the 0% band regardless of QFZP status.
 */
export const UAE_CT_SMALL_BUSINESS_AED = 375_000;

// =============================================================================
// Rule shapes
// =============================================================================

export interface VatRules {
  /** Standard-rated VAT rate as a decimal (e.g. 0.2 = 20%). */
  standardRate: number;
  /**
   * Trailing-12-month income threshold beyond which registration becomes
   * mandatory. Expressed in the jurisdiction's native currency.
   */
  mandatoryRegistrationThreshold: number;
  /**
   * Optional voluntary registration threshold (UAE only for now). `null`
   * when the jurisdiction has no voluntary band.
   */
  voluntaryRegistrationThreshold: number | null;
}

export interface CorpTaxRules {
  /**
   * Top marginal CT rate — used for income above the small-business
   * threshold. UK = 0.25, UAE = 0.09.
   */
  topRate: number;
  /**
   * Small-business / lower-band rate. UK = 0.19 (marginal-relief band
   * below £250k); UAE = 0 (small-business relief ≤ AED 375k).
   */
  smallBusinessRate: number;
  /**
   * Taxable-income cutoff below which the `smallBusinessRate` applies.
   * Expressed in the jurisdiction's native currency.
   */
  smallBusinessThreshold: number;
  /**
   * UAE-specific: `true` means this jurisdiction supports a Qualifying
   * Free Zone Person (QFZP) 0% rate on qualifying income. UK is
   * `false`.
   */
  qualifyingFreeZoneSupported: boolean;
}

export interface JurisdictionTaxRules {
  jurisdiction: Jurisdiction;
  vat: VatRules;
  corpTax: CorpTaxRules;
}

// =============================================================================
// Concrete rules per jurisdiction
// =============================================================================

export const UK_TAX_RULES: JurisdictionTaxRules = {
  jurisdiction: 'UK',
  vat: {
    standardRate: VAT.RATE,
    mandatoryRegistrationThreshold: UK_VAT_REGISTRATION_THRESHOLD_GBP,
    voluntaryRegistrationThreshold: null,
  },
  corpTax: {
    topRate: CORPORATION_TAX.MAIN_RATE,
    smallBusinessRate: CORPORATION_TAX.SMALL_PROFITS_RATE,
    smallBusinessThreshold: CORPORATION_TAX.SMALL_PROFITS_THRESHOLD,
    qualifyingFreeZoneSupported: false,
  },
};

export const UAE_TAX_RULES: JurisdictionTaxRules = {
  jurisdiction: 'UAE',
  vat: {
    standardRate: 0.05,
    mandatoryRegistrationThreshold: UAE_VAT_MANDATORY_AED,
    voluntaryRegistrationThreshold: UAE_VAT_VOLUNTARY_AED,
  },
  corpTax: {
    topRate: 0.09,
    smallBusinessRate: 0,
    smallBusinessThreshold: UAE_CT_SMALL_BUSINESS_AED,
    qualifyingFreeZoneSupported: true,
  },
};

export const TAX_RULES: Record<Jurisdiction, JurisdictionTaxRules> = {
  UK: UK_TAX_RULES,
  UAE: UAE_TAX_RULES,
};

/**
 * Lookup helper keyed by `Jurisdiction`. Prefer this over importing the
 * constants directly so future `(jurisdiction, fy)` variants can slot in
 * without a call-site churn.
 */
export function getTaxRules(jurisdiction: Jurisdiction): JurisdictionTaxRules {
  return TAX_RULES[jurisdiction];
}
