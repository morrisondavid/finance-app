/**
 * People domain — raw data.
 *
 * Adding a new person: append a row here. Downstream registries and
 * queries (directors, SA filers, alias matcher) index against the
 * `isDirector` / `filesSelfAssessment` flags — a new person lands
 * everywhere they belong the moment their row exists.
 *
 * Data only. No derivations, no SQL, no regex compilation — those
 * live in `queries.ts` / `registry.ts`.
 */

import type { Person } from './schema.js';

export const PEOPLE_DATA = [
  {
    id: 'david',
    name: 'David Morrison',
    filesSelfAssessment: true,
    isDirector: true,
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
    isDirector: true,
    matchAliases: [
      'HEENA\\s+TAILOR',
      'HEENA\\s+MORRISON',
      'TAILOR\\s+HEENA',
      'MORRISON\\s+H\\b',
    ],
  },
] as const satisfies readonly Person[];

/** Literal union of every known person id. */
export type PersonId = typeof PEOPLE_DATA[number]['id'];

/**
 * Concrete Person record with its id narrowed to the literal union.
 * Returned by lookup helpers so callers can feed `id` straight into
 * other PersonId-typed APIs without widening to `string`.
 */
export type KnownPerson = typeof PEOPLE_DATA[number];

/**
 * Generic ratio/share/weight shape: a per-person number that
 * typically sums to 1. The meaning is named at the use site — rental
 * ownership, dividend share, cost split. Unknown keys fail at
 * compile time.
 */
export type AllocationByPerson = { readonly [K in PersonId]?: number };
