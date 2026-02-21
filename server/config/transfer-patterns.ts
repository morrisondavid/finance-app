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
  /credit card/i,
  /transfer to/i,
  /transfer from/i,
  /optional ft/i,           // Capital on Tap transfers
  /60878820/i,              // Capital on Tap reference number
  /virtualbanktransfer/i,   // Capital on Tap virtual transfers
  /draw down/i,             // Credit line draws
  /business premium sto/i,  // Barclays Savings account transfers
  /business premium/i,      // Barclays Savings (standing orders)
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
 * How many days apart transactions can be to be considered a transfer pair
 */
export const TRANSFER_DATE_TOLERANCE_DAYS = 5;
