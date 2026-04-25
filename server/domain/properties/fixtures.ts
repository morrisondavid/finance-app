/**
 * Properties domain — test fixtures.
 *
 * `makeTestPropertyRegistry(override?)` produces a fresh registry built
 * through the production builder. Default uses the disk CSV; tests pass
 * their own array to bypass disk entirely.
 */

import { loadPropertiesData } from './data.js';
import {
  buildPropertyRegistryFromData,
  type PropertyRegistry,
} from './registry.js';
import type { Property } from './schema.js';

export function makeTestPropertyRegistry(
  override?: readonly Property[],
): PropertyRegistry {
  const data = override ?? loadPropertiesData();
  return buildPropertyRegistryFromData(data);
}
