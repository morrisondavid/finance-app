/**
 * Tax Rates and Thresholds (UK + UAE)
 *
 * These values are for the 2023/24 and 2024/25 tax years (UK) and the
 * post-2023 UAE Corporate Tax regime. Update these when HMRC / the UAE
 * Federal Tax Authority announces new rates.
 *
 * Sources:
 * - https://www.gov.uk/corporation-tax-rates
 * - https://www.gov.uk/income-tax-rates
 * - https://www.gov.uk/tax-on-dividends
 * - https://tax.gov.ae/en/taxes/corporate.tax.aspx
 */

import { formatDateISO } from '../../shared/date-format.js';
import type { Company } from '../../shared/api-contracts.js';

// =============================================================================
// VAT
// =============================================================================

export const VAT = {
  /** Standard VAT rate */
  RATE: 0.2,
  
  /** VAT fraction for VAT-inclusive amounts (20/120 = 1/6) */
  FRACTION: 1 / 6,
} as const;

/**
 * VAT Quarters - Stagger 2
 * 
 * Quarters are calendar-based, NOT aligned to company financial year.
 * Payment due on the 7th of the 2nd month after quarter end.
 * 
 * Based on accountant's request for Aug-Oct statements with Dec 7 due date:
 * - Dec payment covers Aug-Oct (Q4)
 * - Mar payment covers Nov-Jan (Q1)
 * - Jun payment covers Feb-Apr (Q2)
 * - Sep payment covers May-Jul (Q3)
 */
export const VAT_QUARTERS = {
  /** Stagger 2 quarter definitions (month is 0-indexed) */
  STAGGER_2: [
    { quarter: 1, startMonth: 10, endMonth: 0, label: 'Nov-Jan' },   // Nov 1 - Jan 31
    { quarter: 2, startMonth: 1, endMonth: 3, label: 'Feb-Apr' },    // Feb 1 - Apr 30
    { quarter: 3, startMonth: 4, endMonth: 6, label: 'May-Jul' },    // May 1 - Jul 31
    { quarter: 4, startMonth: 7, endMonth: 9, label: 'Aug-Oct' },    // Aug 1 - Oct 31
  ],
} as const;

export interface VatQuarterRange {
  startDate: string;  // YYYY-MM-DD
  endDate: string;    // YYYY-MM-DD
  dueDate: string;    // YYYY-MM-DD
  label: string;      // e.g., "Nov-Jan 2025/26"
  quarter: number;    // 1-4
}

/**
 * Get the VAT quarter range for a given date
 * Uses Stagger 2: Nov-Jan, Feb-Apr, May-Jul, Aug-Oct
 */
export function getVatQuarterForDate(date: Date = new Date()): VatQuarterRange {
  const month = date.getMonth(); // 0-indexed
  const year = date.getFullYear();
  
  // Determine which quarter this month falls into (Stagger 2)
  // Nov-Jan (months 10, 11, 0) = Q1
  // Feb-Apr (months 1, 2, 3) = Q2
  // May-Jul (months 4, 5, 6) = Q3
  // Aug-Oct (months 7, 8, 9) = Q4
  
  let quarterDef;
  let startYear: number;
  let endYear: number;
  
  if (month >= 10) {
    // Nov-Dec: Q1, starts this year, ends next year
    quarterDef = VAT_QUARTERS.STAGGER_2[0];
    startYear = year;
    endYear = year + 1;
  } else if (month <= 0) {
    // Jan: Q1, started last year, ends this year
    quarterDef = VAT_QUARTERS.STAGGER_2[0];
    startYear = year - 1;
    endYear = year;
  } else if (month >= 1 && month <= 3) {
    // Feb-Apr: Q2
    quarterDef = VAT_QUARTERS.STAGGER_2[1];
    startYear = year;
    endYear = year;
  } else if (month >= 4 && month <= 6) {
    // May-Jul: Q3
    quarterDef = VAT_QUARTERS.STAGGER_2[2];
    startYear = year;
    endYear = year;
  } else {
    // Aug-Oct: Q4
    quarterDef = VAT_QUARTERS.STAGGER_2[3];
    startYear = year;
    endYear = year;
  }
  
  // Calculate start date
  const startDate = new Date(startYear, quarterDef.startMonth, 1);
  
  // Calculate end date (last day of end month)
  const endDate = new Date(endYear, quarterDef.endMonth + 1, 0);
  
  // Calculate due date (7th of the 2nd month after quarter end)
  // e.g., Q4 ends Oct 31 -> due Dec 7; Q1 ends Jan 31 -> due Mar 7
  const dueDate = new Date(endDate);
  dueDate.setDate(1);  // Set to 1st to avoid month overflow issues
  dueDate.setMonth(dueDate.getMonth() + 2);
  dueDate.setDate(7);
  
  // Format label - Q1 spans years (Nov-Jan), others are same year
  const labelYear = quarterDef.quarter === 1 
    ? `${startYear}/${String(endYear).slice(-2)}`
    : String(endYear);
  
  return {
    startDate: formatDateISO(startDate),
    endDate: formatDateISO(endDate),
    dueDate: formatDateISO(dueDate),
    label: `${quarterDef.label} ${labelYear}`,
    quarter: quarterDef.quarter,
  };
}

/**
 * Get the outstanding VAT quarter -- the one whose filing deadline is next.
 * If the previous quarter's due date hasn't passed, return it (it still needs filing).
 * Otherwise return the current quarter.
 */
export function getCurrentVatQuarter(): VatQuarterRange {
  const now = new Date();
  const currentQuarter = getVatQuarterForDate(now);
  
  const previousQuarterDate = new Date(currentQuarter.startDate);
  previousQuarterDate.setDate(previousQuarterDate.getDate() - 1);
  const previousQuarter = getVatQuarterForDate(previousQuarterDate);
  
  if (now <= new Date(previousQuarter.dueDate)) {
    return previousQuarter;
  }
  
  return currentQuarter;
}

// =============================================================================
// Corporation Tax (2023/24 onwards)
// =============================================================================

export const CORPORATION_TAX = {
  /** Small profits rate (19%) - for profits up to £50,000 */
  SMALL_PROFITS_RATE: 0.19,
  
  /** Main rate (25%) - for profits over £250,000 */
  MAIN_RATE: 0.25,
  
  /** Small profits threshold */
  SMALL_PROFITS_THRESHOLD: 50000,
  
  /** Main rate threshold */
  MAIN_RATE_THRESHOLD: 250000,
  
  /** Marginal relief fraction (3/200) for profits between thresholds */
  MARGINAL_RELIEF_FRACTION: 3 / 200,
} as const;

// =============================================================================
// UAE Corporation Tax (post-2023 regime)
// =============================================================================

export const UAE_CORPORATION_TAX = {
  /** QFZP (Qualifying Free Zone Person) qualifying-income rate. */
  QUALIFYING_RATE: 0,

  /** Non-qualifying / above-threshold rate. */
  NON_QUALIFYING_RATE: 0.09,
} as const;

// =============================================================================
// Income Tax (2023/24)
// =============================================================================

export const INCOME_TAX = {
  /** Personal allowance - tax-free income */
  PERSONAL_ALLOWANCE: 12570,
  
  /** Basic rate band upper limit */
  BASIC_RATE_LIMIT: 50270,
  
  /** Higher rate band upper limit */
  HIGHER_RATE_LIMIT: 125140,
  
  /** Basic rate (20%) */
  BASIC_RATE: 0.2,
  
  /** Higher rate (40%) */
  HIGHER_RATE: 0.4,
  
  /** Additional rate (45%) */
  ADDITIONAL_RATE: 0.45,
} as const;

// =============================================================================
// National Insurance (2023/24)
// =============================================================================

export const NATIONAL_INSURANCE = {
  /** Primary threshold (annual) - NI starts above this */
  PRIMARY_THRESHOLD: 12570,
  
  /** Upper earnings limit (annual) */
  UPPER_EARNINGS_LIMIT: 50270,
  
  /** Main rate (12%) between primary threshold and UEL */
  MAIN_RATE: 0.12,
  
  /** Additional rate (2%) above UEL */
  ADDITIONAL_RATE: 0.02,
} as const;

// =============================================================================
// Dividend Tax (2023/24)
// =============================================================================

export const DIVIDEND_TAX = {
  /** Dividend allowance - tax-free dividends */
  ALLOWANCE: 1000,
  
  /** Basic rate (8.75%) */
  BASIC_RATE: 0.0875,
  
  /** Higher rate (33.75%) */
  HIGHER_RATE: 0.3375,
  
  /** Additional rate (39.35%) */
  ADDITIONAL_RATE: 0.3935,
} as const;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Calculate corporation tax using marginal relief formula
 */
export function calculateCorporationTax(taxableProfit: number): { tax: number; effectiveRate: number } {
  if (taxableProfit <= 0) {
    return { tax: 0, effectiveRate: 0 };
  }
  
  if (taxableProfit <= CORPORATION_TAX.SMALL_PROFITS_THRESHOLD) {
    return {
      tax: taxableProfit * CORPORATION_TAX.SMALL_PROFITS_RATE,
      effectiveRate: CORPORATION_TAX.SMALL_PROFITS_RATE,
    };
  }
  
  if (taxableProfit >= CORPORATION_TAX.MAIN_RATE_THRESHOLD) {
    return {
      tax: taxableProfit * CORPORATION_TAX.MAIN_RATE,
      effectiveRate: CORPORATION_TAX.MAIN_RATE,
    };
  }
  
  // Marginal relief calculation
  // Tax = 25% of profit - (250000 - profit) * 3/200
  const tax = (taxableProfit * CORPORATION_TAX.MAIN_RATE) - 
    ((CORPORATION_TAX.MAIN_RATE_THRESHOLD - taxableProfit) * CORPORATION_TAX.MARGINAL_RELIEF_FRACTION);
  
  return {
    tax,
    effectiveRate: tax / taxableProfit,
  };
}

/**
 * Income Tax band widths derived from the headline thresholds. Centralised
 * so both dividend and non-dividend allocators consume the same figures.
 */
function getIncomeTaxBandWidths(): { basic: number; higher: number } {
  return {
    basic: INCOME_TAX.BASIC_RATE_LIMIT - INCOME_TAX.PERSONAL_ALLOWANCE,
    higher: INCOME_TAX.HIGHER_RATE_LIMIT - INCOME_TAX.BASIC_RATE_LIMIT,
  };
}

/**
 * Allocate `amount` across the basic/higher/additional rate bands, given
 * how much of each band has already been consumed by earlier income (in
 * HMRC ordering, salary is taxed before dividends).
 *
 * Returns the monetary total in each band. Assumes inputs are annual.
 */
function allocateAcrossBands(
  amount: number,
  consumed: { basic: number; higher: number },
): { atBasic: number; atHigher: number; atAdditional: number } {
  const bandWidths = getIncomeTaxBandWidths();
  const basicLeft = Math.max(0, bandWidths.basic - consumed.basic);
  const higherLeft = Math.max(0, bandWidths.higher - consumed.higher);

  let remainder = Math.max(0, amount);
  const atBasic = Math.min(remainder, basicLeft);
  remainder -= atBasic;
  const atHigher = Math.min(remainder, higherLeft);
  remainder -= atHigher;
  const atAdditional = remainder;

  return { atBasic, atHigher, atAdditional };
}

/**
 * Estimate income tax on dividends (outside PAYE) for a UK taxpayer.
 *
 * Model (aligned with common HMRC ordering):
 * - Personal allowance is applied to salary first; any unused PA reduces dividend income
 *   (after the dividend allowance) before rate bands.
 * - Salary uses basic then higher then additional rate bands; taxable dividends stack on top.
 * - Amounts should be annual (or the same period for both); bank salary lines are often net pay,
 *   so treat as an indicative estimate.
 */
export function calculateDividendTax(dividends: number, salary: number = 0): number {
  if (dividends <= DIVIDEND_TAX.ALLOWANCE) {
    return 0;
  }

  const pa = INCOME_TAX.PERSONAL_ALLOWANCE;
  const bandWidths = getIncomeTaxBandWidths();

  const taxableSalary = Math.max(0, salary - pa);
  const salaryInBasic = Math.min(taxableSalary, bandWidths.basic);
  const salaryBeyondBasic = Math.max(0, taxableSalary - bandWidths.basic);
  const salaryInHigher = Math.min(salaryBeyondBasic, bandWidths.higher);

  const unusedPa = Math.max(0, pa - salary);

  const afterDividendAllowance = dividends - DIVIDEND_TAX.ALLOWANCE;
  const taxableDividends = Math.max(0, afterDividendAllowance - unusedPa);

  const { atBasic, atHigher, atAdditional } = allocateAcrossBands(
    taxableDividends,
    { basic: salaryInBasic, higher: salaryInHigher },
  );

  return (
    atBasic * DIVIDEND_TAX.BASIC_RATE +
    atHigher * DIVIDEND_TAX.HIGHER_RATE +
    atAdditional * DIVIDEND_TAX.ADDITIONAL_RATE
  );
}

/**
 * Estimate income tax on a slice of non-dividend, non-PAYE income (e.g. rental
 * profit) stacking on top of the given `salaryAlreadyTaxed`. Uses the same
 * band ordering as dividends except dividend allowance/rates do not apply.
 *
 * All amounts are treated as annual figures.
 */
export function calculateIncomeTaxOnNonDividend(
  amount: number,
  salaryAlreadyTaxed: number = 0,
): number {
  if (amount <= 0) return 0;

  const pa = INCOME_TAX.PERSONAL_ALLOWANCE;
  const bandWidths = getIncomeTaxBandWidths();

  const taxableSalary = Math.max(0, salaryAlreadyTaxed - pa);
  const salaryInBasic = Math.min(taxableSalary, bandWidths.basic);
  const salaryInHigher = Math.min(
    Math.max(0, taxableSalary - bandWidths.basic),
    bandWidths.higher,
  );

  const unusedPa = Math.max(0, pa - salaryAlreadyTaxed);
  const taxable = Math.max(0, amount - unusedPa);

  const { atBasic, atHigher, atAdditional } = allocateAcrossBands(
    taxable,
    { basic: salaryInBasic, higher: salaryInHigher },
  );

  return (
    atBasic * INCOME_TAX.BASIC_RATE +
    atHigher * INCOME_TAX.HIGHER_RATE +
    atAdditional * INCOME_TAX.ADDITIONAL_RATE
  );
}

// =============================================================================
// Retained-after-claims reserves (forward-looking "this is the company's")
// =============================================================================

/**
 * Shape of the per-entity claim stack surfaced on the Contracts-tab
 * aggregate banner. `retained_period` is the figure we want users to
 * anchor on — what the company actually keeps after the two claims
 * that were never theirs (VAT in transit to HMRC, CT to be paid on
 * future return).
 *
 * All four monetary figures share the company's invoice currency, and
 * reconcile: `incoming_period_total === retained_period + vat_reserve_period + ct_reserve_period`.
 */
export interface RetainedClaim {
  /** Net fees + VAT (what actually lands in the bank account). */
  readonly incoming_period_total: number;
  /** VAT portion of `incoming_period_total`. Zero if the entity is not VAT-registered. */
  readonly vat_reserve_period: number;
  /**
   * Corporation Tax reserve on **net** revenue — flat pessimistic
   * buffer. UK Ltd uses {@link CORPORATION_TAX.MAIN_RATE}; UAE FZCO
   * uses {@link UAE_CORPORATION_TAX} (qualifying or non-qualifying
   * depending on `qfzp_elected`).
   */
  readonly ct_reserve_period: number;
  /** `incoming_period_total − vat_reserve_period − ct_reserve_period`. */
  readonly retained_period: number;
  /** Applied CT rate (e.g. 0.25, 0.09, 0). Surfaced so the UI can render the label. */
  readonly ct_rate_applied: number;
  /** Applied VAT rate (0.2 when registered, else 0). */
  readonly vat_rate_applied: number;
}

/**
 * Compute the claim stack for a single entity given its projected
 * **net** revenue for the period.
 *
 * Rules:
 *   - VAT: apply {@link VAT.RATE} when the company is UK Ltd and
 *     `vat_registered === true` (strict — `TBC` does not apply VAT).
 *   - UK Ltd CT reserve: flat {@link CORPORATION_TAX.MAIN_RATE}. This
 *     is the conservative forward-looking bucket, distinct from the
 *     marginal-relief engine in {@link calculateCorporationTax}.
 *   - UAE FZCO CT reserve: {@link UAE_CORPORATION_TAX.QUALIFYING_RATE}
 *     when `qfzp_elected === true` (QFZP qualifying income), else
 *     {@link UAE_CORPORATION_TAX.NON_QUALIFYING_RATE}.
 *   - Retained = incoming − VAT − CT reserve.
 */
/**
 * Resolve the VAT rate that should be added to an invoice issued by
 * `company`. UK-registered suppliers charge {@link VAT.RATE}; all
 * other permutations (UK unregistered, UK TBC, FZCO) charge 0.
 *
 * Single source of truth shared by {@link calculateRetainedReserves}
 * (aggregate accrual banner) and the §1.3 invoice generator (draft
 * + issued invoices). Keeping this rule in one place means the
 * "incoming" figure the user sees in the Contracts tab and the
 * invoice total the client receives can never drift apart.
 */
export function resolveInvoiceVatRate(company: Company): number {
  return company.jurisdiction === 'UK' && company.vat_registered === true
    ? VAT.RATE
    : 0;
}

export function calculateRetainedReserves(
  projectedNet: number,
  company: Company,
): RetainedClaim {
  const netFloor = Math.max(0, projectedNet);

  const vatRate = resolveInvoiceVatRate(company);

  const ctRate =
    company.jurisdiction === 'UK'
      ? CORPORATION_TAX.MAIN_RATE
      : company.qfzp_elected === true
        ? UAE_CORPORATION_TAX.QUALIFYING_RATE
        : UAE_CORPORATION_TAX.NON_QUALIFYING_RATE;

  const vatReserve = netFloor * vatRate;
  const incoming = netFloor + vatReserve;
  const ctReserve = netFloor * ctRate;
  const retained = incoming - vatReserve - ctReserve;

  return {
    incoming_period_total: incoming,
    vat_reserve_period: vatReserve,
    ct_reserve_period: ctReserve,
    retained_period: retained,
    ct_rate_applied: ctRate,
    vat_rate_applied: vatRate,
  };
}
