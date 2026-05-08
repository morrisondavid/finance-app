/**
 * §3.2 — household + per-entity liquidity overview (native + GBP per line).
 */

import type { EntityId } from '../../../shared/api-contracts.js';
import type { AccountName } from '../../types.js';
import type { LiquidityOverview } from '../accounts/liquidity-overview.js';
import { buildLiquidityOverview } from '../accounts/liquidity-overview.js';
import { pickBalances } from '../accounts/pick-balances.js';
import { accountsForEntity } from '../accounts/queries.js';
import { allEntityIds } from '../company/index.js';
import { getAllAccountBalances } from '../../db/repositories/balance.js';
import type { AccountBalance } from '../../db/repositories/balance.js';

export function buildEntityLiquidityFxRollup(): {
  readonly global: LiquidityOverview;
  readonly byEntity: Record<EntityId, LiquidityOverview>;
} {
  const allBalances = getAllAccountBalances();
  const global = buildLiquidityOverview(allBalances);

  const byEntity: Record<EntityId, LiquidityOverview> = {} as Record<EntityId, LiquidityOverview>;
  for (const eid of allEntityIds()) {
    const names = accountsForEntity(eid);
    const sub = pickBalances(allBalances, [...names] as readonly AccountName[]);
    byEntity[eid] = buildLiquidityOverview(sub);
  }

  return { global, byEntity };
}

/** Test hook: build rollups from an in-memory balance map. */
export function buildEntityLiquidityFxRollupFromBalances(
  allBalances: Readonly<Record<AccountName, AccountBalance>>,
): {
  readonly global: LiquidityOverview;
  readonly byEntity: Record<EntityId, LiquidityOverview>;
} {
  const global = buildLiquidityOverview(allBalances);
  const byEntity: Record<EntityId, LiquidityOverview> = {} as Record<EntityId, LiquidityOverview>;
  for (const eid of allEntityIds()) {
    const names = accountsForEntity(eid);
    const sub = pickBalances(allBalances, [...names] as readonly AccountName[]);
    byEntity[eid] = buildLiquidityOverview(sub);
  }
  return { global, byEntity };
}
