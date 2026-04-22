/**
 * Transfer Detection Patterns
 * 
 * Patterns used to identify inter-account transfers, credit card payments,
 * and bounced payments that should not be counted as real income/expenses.
 */

/**
 * Patterns that indicate a transfer rather than real income/expense
 * These are credit card/loan transactions or inter-account transfers
 */
export const TRANSFER_PATTERNS: RegExp[] = [
  /capital on tap/i,
  /barclaycard/i,
  /santander/i,             // Santander Everyday credit card payments
  /\b3062\b/,               // Santander Everyday card number fallback
  /credit card/i,
  /transfer to/i,
  /transfer from/i,
  /optional ft/i,           // Capital on Tap transfers
  /60878820/i,              // Capital on Tap reference number
  /virtualbanktransfer/i,   // Capital on Tap virtual transfers
  /draw down/i,             // Credit line draws
  /business premium sto/i,  // Barclays Savings account transfers
  /business premium/i,      // Barclays Savings (standing orders)
  /inward remittance/i,     // Emirates Islamic incoming wire transfers
  /wise/i,                  // Wise (TransferWise) cross-border transfers
  /transferwise/i,          // Legacy TransferWise name
];

/**
 * Patterns that indicate a bounced/reversed payment
 * These come back as "income" but are just failed payments returning
 */
export const BOUNCE_PATTERNS: RegExp[] = [
  /\bREV\b.*8003/i,           // Reversal with code 8003
  /8003.*insufficient/i,      // Insufficient funds bounce
  /insufficient fund/i,       // Generic insufficient funds
  /\bREV\b.*insufficient/i,   // Reversal due to insufficient
  /returned payment/i,
  /payment returned/i,
];

/**
 * SQL LIKE patterns for specific transfer queries
 */
export const TRANSFER_SQL_PATTERNS = {
  /** Capital on Tap payments */
  CAPITAL_ON_TAP: '%capital on tap%',
  
  /** Barclaycard payments */
  BARCLAYCARD: '%barclaycard%',

  /** Santander Everyday card payments */
  SANTANDER: '%santander%',

  /** Santander Everyday card reference (last 4 of card) */
  SANTANDER_REF: '%3062%',
  
  /** Virtual bank transfers */
  VIRTUAL_TRANSFER: '%virtualbanktransfer%',
  
  /** Optional FT (Capital on Tap) */
  OPTIONAL_FT: '%optional ft%',
  
  /** Capital on Tap reference */
  COT_REFERENCE: '%60878820%',
  
  /** Draw down transactions */
  DRAW_DOWN: '%draw down%',
  
  /** Barclays Savings transfers */
  BUSINESS_PREMIUM: '%business premium%',
  
  /** Bounce patterns for SQL */
  BOUNCE_REV_8003: '%REV%8003%',
  BOUNCE_8003_INSUFFICIENT: '%8003%insufficient%',
  BOUNCE_INSUFFICIENT: '%insufficient fund%',
} as const;

/**
 * Check if a description matches any transfer pattern
 */
export function isTransferDescription(description: string): boolean {
  return TRANSFER_PATTERNS.some(pattern => pattern.test(description));
}

/**
 * Check if a description indicates a bounced payment
 */
export function isBounceDescription(description: string): boolean {
  return BOUNCE_PATTERNS.some(pattern => pattern.test(description));
}

/**
 * Description patterns that unconditionally disqualify a transaction
 * from inter-company pair detection, regardless of how well the amount
 * or date happens to line up on the other side.
 *
 * Rationale: the pair-finder keys purely off amount × currency × date
 * tolerance. That's sufficient for actual cross-border movements
 * (Wise → Emirates Islamic, etc.) but coincidences do happen — a
 * Barclays dividend debit to a NatWest personal account can align
 * within ±5 days and (post-FX) ±20% of a genuine EI inward remittance.
 * When the description screams "this is not a cross-entity transfer"
 * (DIVIDEND payments, SALARY / PAYE runs, HMRC tax debits) we bail out
 * rather than surface a false-positive pair in the Warnings tab.
 *
 * Applied on BOTH sides — an expense OR income match is enough to
 * disqualify the candidate pair. Consumed by
 * {@link server/domain/inter-company/pair-finder.ts::findInterCompanyPairs}.
 */
export const INTER_COMPANY_EXCLUSION_PATTERNS: RegExp[] = [
  /\bDIVIDENDS?\b/i,
  /\bSALARY\b|\bPAYROLL\b|\bPAYE\b/i,
  /\bHMRC\b|VAT RETURN|CORPORATION TAX/i,
];

/** `true` iff the description matches any `INTER_COMPANY_EXCLUSION_PATTERNS` entry. */
export function isInterCompanyExcludedDescription(description: string): boolean {
  return INTER_COMPANY_EXCLUSION_PATTERNS.some(p => p.test(description));
}

/**
 * How many days apart transactions can be to be considered a transfer pair
 */
export const TRANSFER_DATE_TOLERANCE_DAYS = 5;

/**
 * Fractional amount tolerance when pairing two sides of a transfer
 * that cross a currency boundary. The absolute difference after FX
 * conversion must sit within this fraction of the target-currency
 * amount, otherwise the candidates are considered unrelated.
 *
 * 20% covers the realistic spread: interbank rates vs. retail
 * spreads, Wise vs. SWIFT fees, timing-gap rate drift between the
 * debit and credit sides. Tightening it would start dropping real
 * pairs; loosening would start pairing coincidences. Used by both
 * {@link detectTransfers} (within-entity) and the Phase 8
 * inter-company pair finder so the two heuristics cannot drift.
 */
export const CROSS_CURRENCY_TOLERANCE = 0.20;
