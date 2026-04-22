import { describe, it, expect } from 'vitest';
import {
  getTaxRules,
  TAX_RULES,
  UK_TAX_RULES,
  UAE_TAX_RULES,
  UK_VAT_REGISTRATION_THRESHOLD_GBP,
  UAE_VAT_VOLUNTARY_AED,
  UAE_VAT_MANDATORY_AED,
  UAE_CT_SMALL_BUSINESS_AED,
} from './tax-rules.js';

describe('getTaxRules', () => {
  it('returns the UK ruleset for jurisdiction=UK', () => {
    const rules = getTaxRules('UK');
    expect(rules).toBe(UK_TAX_RULES);
    expect(rules.jurisdiction).toBe('UK');
  });

  it('returns the UAE ruleset for jurisdiction=UAE', () => {
    const rules = getTaxRules('UAE');
    expect(rules).toBe(UAE_TAX_RULES);
    expect(rules.jurisdiction).toBe('UAE');
  });

  it('is a total function — every Jurisdiction has an entry in TAX_RULES', () => {
    for (const j of ['UK', 'UAE'] as const) {
      expect(TAX_RULES[j]).toBeDefined();
      expect(TAX_RULES[j].jurisdiction).toBe(j);
    }
  });
});

describe('UK_TAX_RULES', () => {
  it('declares VAT 20% standard-rated', () => {
    expect(UK_TAX_RULES.vat.standardRate).toBe(0.2);
  });

  it('declares the VAT mandatory registration threshold', () => {
    expect(UK_TAX_RULES.vat.mandatoryRegistrationThreshold).toBe(
      UK_VAT_REGISTRATION_THRESHOLD_GBP,
    );
    expect(UK_VAT_REGISTRATION_THRESHOLD_GBP).toBe(90_000);
  });

  it('has no voluntary VAT threshold — UK has no voluntary band at this level', () => {
    expect(UK_TAX_RULES.vat.voluntaryRegistrationThreshold).toBeNull();
  });

  it('declares the 19% / 25% CT bands', () => {
    expect(UK_TAX_RULES.corpTax.smallBusinessRate).toBe(0.19);
    expect(UK_TAX_RULES.corpTax.topRate).toBe(0.25);
  });

  it('does NOT support qualifying-free-zone relief', () => {
    expect(UK_TAX_RULES.corpTax.qualifyingFreeZoneSupported).toBe(false);
  });
});

describe('UAE_TAX_RULES', () => {
  it('declares VAT 5% standard-rated', () => {
    expect(UAE_TAX_RULES.vat.standardRate).toBe(0.05);
  });

  it('declares the AED mandatory VAT threshold', () => {
    expect(UAE_TAX_RULES.vat.mandatoryRegistrationThreshold).toBe(UAE_VAT_MANDATORY_AED);
    expect(UAE_VAT_MANDATORY_AED).toBe(375_000);
  });

  it('declares the AED voluntary VAT threshold', () => {
    expect(UAE_TAX_RULES.vat.voluntaryRegistrationThreshold).toBe(UAE_VAT_VOLUNTARY_AED);
    expect(UAE_VAT_VOLUNTARY_AED).toBe(187_500);
  });

  it('declares the 0%/9% CT bands with AED 375k small-business cutoff', () => {
    expect(UAE_TAX_RULES.corpTax.smallBusinessRate).toBe(0);
    expect(UAE_TAX_RULES.corpTax.topRate).toBe(0.09);
    expect(UAE_TAX_RULES.corpTax.smallBusinessThreshold).toBe(UAE_CT_SMALL_BUSINESS_AED);
    expect(UAE_CT_SMALL_BUSINESS_AED).toBe(375_000);
  });

  it('supports qualifying-free-zone relief', () => {
    expect(UAE_TAX_RULES.corpTax.qualifyingFreeZoneSupported).toBe(true);
  });
});

describe('cross-jurisdiction invariants', () => {
  it('UK and UAE rulesets are distinct object identities', () => {
    expect(UK_TAX_RULES).not.toBe(UAE_TAX_RULES);
  });

  it('UK and UAE VAT rates are different (prevents accidental single-rate coupling)', () => {
    expect(UK_TAX_RULES.vat.standardRate).not.toBe(UAE_TAX_RULES.vat.standardRate);
  });

  it('UK and UAE CT top rates are different (prevents accidental single-rate coupling)', () => {
    expect(UK_TAX_RULES.corpTax.topRate).not.toBe(UAE_TAX_RULES.corpTax.topRate);
  });
});
