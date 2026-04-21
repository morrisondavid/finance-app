/**
 * Payee Configuration
 *
 * Derives director records from the obligations registry (the single source
 * of truth for salary figures) and defines the HMRC payment narratives used
 * to match settlement payments. Director identity (name, display label,
 * aliases) comes from `people.ts` — this file only glues the two together
 * for consumers that need "the people with a monthly salary obligation".
 */

import {
  getPerson,
  personNamePattern,
  personShortName,
  type Person,
  type PersonId,
} from './people.js';
import { getObligationRegistry } from '../domain/obligations/registry.js';

/**
 * Fallback pence-level drift tolerance when a payroll obligation omits its
 * own. Real payroll rarely moves by more than a pound or two so £10 absorbs
 * rounding noise without swallowing dividend-sized payments.
 */
const DEFAULT_SALARY_TOLERANCE = 10;

/**
 * Fully-hydrated director record. Merges Person identity with salary
 * obligation data and derives the pattern / label / code fields that were
 * previously hand-written. Adding a new director is a one-line change in
 * people.ts plus a payroll row in `obligations/obligations-seed.csv`, never
 * six separate configs.
 */
export interface Director extends Person {
  readonly personId: PersonId;
  /** Monthly salary figure (the tax-optimal amount paid via PAYE). */
  readonly monthlySalary: number;
  /** Pence drift tolerance from the payroll obligation (or the fallback). */
  readonly tolerance: number;
  /** SQL LIKE pattern derived from Person.name. */
  readonly namePattern: string;
  /** Human label for the dashboard personal-tax card. */
  readonly label: string;
  /** Short UI badge code (e.g. "DA", "HE"). */
  readonly code: string;
}

/**
 * Every person with a payroll obligation on file. Sourced from the
 * obligations registry so the salary figure lives in exactly one place —
 * `obligations/obligations-seed.csv`.
 *
 * If two payroll obligations exist for the same person (e.g. multiple
 * accounts) the first one wins; SA estimation only cares about the salary
 * figure, which is the same across accounts in practice.
 */
export function getDirectors(): readonly Director[] {
  const byPerson = new Map<PersonId, Director>();
  for (const o of getObligationRegistry().listByCategory('payroll')) {
    if (byPerson.has(o.personId)) continue;
    const person = getPerson(o.personId);
    byPerson.set(o.personId, {
      ...person,
      personId: o.personId,
      monthlySalary: o.amount,
      tolerance: o.amountTolerance ?? DEFAULT_SALARY_TOLERANCE,
      namePattern: personNamePattern(person),
      label: `${personShortName(person)}'s Tax`,
      code: o.personId.toUpperCase().slice(0, 2),
    });
  }
  return [...byPerson.values()];
}

/**
 * HMRC Payment Patterns
 *
 * Each tax type has its own narrative on UK bank statements:
 * - VAT: "HMRC VAT SOUTHEND …" for Bacs direct-debit settlement, OR
 *   "HMRC ETMP - GLASGOW - Card Ending: NNNN" when VAT is paid by debit
 *   card — HMRC routes card payments through the ETMP gateway regardless
 *   of liability type, but the `Card Ending:` suffix is a reliable marker.
 * - Self Assessment: "HMRC GOV.UK SA…"
 * - Corporation Tax: "HMRC CORPORATION T…" (Bacs) or "HMRC GOV.UK COTAX…"
 *   (card channel).
 * - Payment-plan / TTP installments: bare "HMRC ETMP …" or "HMRC NDDS …"
 *   (no card-ending suffix) — these are recurring direct debits.
 *
 * Patterns are SQL LIKE strings.
 */

/**
 * Canonical narrative → LIKE-pattern map. Single source of truth for both
 * the seeder-facing {@link HMRC_PATTERNS} groups and the narrative-
 * classification SQL emitted by {@link buildHmrcNarrativeCaseSql}. Adding
 * a new narrative here surfaces everywhere (feeds, classifier, tests) in
 * one change — no parallel literal lists to keep in sync.
 *
 * Object insertion order is load-bearing: {@link buildHmrcNarrativeCaseSql}
 * emits CASE WHEN clauses in iteration order, so more-specific patterns
 * (e.g. card-channel ETMP under `vat`) must appear in a key that iterates
 * BEFORE the more-generic fallback (bare ETMP under `payment-plan`).
 */
export const HMRC_NARRATIVE_PATTERNS = {
  /**
   * VAT narratives:
   *   - "HMRC VAT…" for Bacs direct-debit settlement from the VAT office.
   *   - "HMRC ETMP% Card Ending%" for debit-card VAT payments. HMRC's card
   *     gateway routes every card payment through ETMP, so card-channel
   *     VAT lands as "HMRC ETMP - GLASGOW - Card Ending: NNNN". The
   *     `Card Ending:` suffix is the reliable discriminator from bare
   *     "HMRC ETMP" (which is genuinely TTP / recurring-DD, not VAT).
   */
  'vat': ['HMRC VAT%', 'HMRC ETMP% Card Ending%'],
  'self-assessment': ['HMRC GOV.UK SA%'],
  /**
   * Corporation Tax — two distinct narratives observed in the wild:
   *   - "HMRC CORPORATION T…" for Bacs / faster-payments settlement
   *   - "HMRC GOV.UK COTAX…" for card-channel payments
   * Deliberately does NOT include bare "HMRC ETMP…" — those are recurring
   * PAYE-style installments or Time-To-Pay direct debits, never CT. Card-
   * channel CT already has its own specific prefix ("HMRC GOV.UK COTAX…"),
   * so no card-ETMP fallback is needed for CT.
   */
  'corporation-tax': ['HMRC CORPORATION T%', 'HMRC GOV.UK COTAX%'],
  /**
   * Payment-plan / installment narratives. NDDS is HMRC's direct-debit
   * service for Time-To-Pay arrangements; ETMP is the generic gateway used
   * for PAYE and miscellaneous penalty / interest direct debits.
   *
   * Bare `HMRC ETMP%` stays here (not in `vat`) so recurring-DD TTP
   * installments are still classified as payment-plan. The more-specific
   * `HMRC ETMP% Card Ending%` lives in the `vat` key above and wins in
   * the CASE expression because `vat` iterates first.
   */
  'payment-plan': ['HMRC NDDS%', 'HMRC ETMP%'],
} as const satisfies Record<string, readonly string[]>;

/**
 * Narrative key derived from {@link HMRC_NARRATIVE_PATTERNS}. `'other'` is the
 * SQL `ELSE` branch fallback — any HMRC line that doesn't match a specific
 * narrative lands here.
 */
export type HmrcNarrativeKey = keyof typeof HMRC_NARRATIVE_PATTERNS | 'other';

/**
 * SQL LIKE-pattern groups keyed by call-site intent. Each value is derived
 * from {@link HMRC_NARRATIVE_PATTERNS} so seeder patterns and the
 * classifier CASE expression can never drift.
 */
export const HMRC_PATTERNS = {
  VAT: HMRC_NARRATIVE_PATTERNS['vat'],
  SELF_ASSESSMENT: HMRC_NARRATIVE_PATTERNS['self-assessment'],
  CORPORATION_TAX: HMRC_NARRATIVE_PATTERNS['corporation-tax'],
  /** ETMP gateway — Corporation Tax, PAYE, and anything HMRC bills via card. */
  ETMP: ['HMRC ETMP%'],
  /**
   * Union of every known HMRC narrative, plus the generic `HMRC GOV.UK%`
   * catch-all for payments that don't fit a more-specific prefix. Used by
   * the unmatched-payments feed so that a payment failing to dock onto any
   * known obligation still surfaces somewhere the user can see it.
   */
  ANY: [
    ...new Set([
      ...HMRC_NARRATIVE_PATTERNS['vat'],
      ...HMRC_NARRATIVE_PATTERNS['self-assessment'],
      ...HMRC_NARRATIVE_PATTERNS['corporation-tax'],
      ...HMRC_NARRATIVE_PATTERNS['payment-plan'],
      'HMRC GOV.UK%',
    ]),
  ],
} as const satisfies Record<string, readonly string[]>;

/**
 * SQL CASE clause that classifies a description column into an
 * {@link HmrcNarrativeKey}. Derived from {@link HMRC_NARRATIVE_PATTERNS}
 * so the classifier can never drift from the seeder-facing pattern groups.
 *
 * Only the caller-supplied `columnExpression` is interpolated — every
 * pattern literal originates from this module, so the result is free of
 * user-controlled input and safe to splice into a prepared statement.
 */
export function buildHmrcNarrativeCaseSql(columnExpression: string): string {
  const clauses: string[] = [];
  for (const [narrative, patterns] of Object.entries(HMRC_NARRATIVE_PATTERNS)) {
    for (const pattern of patterns) {
      clauses.push(`WHEN ${columnExpression} LIKE '${pattern}' THEN '${narrative}'`);
    }
  }
  return `CASE\n        ${clauses.join('\n        ')}\n        ELSE 'other'\n      END`;
}
