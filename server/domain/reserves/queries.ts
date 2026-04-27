/**
 * Reserves domain — public query surface.
 */

import type { EntityId, ObligationType } from '../../../shared/api-contracts.js';
import { getReserveRegistry, type ReserveRegistry } from './registry.js';
import { reserveKey, type Reserve } from './schema.js';

export function allReserves(
  reg: ReserveRegistry = getReserveRegistry(),
): readonly Reserve[] {
  return reg.all;
}

/**
 * Look up the reserve account for a `(obligation_type, entity_id)` pair.
 * Returns `null` when no row exists — callers treat that as "no policy
 * configured" (the tax-reserve warnings emit nothing for that combo).
 */
export function reserveForObligation(
  obligationType: ObligationType,
  entityId: EntityId,
  reg: ReserveRegistry = getReserveRegistry(),
): Reserve | null {
  return reg.indexes.byKey.get(reserveKey(obligationType, entityId)) ?? null;
}
