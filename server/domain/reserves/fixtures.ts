import { loadReservesData } from './data.js';
import {
  buildReserveRegistryFromData,
  type ReserveRegistry,
} from './registry.js';
import type { Reserve } from './schema.js';

export function makeTestReserveRegistry(
  override?: readonly Reserve[],
): ReserveRegistry {
  return buildReserveRegistryFromData(override ?? loadReservesData());
}
