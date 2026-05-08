/**
 * §3.2 — household + per-entity liquidity overview for orchestrators.
 */

import type { AiEntityLiquidityFxResponse } from '../../../shared/api-contracts.js';
import { AiEntityLiquidityFxResponseSchema } from '../../../shared/api-contracts.js';
import { todayIsoLocal } from '../../../shared/iso-date.js';
import { buildEntityLiquidityFxRollup } from '../cross-currency/entity-liquidity-fx.js';
import { AI_MANIFEST_SCHEMA_VERSION } from './constants.js';

export function composeAiEntityLiquidityFx(): AiEntityLiquidityFxResponse {
  const { global, byEntity } = buildEntityLiquidityFxRollup();
  return AiEntityLiquidityFxResponseSchema.parse({
    generatedAt: new Date().toISOString(),
    schemaVersion: AI_MANIFEST_SCHEMA_VERSION,
    asOf: todayIsoLocal(),
    global,
    byEntity,
  });
}
