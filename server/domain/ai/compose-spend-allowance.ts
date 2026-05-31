/**
 * GET /api/ai/spend-allowance — reuses active survival plan + discretionary SQL sum.
 */

import type { AiSpendAllowanceResponse } from '../../../shared/api-contracts.js';
import { AiSpendAllowanceResponseSchema } from '../../../shared/api-contracts.js';
import { computeSpendAllowance, type SpendAllowancePeriod } from '../analytics/spend-allowance.js';
import { getActiveSurvivalPlan } from '../../db/survival-plan-csv.js';
import { AI_MANIFEST_SCHEMA_VERSION } from './constants.js';

export interface ComposeAiSpendAllowanceOpts {
  readonly period?: SpendAllowancePeriod;
}

export function composeAiSpendAllowance(
  opts: ComposeAiSpendAllowanceOpts = {},
): AiSpendAllowanceResponse {
  const plan = getActiveSurvivalPlan();
  if (plan === null) {
    throw new Error('No active survival plan — commit one via survival_plan_commit first');
  }
  const period = opts.period ?? 'today';
  const result = computeSpendAllowance(plan, period);
  return AiSpendAllowanceResponseSchema.parse({
    generatedAt: new Date().toISOString(),
    schemaVersion: AI_MANIFEST_SCHEMA_VERSION,
    plan: result.plan,
    period: result.period,
    accruedAllowanceGbp: result.accruedAllowanceGbp,
    spentGbp: result.spentGbp,
    remainingGbp: result.remainingGbp,
    status: result.status,
    tomorrowAllowanceGbp: result.tomorrowAllowanceGbp,
  });
}
