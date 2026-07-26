/**
 * Canonical seeds for transfer **pairing** (`isTransferLikeDescription` / `detectTransfers`)
 * and for `STATIC_MERCHANT_DATA` rows where the regex must stay identical to pairing.
 *
 * ## Pairing vs categorization (dual role)
 *
 * - **Pairing** uses `PAIRING_TRANSFER_PATTERNS` — a superset that includes institutional /
 *   card-payment shapes that often categorize as **Debt Repayment** in merchants (Capital on Tap,
 *   Barclaycard, Santander). Those rows intentionally do **not** import from here; pairing must
 *   still see them via this list.
 * - **Categorization** is first-match over the full merchants registry (order load-bearing). Only
 *   a subset of **Transfers** lines reference these exports. Other Transfers matchers (MONZO JOINT,
 *   person-derived aliases, VIA MOBILE, *etc.*) live only in {@link ./data.ts}.
 *
 * ## Audit matrix (high level)
 *
 * | Area | Pairing-only | Shared seeds | Merchants-only (Transfers / other) |
 * |------|----------------|--------------|--------------------------------------|
 * | Card / rail strings | — | Capital on Tap, Barclaycard, Santander, 3062, credit card, optional FT, COT ref, virtual transfer, draw down, business premium, inward remittance, Wise + TransferWise | Debt Repayment rows duplicate some substrings for category label |
 * | Inter-account copy | transfer to/from | — | — |
 * | Internal / Barclays | business premium variants | BARCLAYS…STO \| BUSINESS PREMIUM STO (merchants row) | — |
 *
 * @module
 */

export const REGEX_CAPITAL_ON_TAP = /capital on tap/i;
export const REGEX_BARCLAYCARD = /barclaycard/i;
export const REGEX_SANTANDER = /santander/i;
export const REGEX_SANTANDER_CARD_REF = /\b3062\b/;
export const REGEX_CREDIT_CARD = /credit card/i;
export const REGEX_TRANSFER_TO = /transfer to/i;
export const REGEX_TRANSFER_FROM = /transfer from/i;
export const REGEX_OPTIONAL_FT = /optional ft/i;
export const REGEX_COT_REF = /60878820/i;
export const REGEX_VIRTUAL_BANK_TRANSFER = /virtualbanktransfer/i;
/** Shared with merchants Transfers row “Credit line drawdown”. */
export const REGEX_DRAW_DOWN = /\bDRAW\s*DOWN\b/i;
export const REGEX_BUSINESS_PREMIUM_STO = /business premium sto/i;
export const REGEX_BUSINESS_PREMIUM = /business premium/i;
export const REGEX_INWARD_REMITTANCE = /inward remittance/i;
export const REGEX_WISE = /wise/i;
export const REGEX_TRANSFERWISE = /transferwise/i;

/**
 * Monzo P2P transfer from the monzo-david personal account to monzo-joint.
 * The description is the registered account-holder name on the sending side.
 * Treated as a single-leg transfer (orphan income) until monzo-david is
 * linked and the expense leg is ingested.
 */
export const REGEX_DAVID_MORRISON_HEENA_TAILOR = /david morrison & heena tailor/i;

/**
 * Merchants **Transfers** row for Barclays savings / standing-order style copy.
 * Pairing still relies on {@link REGEX_BUSINESS_PREMIUM_STO} and {@link REGEX_BUSINESS_PREMIUM}
 * for other “Business Premium” strings.
 */
export const REGEX_MERCHANT_BARCLAYS_PREMIUM_LINE = /BARCLAYS .*STO|BUSINESS PREMIUM STO/i;

/** Merchants **Transfers** row label for Wise (pairing also matches `/wise/i`). */
export const REGEX_MERCHANT_TRANSFERWISE = /TRANSFERWISE/i;

/**
 * Ordered aggregate for pairing — sequence is not semantically load-bearing (`.some`).
 */
export const PAIRING_TRANSFER_PATTERNS: readonly RegExp[] = [
  REGEX_CAPITAL_ON_TAP,
  REGEX_BARCLAYCARD,
  REGEX_SANTANDER,
  REGEX_SANTANDER_CARD_REF,
  REGEX_CREDIT_CARD,
  REGEX_TRANSFER_TO,
  REGEX_TRANSFER_FROM,
  REGEX_OPTIONAL_FT,
  REGEX_COT_REF,
  REGEX_VIRTUAL_BANK_TRANSFER,
  REGEX_DRAW_DOWN,
  REGEX_BUSINESS_PREMIUM_STO,
  REGEX_BUSINESS_PREMIUM,
  REGEX_INWARD_REMITTANCE,
  REGEX_WISE,
  REGEX_TRANSFERWISE,
  REGEX_DAVID_MORRISON_HEENA_TAILOR,
];

export const BOUNCE_PATTERNS: readonly RegExp[] = [
  /\bREV\b.*8003/i,
  /8003.*insufficient/i,
  /insufficient fund/i,
  /\bREV\b.*insufficient/i,
  /returned payment/i,
  /payment returned/i,
];

export function isPairingTransferDescription(description: string): boolean {
  return PAIRING_TRANSFER_PATTERNS.some(p => p.test(description));
}

export function isBounceDescription(description: string): boolean {
  return BOUNCE_PATTERNS.some(p => p.test(description));
}

/**
 * Broad SQLite `OR` fragment for `detectTransfers` step 1b — reduces full-table scans while
 * {@link isBounceDescription} remains the source of truth.
 */
export function bounceDescriptionSqlPrefilter(): string {
  return `(
      description LIKE '%REV%8003%'
      OR description LIKE '%8003%insufficient%'
      OR description LIKE '%insufficient fund%'
      OR description LIKE '%REV%insufficient%'
      OR description LIKE '%returned payment%'
      OR description LIKE '%payment returned%'
    )`;
}
