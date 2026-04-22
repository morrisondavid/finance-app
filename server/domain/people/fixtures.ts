/**
 * People domain — test fixtures.
 *
 * `makeTestPeopleRegistry(override?)` produces a fresh registry
 * built through the production `buildPeopleRegistry` loader. When
 * `override` is omitted the default `PEOPLE_DATA` is used;
 * otherwise the supplied array fully replaces the default (the
 * data shape is a list, not a map, so partial merges would hide
 * intent).
 *
 * Consumer tests get every index automatically — new indexes added
 * to the real registry appear in fixtures without a sweep of every
 * test file.
 */

import { PEOPLE_DATA } from './data.js';
import { buildPeopleRegistry, type PeopleRegistry } from './registry.js';
import type { Person } from './schema.js';

export function makeTestPeopleRegistry(
  override?: readonly Person[],
): PeopleRegistry {
  return buildPeopleRegistry(override ?? PEOPLE_DATA);
}
