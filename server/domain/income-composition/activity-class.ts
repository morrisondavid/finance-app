/**
 * Income activity classification — the metadata that drives the
 * active vs passive breakdown in §1.7's metrics.
 *
 * "Active" = income that stops the moment you stop showing up
 * (contracting, day-rate work). "Passive" = income from sources that
 * don't require your daily presence (rentals, dividends, interest).
 * `semi-passive` is reserved for future use (SaaS MRR, royalties on a
 * launched product) — no current source qualifies.
 *
 * The map lives in code, not a CSV: it's a property of the *kind* of
 * income source, not of any individual row. A retainer-shaped contract
 * that genuinely doesn't require active work would override this on its
 * own contract row, deferred until one exists.
 */

export type ActivityClass = 'active' | 'semi-passive' | 'passive';

export type IncomeKind = 'contract' | 'rental-income' | 'recurring-detected';

export const INCOME_ACTIVITY_CLASS: Record<IncomeKind, ActivityClass> = {
  contract: 'active',
  'rental-income': 'passive',
  'recurring-detected': 'passive',
};
