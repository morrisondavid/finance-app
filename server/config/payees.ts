/**
 * Payee Configuration
 *
 * Defines director-level payroll brackets (keyed on PersonId) and the HMRC
 * payment narratives used to match settlement payments. Director identity
 * (name, display label, etc.) is derived from `people.ts` — this file only
 * adds the business-specific fields each person carries in their role as a
 * company director (monthly salary figure, short code).
 */

import {
  getPerson,
  personNamePattern,
  personShortName,
  type Person,
  type PersonId,
} from './people.js';

/**
 * Pence-level drift tolerance when classifying a payee debit as salary vs.
 * dividend. Real payroll rarely moves by more than a pound or two (pension
 * rounding, PAYE adjustments) so £10 is more than enough to absorb noise
 * without swallowing genuinely dividend-sized payments.
 */
export const SALARY_MATCH_TOLERANCE = 10;

/**
 * Per-director payroll config. Keyed on PersonId so additions/removals
 * flow from the slim people config without double-entry here.
 */
export interface DirectorPayrollConfig {
  readonly personId: PersonId;
  /** Set monthly salary figure (the tax-optimal amount paid via PAYE). Single value, not a range. */
  readonly monthlySalary: number;
}

export const DIRECTOR_PAYROLL: readonly DirectorPayrollConfig[] = [
  { personId: 'david', monthlySalary: 764 },
  { personId: 'heena', monthlySalary: 764 },
] as const;

/**
 * Fully-hydrated director record. Merges Person identity with payroll config
 * and derives the pattern / label / code fields that were previously
 * hand-written — so adding a new director is a one-line change in people.ts
 * plus one salary entry here, never six.
 */
export interface Director extends Person, DirectorPayrollConfig {
  /** SQL LIKE pattern derived from Person.name. */
  namePattern: string;
  /** Human label for the dashboard personal-tax card. */
  label: string;
  /** Short UI badge code (e.g. "DA", "HE"). */
  code: string;
}

export function getDirectors(): readonly Director[] {
  return DIRECTOR_PAYROLL.map(cfg => {
    const person = getPerson(cfg.personId);
    return {
      ...person,
      ...cfg,
      namePattern: personNamePattern(person),
      label: `${personShortName(person)}'s Tax`,
      code: cfg.personId.toUpperCase().slice(0, 2),
    };
  });
}

/**
 * Get a director by Person name. Legacy callers that still look up by literal
 * name keep working; new code should use `getDirectors()` or PersonId directly.
 */
export function getDirectorByName(name: string): Director | undefined {
  const lower = name.toLowerCase();
  return getDirectors().find(d =>
    lower.includes(d.name.toLowerCase().split(' ')[0]),
  );
}

/**
 * True if an absolute transaction amount looks like a salary payment for any
 * configured director, within SALARY_MATCH_TOLERANCE of their monthly figure.
 */
export function isSalaryAmount(amount: number): boolean {
  const abs = Math.abs(amount);
  return DIRECTOR_PAYROLL.some(
    cfg => Math.abs(abs - cfg.monthlySalary) <= SALARY_MATCH_TOLERANCE,
  );
}

/**
 * HMRC Payment Patterns
 *
 * Each tax type has its own narrative on UK bank statements:
 * - VAT: always "HMRC VAT SOUTHEND …" — paid by direct debit to the VAT office
 * - Self Assessment: "HMRC GOV.UK SA…"
 * - Corporation Tax / PAYE / other: booked via HMRC's Enterprise Tax
 *   Management Platform as "HMRC ETMP …". ETMP is a generic gateway, so it
 *   must NOT be conflated with VAT.
 *
 * Patterns are SQL LIKE strings.
 */
export const HMRC_PATTERNS = {
  /** VAT settlement payments. Only ever "HMRC VAT…". */
  VAT: ['HMRC VAT%'] as const,

  /** Self Assessment (personal tax) payments. */
  SELF_ASSESSMENT: ['HMRC GOV.UK SA%'] as const,

  /**
   * Corporation Tax — two distinct narratives observed in the wild:
   *   - "HMRC CORPORATION T…" for Bacs / faster-payments settlement
   *   - "HMRC GOV.UK COTAX…" for card-channel payments
   * Deliberately does NOT include "HMRC ETMP…" even though ETMP is HMRC's
   * generic collection gateway — ETMP lines are overwhelmingly PAYE-style
   * recurring installments or Time-To-Pay arrangement debits, never direct
   * Corp Tax settlements in the user's ledger. Conflating them would
   * over-attribute CT to payments that aren't CT at all.
   */
  CORPORATION_TAX: ['HMRC CORPORATION T%', 'HMRC GOV.UK COTAX%'] as const,

  /** ETMP gateway — Corporation Tax, PAYE, and anything HMRC bills via card. */
  ETMP: ['HMRC ETMP%'] as const,

  /**
   * Union of every known HMRC narrative. Used by the unmatched-payments feed so
   * that a payment failing to dock onto a VAT quarter (or any other known
   * obligation) still surfaces somewhere the user can see it.
   */
  ANY: [
    'HMRC VAT%',
    'HMRC ETMP%',
    'HMRC GOV.UK SA%',
    'HMRC GOV.UK%',
    'HMRC CORPORATION T%',
    'HMRC NDDS%',
  ] as const,
} as const;
