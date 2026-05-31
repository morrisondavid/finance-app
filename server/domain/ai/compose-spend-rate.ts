/**
 * GET /api/ai/spend-rate — reuses `computeTrailingSpendRate` (grouped SQL + categorisation).
 */

import type { AiSpendRateResponse, EntityId } from '../../../shared/api-contracts.js';
import { AiSpendRateResponseSchema } from '../../../shared/api-contracts.js';
import { computeTrailingSpendRate } from '../analytics/spend-rate.js';
import { AI_MANIFEST_SCHEMA_VERSION } from './constants.js';

export interface ComposeAiSpendRateOpts {
  readonly window?: number;
  readonly entityId?: EntityId;
}

export function composeAiSpendRate(opts: ComposeAiSpendRateOpts = {}): AiSpendRateResponse {
  const windowDays = opts.window ?? 30;
  const result = computeTrailingSpendRate(windowDays, opts.entityId);
  return AiSpendRateResponseSchema.parse({
    generatedAt: new Date().toISOString(),
    schemaVersion: AI_MANIFEST_SCHEMA_VERSION,
    windowDays: result.windowDays,
    currency: 'GBP',
    perDay: result.perDay,
    perWeek: result.perWeek,
    perMonth: result.perMonth,
    split: result.split,
  });
}
