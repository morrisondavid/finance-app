/**
 * People domain — registry.
 *
 * The loader (`buildPeopleRegistry`) is the one place where raw
 * people data is turned into answers. Every gate that scopes people
 * for a named purpose (directors, SA filers, alias lookup) is
 * encoded here exactly once. Consumers read `registry.indexes.<name>`
 * — no consumer does `.filter(...)` on raw data.
 *
 * Adding a new named question:
 *   1. Add the field to `PeopleRegistry.indexes` below.
 *   2. Populate it in `buildPeopleRegistry` using the `_shared`
 *      index builders.
 *   3. Expose a named query in `queries.ts`.
 *   4. Document the consumer(s) in `registry.manifest.test.ts`.
 */

import { createRegistry } from '../_shared/create-registry.js';
import { filterToIndex, indexBy } from '../_shared/index-builders.js';
import { PEOPLE_DATA, type KnownPerson, type PersonId } from './data.js';
import type { Person } from './schema.js';

export interface PeopleRegistry {
  /** Every configured person, in the order declared in `data.ts`. */
  readonly all: readonly KnownPerson[];
  /** Every person id, in declaration order. */
  readonly allIds: readonly PersonId[];
  /** Primary-key lookup by person id. */
  readonly byId: ReadonlyMap<PersonId, KnownPerson>;
  readonly indexes: {
    /** People with `isDirector === true`. */
    readonly directors: readonly PersonId[];
    /** People with `filesSelfAssessment === true`. */
    readonly saFilers: readonly PersonId[];
    /**
     * Precompiled, combined case-insensitive regex per person,
     * matching any of their `matchAliases`. The regex is compiled
     * once at build time; consumers that need to recognise a person
     * in a transaction description do an O(people) scan over this
     * map instead of re-compiling regexes per call.
     */
    readonly aliasRegexes: ReadonlyMap<PersonId, RegExp>;
  };
}

export function buildPeopleRegistry(
  data: readonly Person[] = PEOPLE_DATA,
): PeopleRegistry {
  // Narrow the input to KnownPerson when it came from PEOPLE_DATA.
  // For test fixtures that pass Person[], the id is widened to
  // string, but downstream consumers only ever call this with known
  // ids so a same-runtime cast is sound.
  const all = data as readonly KnownPerson[];
  const allIds = all.map(p => p.id);
  const byId = indexBy(all, p => p.id);

  const directors = filterToIndex(all, p => p.isDirector === true).map(p => p.id);
  const saFilers = filterToIndex(all, p => p.filesSelfAssessment === true).map(p => p.id);

  const aliasRegexes = new Map<PersonId, RegExp>();
  for (const p of all) {
    const pattern = p.matchAliases.join('|');
    aliasRegexes.set(p.id, new RegExp(pattern, 'i'));
  }

  return {
    all,
    allIds,
    byId,
    indexes: {
      directors,
      saFilers,
      aliasRegexes,
    },
  };
}

const handle = createRegistry<PeopleRegistry>({
  name: 'people',
  build: () => buildPeopleRegistry(PEOPLE_DATA),
});

export const getPeopleRegistry = handle.get;
export const invalidatePeopleRegistry = handle.invalidate;
export const __resetPeopleRegistryForTests = handle.__resetForTests;
