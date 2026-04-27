import { loadMovementsData } from './movements-data.js';
import {
  buildMovementRegistryFromData,
  type MovementRegistry,
} from './movements-registry.js';
import type { Movement } from './movements-schema.js';

export function makeTestMovementRegistry(
  override?: readonly Movement[],
): MovementRegistry {
  return buildMovementRegistryFromData(override ?? loadMovementsData());
}
