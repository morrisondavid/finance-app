/**
 * HMRC Payment Narrative Patterns
 *
 * Each tax type has its own narrative on UK bank statements:
 * - VAT: "HMRC VAT SOUTHEND …" for Bacs direct-debit settlement, OR
 *   "HMRC ETMP - GLASGOW - Card Ending: NNNN" when VAT is paid by
 *   debit card — HMRC routes card payments through the ETMP gateway
 *   regardless of liability type, but the `Card Ending:` suffix is a
 *   reliable marker.
 * - Self Assessment: "HMRC GOV.UK SA…"
 * - Corporation Tax: "HMRC CORPORATION T…" (Bacs) or
 *   "HMRC GOV.UK COTAX…" (card channel).
 * - Payment-plan / TTP installments: bare "HMRC ETMP …" or
 *   "HMRC NDDS …" (no card-ending suffix) — these are recurring
 *   direct debits.
 *
 * Patterns are SQL LIKE strings. Not a registry — flat pattern
 * lists, not set-wise queryable records — so this file stays a
 * plain module rather than following the `createRegistry` shape.
 * The classifier below derives its CASE expression from the same
 * source so seeder patterns and narrative classification can
 * never drift.
 */

/**
 * Canonical narrative → LIKE-pattern map. Single source of truth
 * for both the seeder-facing {@link HMRC_PATTERNS} groups and the
 * narrative-classification SQL emitted by
 * {@link buildHmrcNarrativeCaseSql}. Adding a new narrative here
 * surfaces everywhere (feeds, classifier, tests) in one change —
 * no parallel literal lists to keep in sync.
 *
 * Object insertion order is load-bearing:
 * {@link buildHmrcNarrativeCaseSql} emits CASE WHEN clauses in
 * iteration order, so more-specific patterns (e.g. card-channel
 * ETMP under `vat`) must appear in a key that iterates BEFORE the
 * more-generic fallback (bare ETMP under `payment-plan`).
 */
export const HMRC_NARRATIVE_PATTERNS = {
  /**
   * VAT narratives:
   *   - "HMRC VAT…" for Bacs direct-debit settlement from the VAT
   *     office.
   *   - "HMRC ETMP% Card Ending%" for debit-card VAT payments.
   *     HMRC's card gateway routes every card payment through ETMP,
   *     so card-channel VAT lands as "HMRC ETMP - GLASGOW - Card
   *     Ending: NNNN". The `Card Ending:` suffix is the reliable
   *     discriminator from bare "HMRC ETMP" (which is genuinely
   *     TTP / recurring-DD, not VAT).
   */
  'vat': ['HMRC VAT%', 'HMRC ETMP% Card Ending%'],
  'self-assessment': ['HMRC GOV.UK SA%'],
  /**
   * Corporation Tax — two distinct narratives observed in the
   * wild:
   *   - "HMRC CORPORATION T…" for Bacs / faster-payments
   *     settlement.
   *   - "HMRC GOV.UK COTAX…" for card-channel payments.
   * Deliberately does NOT include bare "HMRC ETMP…" — those are
   * recurring PAYE-style installments or Time-To-Pay direct
   * debits, never CT. Card-channel CT already has its own specific
   * prefix ("HMRC GOV.UK COTAX…"), so no card-ETMP fallback is
   * needed for CT.
   */
  'corporation-tax': ['HMRC CORPORATION T%', 'HMRC GOV.UK COTAX%'],
  /**
   * Payment-plan / installment narratives. NDDS is HMRC's
   * direct-debit service for Time-To-Pay arrangements; ETMP is the
   * generic gateway used for PAYE and miscellaneous penalty /
   * interest direct debits.
   *
   * Bare `HMRC ETMP%` stays here (not in `vat`) so recurring-DD
   * TTP installments are still classified as payment-plan. The
   * more-specific `HMRC ETMP% Card Ending%` lives in the `vat`
   * key above and wins in the CASE expression because `vat`
   * iterates first.
   */
  'payment-plan': ['HMRC NDDS%', 'HMRC ETMP%'],
} as const satisfies Record<string, readonly string[]>;

/**
 * Narrative key derived from {@link HMRC_NARRATIVE_PATTERNS}.
 * `'other'` is the SQL `ELSE` branch fallback — any HMRC line
 * that doesn't match a specific narrative lands here.
 */
export type HmrcNarrativeKey = keyof typeof HMRC_NARRATIVE_PATTERNS | 'other';

/**
 * SQL LIKE-pattern groups keyed by call-site intent. Each value
 * is derived from {@link HMRC_NARRATIVE_PATTERNS} so seeder
 * patterns and the classifier CASE expression can never drift.
 */
export const HMRC_PATTERNS = {
  VAT: HMRC_NARRATIVE_PATTERNS['vat'],
  SELF_ASSESSMENT: HMRC_NARRATIVE_PATTERNS['self-assessment'],
  CORPORATION_TAX: HMRC_NARRATIVE_PATTERNS['corporation-tax'],
  /** ETMP gateway — Corporation Tax, PAYE, and anything HMRC bills via card. */
  ETMP: ['HMRC ETMP%'],
  /**
   * Union of every known HMRC narrative, plus the generic
   * `HMRC GOV.UK%` catch-all for payments that don't fit a more-
   * specific prefix. Used by the unmatched-payments feed so that a
   * payment failing to dock onto any known obligation still
   * surfaces somewhere the user can see it.
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
 * {@link HmrcNarrativeKey}. Derived from
 * {@link HMRC_NARRATIVE_PATTERNS} so the classifier can never
 * drift from the seeder-facing pattern groups.
 *
 * Only the caller-supplied `columnExpression` is interpolated —
 * every pattern literal originates from this module, so the
 * result is free of user-controlled input and safe to splice into
 * a prepared statement.
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
