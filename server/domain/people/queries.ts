/**
 * People domain — public query surface.
 *
 * Every function here answers one named question by reading a
 * precomputed index (or doing an O(1) map lookup). No function in
 * this file contains a `.filter(...)` over raw people data — if you
 * find yourself writing one, the answer belongs as a new index in
 * `registry.ts` instead.
 *
 * Every query takes the registry as an optional parameter with
 * default `= getPeopleRegistry()`. Tests inject fixture registries
 * without global-state pollution.
 */

import type { KnownPerson, PersonId } from './data.js';
import { getPeopleRegistry, type PeopleRegistry } from './registry.js';
import type { Person } from './schema.js';

/** Array of every valid PersonId — useful for Zod enums and tests. */
export function allPersonIds(
  reg: PeopleRegistry = getPeopleRegistry(),
): readonly PersonId[] {
  return reg.allIds;
}

/** Every configured person in declaration order. */
export function allPeople(
  reg: PeopleRegistry = getPeopleRegistry(),
): readonly KnownPerson[] {
  return reg.all;
}

/** Lookup a person by id; throws if `id` is not registered. */
export function getPerson(
  id: PersonId,
  reg: PeopleRegistry = getPeopleRegistry(),
): KnownPerson {
  const found = reg.byId.get(id);
  if (found === undefined) {
    throw new Error(`Unknown person: ${id}`);
  }
  return found;
}

/** Validate an unknown string as a PersonId (for API body parsing etc.). */
export function isPersonId(
  value: unknown,
  reg: PeopleRegistry = getPeopleRegistry(),
): value is PersonId {
  return typeof value === 'string' && reg.byId.has(value as PersonId);
}

/** Every person who files UK Self Assessment. */
export function saFilers(
  reg: PeopleRegistry = getPeopleRegistry(),
): readonly KnownPerson[] {
  return reg.indexes.saFilers.map(id => getPerson(id, reg));
}

/** Ids of everyone who files UK Self Assessment. */
export function saFilerIds(
  reg: PeopleRegistry = getPeopleRegistry(),
): readonly PersonId[] {
  return reg.indexes.saFilers;
}

/** Ids of everyone flagged `isDirector`. */
export function directorIds(
  reg: PeopleRegistry = getPeopleRegistry(),
): readonly PersonId[] {
  return reg.indexes.directors;
}

/** People records for everyone flagged `isDirector`. */
export function directors(
  reg: PeopleRegistry = getPeopleRegistry(),
): readonly KnownPerson[] {
  return reg.indexes.directors.map(id => getPerson(id, reg));
}

/**
 * Short name used in UI labels. Defaults to the first whitespace-
 * separated token of `name` when `displayName` is absent.
 */
export function personShortName(p: Person): string {
  return p.displayName ?? p.name.split(' ')[0];
}

/** SQL LIKE pattern for matching this person's name in transaction descriptions. */
export function personNamePattern(p: Person): string {
  return `%${p.name.toUpperCase()}%`;
}

/** Combined case-insensitive regex source matching any alias of `p`. */
export function personAliasAlternation(p: Person): string {
  return p.matchAliases.join('|');
}

/** Case-insensitive regex matching any alias of `p`. */
export function personAliasRegex(
  p: Person,
  reg: PeopleRegistry = getPeopleRegistry(),
): RegExp {
  const cached = reg.byId.has(p.id as PersonId) ? reg.indexes.aliasRegexes.get(p.id as PersonId) : undefined;
  return cached ?? new RegExp(personAliasAlternation(p), 'i');
}

/**
 * Return the person whose aliases match `description` (case-
 * insensitive). Returns `null` when no person matches. Iterates
 * people in declaration order, so the first match wins — aliases
 * should be disjoint.
 */
export function matchPersonInDescription(
  description: string,
  reg: PeopleRegistry = getPeopleRegistry(),
): KnownPerson | null {
  for (const p of reg.all) {
    const rx = reg.indexes.aliasRegexes.get(p.id);
    if (rx !== undefined && rx.test(description)) return p;
  }
  return null;
}
