/**
 * GET /api/ai/survival — reuses `buildSurvival` forecast walk.
 */

import type { AiSurvivalResponse } from '../../../shared/api-contracts.js';
import { AiSurvivalResponseSchema } from '../../../shared/api-contracts.js';
import { buildSurvival, type BuildSurvivalOpts } from '../forecast/survival.js';
import { AI_MANIFEST_SCHEMA_VERSION } from './constants.js';

export type ComposeAiSurvivalOpts = BuildSurvivalOpts;

export function composeAiSurvival(opts: ComposeAiSurvivalOpts = {}): AiSurvivalResponse {
  const result = buildSurvival(opts);
  return AiSurvivalResponseSchema.parse({
    generatedAt: new Date().toISOString(),
    schemaVersion: AI_MANIFEST_SCHEMA_VERSION,
    today: result.today,
    scope: result.scope,
    essentialsMonthlyGbp: result.essentialsMonthlyGbp,
    confirmedFutureIncome: result.confirmedFutureIncome,
    availableCreditGbp: result.availableCreditGbp,
    ...(result.given !== undefined ? { given: result.given } : {}),
    ...(result.solveForTarget !== undefined ? { solveForTarget: result.solveForTarget } : {}),
    appliedOverrides: result.appliedOverrides,
    narrative: result.narrative,
  });
}
