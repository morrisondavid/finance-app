/**
 * Transfer detection — re-exports canonical pairing/bounce regexes from the merchants domain
 * plus inter-company exclusions and shared tolerances.
 *
 * Pairing patterns are defined in {@link ../domain/merchants/transfer-pairing-seeds.ts} so
 * `STATIC_MERCHANT_DATA` can share the same `RegExp` instances where categorization must align.
 */

import {
  PAIRING_TRANSFER_PATTERNS,
  BOUNCE_PATTERNS,
  isPairingTransferDescription,
  isBounceDescription as isBounceDescriptionFromSeeds,
  bounceDescriptionSqlPrefilter,
} from '../domain/merchants/transfer-pairing-seeds.js';

/** Alias of {@link PAIRING_TRANSFER_PATTERNS} for older imports (`transactions.test`, *etc.*). */
export const TRANSFER_PATTERNS: readonly RegExp[] = PAIRING_TRANSFER_PATTERNS;

export { PAIRING_TRANSFER_PATTERNS, BOUNCE_PATTERNS, bounceDescriptionSqlPrefilter };

/**
 * Check if a description matches any transfer pattern (pairing / institutional movement shape).
 */
export function isTransferDescription(description: string): boolean {
  return isPairingTransferDescription(description);
}

/**
 * Check if a description indicates a bounced/reversed payment
 */
export function isBounceDescription(description: string): boolean {
  return isBounceDescriptionFromSeeds(description);
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
