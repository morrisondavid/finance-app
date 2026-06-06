/**
 * Shared §1.9 credit-card term helpers — APR, minimum payment, and
 * whether carrying routine recurring spend on the card is costly vs
 * paying from a debit/current account.
 */

import type { AccountConfig } from './schema.js';
import type { CreditCardConfig } from './schema.js';

/** Typical UK card minimum when terms are unknown. */
export const DEFAULT_MIN_PAYMENT_PCT = 0.02;

/** Floor used in refinance simulation when the card has no configured floor. */
export const DEFAULT_MIN_PAYMENT_FLOOR_GBP = 25;

/**
 * Minimum payment % above which routine recurring spend on the card is
 * considered costly (Capital on Tap is 10%; many UK cards are ~2%).
 */
export const COSTLY_REVOLVING_MIN_PAYMENT_PCT = 0.03;

/** Standard APR at or above which revolving routine spend is costly. */
export const COSTLY_REVOLVING_STANDARD_APR = 0.05;

export function effectiveMinPaymentPct(cfg: CreditCardConfig): number {
  return cfg.minPaymentPct ?? cfg.promo?.minPaymentPct ?? DEFAULT_MIN_PAYMENT_PCT;
}

export function effectiveMinPaymentFloorGbp(cfg: CreditCardConfig): number {
  return cfg.minPaymentFloorGbp ?? DEFAULT_MIN_PAYMENT_FLOOR_GBP;
}

export function isCostlyRevolvingCreditCard(cfg: CreditCardConfig): boolean {
  return (
    effectiveMinPaymentPct(cfg) >= COSTLY_REVOLVING_MIN_PAYMENT_PCT ||
    cfg.standardApr >= COSTLY_REVOLVING_STANDARD_APR
  );
}

/**
 * Best-effort debit/current account to pay routine bills from instead of
 * a credit card — same entity for business cards, personal current for
 * personal cards.
 */
export function preferredOutgoingAccountForCard(
  card: AccountConfig,
  accounts: readonly AccountConfig[],
): AccountConfig | null {
  if (card.type !== 'credit-card') return null;

  const matchesScope = (candidate: AccountConfig): boolean => {
    if (card.category === 'personal') {
      return candidate.category === 'personal';
    }
    return candidate.category === 'business' && candidate.entityId === card.entityId;
  };

  const isPayableNonCard = (candidate: AccountConfig): boolean =>
    candidate.name !== card.name &&
    candidate.canMakeOutgoingPayments &&
    candidate.type !== 'credit-card' &&
    matchesScope(candidate);

  const current = accounts.find(a => isPayableNonCard(a) && a.type === 'current');
  if (current !== undefined) return current;

  return accounts.find(isPayableNonCard) ?? null;
}

export function fmtAprPct(decimal: number): string {
  return `${(decimal * 100).toFixed(2).replace(/\.?0+$/, '')}%`;
}

export function fmtMinPaymentPct(decimal: number): string {
  return `${Math.round(decimal * 100)}%`;
}
