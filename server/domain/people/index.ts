/**
 * People domain — public barrel.
 *
 * Consumers should import from this module, not from the internal
 * `registry.ts` / `queries.ts` / `schema.ts` files directly.
 */

export {
  buildPeopleRegistry,
  getPeopleRegistry,
  invalidatePeopleRegistry,
  __resetPeopleRegistryForTests,
  type PeopleRegistry,
} from './registry.js';

export {
  PersonSchema,
  PersonIdSchema,
  PeopleDataSchema,
  type Person,
  type PeopleData,
} from './schema.js';

export {
  PEOPLE_DATA,
  type PersonId,
  type KnownPerson,
  type AllocationByPerson,
} from './data.js';

export {
  allPersonIds,
  allPeople,
  getPerson,
  isPersonId,
  saFilers,
  saFilerIds,
  directors,
  directorIds,
  personShortName,
  personNamePattern,
  personAliasAlternation,
  personAliasRegex,
  matchPersonInDescription,
} from './queries.js';

export { makeTestPeopleRegistry } from './fixtures.js';
