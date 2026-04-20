/**
 * People (principals) Configuration
 *
 * Single source of truth for the humans this app knows about — directors,
 * Self Assessment filers, rental co-owners. Stays intentionally slim: only
 * identity (id + name) and the flags needed for downstream configs that
 * reference a person by id.
 *
 * Any config that needs "which people does this ratio apply to?" should type
 * its field as `AllocationByPerson` so typos / unknown ids fail at compile
 * time rather than shipping as silent data integrity bugs.
 */

export interface Person {
  /** Stable id. Kebab-case, used as foreign key in other configs. */
  readonly id: string;
  /** Full legal name as it appears in bank statement descriptions. */
  readonly name: string;
  /** Optional short name for UI. Defaults to name.split(' ')[0]. */
  readonly displayName?: string;
  /** Whether this person files UK Self Assessment (drives SA auto-seed). */
  readonly filesSelfAssessment?: boolean;
  /**
   * Regex source strings (case-insensitive) used to match this person against
   * raw transaction descriptions. Drives both the payroll matcher and the
   * director entries in the merchant registry — the canonical way to recognise
   * a person in the ledger, in one place.
   */
  readonly matchAliases: readonly string[];
}

export const PEOPLE = [
  {
    id: 'david',
    name: 'David Morrison',
    filesSelfAssessment: true,
    matchAliases: [
      'DAVID\\s+MORRISON',
      'MORRISON\\s+DD',
      '\\bD\\s+MORRISON\\b',
    ],
  },
  {
    id: 'heena',
    name: 'Heena Tailor',
    filesSelfAssessment: true,
    matchAliases: [
      'HEENA\\s+TAILOR',
      'HEENA\\s+MORRISON',
      'TAILOR\\s+HEENA',
      'MORRISON\\s+H\\b',
    ],
  },
] as const satisfies readonly Person[];

/** Literal union of every known person id. Use this instead of `string` anywhere a person is referenced. */
export type PersonId = typeof PEOPLE[number]['id'];

/**
 * Generic ratio/share/weight shape: a per-person number that typically sums
 * to 1. The *meaning* is named at the use site — rental ownership, dividend
 * share, cost split, etc. Unknown keys fail at compile time.
 */
export type AllocationByPerson = { readonly [K in PersonId]?: number };

/**
 * Concrete Person record with its id narrowed to the literal union. Returned
 * by the lookup helpers so callers can feed `id` straight into other
 * PersonId-typed APIs without widening to `string` or casting.
 */
export type KnownPerson = typeof PEOPLE[number];

export function getPerson(id: PersonId): KnownPerson {
  const found = PEOPLE.find(p => p.id === id);
  if (!found) throw new Error(`Unknown person: ${id}`);
  return found;
}

export function getSaFilers(): readonly KnownPerson[] {
  return PEOPLE.filter(p => p.filesSelfAssessment);
}

/** Short name used in UI labels. */
export function personShortName(p: Person): string {
  return p.displayName ?? p.name.split(' ')[0];
}

/** SQL LIKE pattern for matching this person's name in transaction descriptions. */
export function personNamePattern(p: Person): string {
  return `%${p.name.toUpperCase()}%`;
}

/** Validate an unknown string as a PersonId (for API body parsing etc.). */
export function isPersonId(value: unknown): value is PersonId {
  return typeof value === 'string' && PEOPLE.some(p => p.id === value);
}

/** Array of every valid PersonId — useful for Zod enums and tests. */
export function allPersonIds(): readonly PersonId[] {
  return PEOPLE.map(p => p.id);
}

/** Combined case-insensitive regex source matching any alias of `p`. */
export function personAliasAlternation(p: Person): string {
  return p.matchAliases.join('|');
}

/** Case-insensitive regex matching any alias of `p`. */
export function personAliasRegex(p: Person): RegExp {
  return new RegExp(personAliasAlternation(p), 'i');
}

/**
 * Return the person whose aliases match `description` (case-insensitive).
 * Returns `null` when no person matches. Iterates {@link PEOPLE} in order, so
 * the first matching person wins — aliases should be disjoint.
 */
export function matchPersonInDescription(description: string): KnownPerson | null {
  for (const p of PEOPLE) {
    if (personAliasRegex(p).test(description)) return p;
  }
  return null;
}
