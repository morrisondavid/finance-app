/**
 * People domain — Zod schema + inferred TS types.
 *
 * Single source of truth for the humans this app knows about —
 * directors, Self Assessment filers, rental co-owners. Stays
 * intentionally slim: identity (id + name) and the boolean axes
 * (`filesSelfAssessment`, `isDirector`) that downstream registries
 * and queries index against.
 *
 * A person record carries only data, never derivations. Derived
 * values (short name, LIKE-pattern, regex) live in `queries.ts` so
 * the schema never needs to know about SQL or RegExp semantics.
 */

import { z } from 'zod';

export const PersonResidencyStatusSchema = z.enum(['uk-resident', 'non-resident']);
export type PersonResidencyStatus = z.infer<typeof PersonResidencyStatusSchema>;

export const PersonResidencySchema = z
  .object({
    /** UK tax residency status for Self Assessment estimation. */
    status: PersonResidencyStatusSchema,
    /** ISO date when the person left the UK (if non-resident). */
    leftUkDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    /** Country of tax residence (e.g. UAE). */
    countryOfResidence: z.string().min(1).optional(),
    /**
     * Whether the person retains the UK personal allowance as a non-resident
     * (typically true for UK nationals under domestic law).
     */
    retainsPersonalAllowance: z.boolean().default(true),
  })
  .readonly();

export type PersonResidency = z.infer<typeof PersonResidencySchema>;

export const PersonIdSchema = z.string().regex(/^[a-z][a-z0-9-]*$/, {
  message: 'PersonId must be kebab-case (lowercase letters, digits, hyphens).',
});

export const PersonSchema = z
  .object({
    /** Stable id. Kebab-case, used as foreign key in other configs. */
    id: PersonIdSchema,
    /** Full legal name as it appears in bank statement descriptions. */
    name: z.string().min(1),
    /** Optional short name for UI. Defaults to `name.split(' ')[0]`. */
    displayName: z.string().min(1).optional(),
    /**
     * Whether this person files UK Self Assessment. Drives the SA
     * auto-seed — the `saFilers` index is exactly the people flagged
     * here.
     */
    filesSelfAssessment: z.boolean().optional(),
    /**
     * Whether this person is a director of a business entity. Drives
     * the `directors` index — hydration of monthly salary / tolerance
     * for directors is deferred to the payees domain (see
     * `server/domain/payees/`) which joins this flag with the payroll
     * obligations registry.
     */
    isDirector: z.boolean().optional(),
    /**
     * Regex source strings (case-insensitive) used to match this
     * person against raw transaction descriptions. Drives both the
     * payroll matcher and the director entries in the merchant
     * registry — the canonical way to recognise a person in the
     * ledger, in one place.
     */
    matchAliases: z.array(z.string().min(1)).readonly(),
    /**
     * UK tax residency for Self Assessment estimation. Absent = UK resident.
     */
    residency: PersonResidencySchema.optional(),
  })
  .readonly();

export type Person = z.infer<typeof PersonSchema>;

/**
 * The raw `data.ts` export carries a `readonly Person[]` list; the
 * registry turns it into an ordered, id-keyed structure.
 */
export const PeopleDataSchema = z.array(PersonSchema).readonly();
export type PeopleData = z.infer<typeof PeopleDataSchema>;
