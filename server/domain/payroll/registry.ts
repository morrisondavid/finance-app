/**
 * Payroll domain — registry.
 *
 * The payroll registry is a *derived* view: it joins the subset of
 * the obligations registry whose category is `'payroll'` with the
 * people registry to produce hydrated lookups for both directions of
 * the matcher — amount-based ("does this debit match a declared
 * payroll obligation?") and directory-based ("what's David's
 * monthly salary?").
 *
 * All matching logic (`matchPayrollEntry`, payroll-driven category
 * resolution) lives in `queries.ts`; this module owns the indexes.
 *
 * Indexes:
 *   - `entries` — flat list of every payroll obligation, in
 *     obligation-registry order.
 *   - `byAccount` — obligations keyed by the account they debit.
 *   - `byPersonAccount` — obligations keyed by `${personId}|${account}`,
 *     the pair `matchPayrollEntry` uses to pick candidates.
 *   - `directorsById` — hydrated `DirectorPayroll` record per director,
 *     joining payroll rows with the person identity (name pattern, short
 *     name, UI label).
 */

import type { OutgoingObligation } from '../../../shared/api-contracts.js';
import { createRegistry } from '../_shared/create-registry.js';
import { groupBy } from '../_shared/index-builders.js';
import {
  getObligationRegistry,
  type ObligationRegistry,
} from '../obligations/registry.js';
import {
  getPeopleRegistry,
  personNamePattern,
  personShortName,
  type PeopleRegistry,
  type PersonId,
} from '../people/index.js';
import type { DirectorPayroll } from './schema.js';

export type PayrollEntry = Extract<OutgoingObligation, { category: 'payroll' }>;

/**
 * Fallback pence-level drift tolerance when a payroll obligation
 * omits its own. Real payroll rarely moves by more than a pound or
 * two so £10 absorbs rounding noise without swallowing dividend-
 * sized payments.
 */
export const DEFAULT_SALARY_TOLERANCE = 10;

export interface PayrollRegistry {
  readonly indexes: {
    /** Every payroll obligation, in obligation-registry order. */
    readonly entries: readonly PayrollEntry[];
    /** Payroll obligations grouped by the account they debit. */
    readonly byAccount: ReadonlyMap<string, readonly PayrollEntry[]>;
    /**
     * Payroll obligations grouped by `(personId, account)` — the
     * pair `matchPayrollEntry` consults for amount-closest tie-
     * breaking when a single account runs multiple payroll runs for
     * the same person.
     */
    readonly byPersonAccount: ReadonlyMap<string, readonly PayrollEntry[]>;
    /**
     * Hydrated `DirectorPayroll` records keyed by personId. Only
     * people who (a) are flagged `isDirector` AND (b) have a payroll
     * obligation on file appear here. Directors without a payroll
     * obligation are simply absent — the caller treats that as "no
     * salary to attribute" rather than an error.
     */
    readonly directorsById: ReadonlyMap<PersonId, DirectorPayroll>;
  };
}

export interface BuildPayrollRegistryInput {
  readonly obligations?: ObligationRegistry;
  readonly people?: PeopleRegistry;
}

/** Compose the `(personId, account)` grouping key used by `byPersonAccount`. */
export function personAccountKey(personId: PersonId, account: string): string {
  return `${personId}|${account}`;
}

export function buildPayrollRegistry(
  input: BuildPayrollRegistryInput = {},
): PayrollRegistry {
  const obligations = input.obligations ?? getObligationRegistry();
  const people = input.people ?? getPeopleRegistry();

  const entries = obligations.listByCategory('payroll');

  const byAccount = groupBy(entries, e => e.account ?? '');
  const byPersonAccount = groupBy(entries, e =>
    personAccountKey(e.personId, e.account ?? ''),
  );

  const directorsById = new Map<PersonId, DirectorPayroll>();
  for (const directorId of people.indexes.directors) {
    const payroll = entries.find(e => e.personId === directorId);
    if (payroll === undefined) continue;
    const person = people.byId.get(directorId);
    if (person === undefined) continue;
    directorsById.set(directorId, {
      personId: directorId,
      monthlySalary: payroll.amount,
      tolerance: payroll.amountTolerance ?? DEFAULT_SALARY_TOLERANCE,
      namePattern: personNamePattern(person),
      label: `${personShortName(person)}'s Tax`,
      code: directorId.toUpperCase().slice(0, 2),
    });
  }

  return {
    indexes: {
      entries,
      byAccount,
      byPersonAccount,
      directorsById,
    },
  };
}

const handle = createRegistry<PayrollRegistry>({
  name: 'payroll',
  build: () => buildPayrollRegistry(),
});

export const getPayrollRegistry = handle.get;
export const invalidatePayrollRegistry = handle.invalidate;
export const __resetPayrollRegistryForTests = handle.__resetForTests;
