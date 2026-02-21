/**
 * UK Tax Rates and Thresholds
 * 
 * These values are for the 2023/24 and 2024/25 tax years.
 * Update these when HMRC announces new rates.
 * 
 * Sources:
 * - https://www.gov.uk/corporation-tax-rates
 * - https://www.gov.uk/income-tax-rates
 * - https://www.gov.uk/tax-on-dividends
 */

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
 * Get the current VAT quarter range
 */
export function getCurrentVatQuarter(): VatQuarterRange {
  return getVatQuarterForDate(new Date());
}

/**
 * Format a Date as YYYY-MM-DD
 */
function formatDateISO(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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
 * Calculate dividend tax
 */
export function calculateDividendTax(
  dividends: number, 
  otherIncome: number = 0
): number {
  if (dividends <= DIVIDEND_TAX.ALLOWANCE) {
    return 0;
  }
  
  const taxableDividends = dividends - DIVIDEND_TAX.ALLOWANCE;
  const totalIncome = otherIncome + dividends;
  
  // Determine which band the dividends fall into
  const remainingBasicBand = Math.max(0, INCOME_TAX.BASIC_RATE_LIMIT - otherIncome);
  
  if (taxableDividends <= remainingBasicBand) {
    return taxableDividends * DIVIDEND_TAX.BASIC_RATE;
  }
  
  // Part in basic band, part in higher band
  const basicBandDividends = remainingBasicBand;
  const higherBandDividends = taxableDividends - remainingBasicBand;
  
  return (basicBandDividends * DIVIDEND_TAX.BASIC_RATE) + 
         (higherBandDividends * DIVIDEND_TAX.HIGHER_RATE);
}
